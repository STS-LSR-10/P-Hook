import { getCloudflareContext } from "@opennextjs/cloudflare";
import { log, safeMessage } from "@/lib/log";

const DELETE_BATCH = 1000; // the most R2 takes in one delete

export interface StoredObject {
  body: ReadableStream;
  size: number;
}

/** Where the bytes of kept files live. Names and sizes are in the database. */
export interface FileStore {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<void>;
  /** Remove everything under `prefix`, whatever the database knows about. Returns how many. */
  deletePrefix(prefix: string): Promise<number>;
}

/** The part of a Workers R2 bucket used here. */
export interface R2Like {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export function createR2Store(bucket: R2Like): FileStore {
  return {
    async put(key, bytes, mimeType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      return object ? { body: object.body, size: object.size } : null;
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        await bucket.delete(keys.slice(i, i + DELETE_BATCH));
      }
    },
    async deletePrefix(prefix) {
      let removed = 0;
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor });
        const keys = page.objects.map((o) => o.key);
        if (keys.length > 0) await bucket.delete(keys);
        removed += keys.length;
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return removed;
    },
  };
}

/** A store in memory, for tests and for development outside Workers. */
export function createMemoryStore(): FileStore & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    keys: () => [...objects.keys()],
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([bytes.slice()]).stream(), size: bytes.byteLength } : null;
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
    async deletePrefix(prefix) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      for (const key of keys) objects.delete(key);
      return keys.length;
    },
  };
}

/** The bucket of this Worker. Null where there is none: `next dev`, tests, or a missing binding. */
export async function getFileStore(): Promise<FileStore | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const bucket = (env as unknown as { FILES?: R2Like }).FILES;
    return bucket ? createR2Store(bucket) : null;
  } catch (error) {
    log.warn("file_store_unavailable", { reason: safeMessage(error) });
    return null;
  }
}
