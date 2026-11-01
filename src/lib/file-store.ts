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
