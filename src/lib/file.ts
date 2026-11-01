import type { Plan } from "@/lib/plan";
import { formatThaiDate } from "@/lib/thai-date";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MAX_FILE_BYTES = 20 * MB;
export const MAX_NAME_LENGTH = 200;

/** Space a plan may keep. Files stay when a plan is lowered; only new ones are refused. */
const FILE_CAPACITY: Record<Plan, number> = { free: 500 * MB, plus: 5 * GB, ultimate: 50 * GB };
export const fileCapacity = (plan: Plan): number => FILE_CAPACITY[plan];

/** Files a plan may keep per day (a guard, because anybody can sign up for Free). */
const FILE_DAY_LIMIT: Record<Plan, number> = { free: 20, plus: 100, ultimate: 200 };
export const fileDayLimit = (plan: Plan): number => FILE_DAY_LIMIT[plan];

export type MediaKind = "image" | "video" | "file";

/** A kept file as the web app receives it. */
export interface FileDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const EXTENSION_RE = /\.[a-z0-9]{1,10}$/i;
const BLOCKED_RE = /\.(?:exe|apk|msi|bat|sh)$/i;

/** Programs are refused: nothing here runs them, but nobody should fetch one from us either. */
export const isBlockedFile = (name: string): boolean => BLOCKED_RE.test(name.trim());

/** One line, no control characters, and short enough, keeping the extension when it is cut. */
export function cleanFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const name = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (name.length <= MAX_NAME_LENGTH) return name;
  const extension = EXTENSION_RE.exec(name)?.[0] ?? "";
  return `${name.slice(0, MAX_NAME_LENGTH - extension.length).trimEnd()}${extension}`;
}

/** A typed name takes the extension of the real file, unless it already has one. */
export function withExtensionOf(name: string, source: string): string {
  const extension = EXTENSION_RE.exec(source)?.[0];
  return extension && !EXTENSION_RE.test(name) ? cleanFileName(`${name}${extension}`) : name;
}

const KIND_LABEL: Record<MediaKind, string> = { image: "รูป", video: "วิดีโอ", file: "ไฟล์" };

/** What a file is called until it gets a name: "รูป 1 พ.ย. 2569 19:30". */
export function defaultFileName(kind: MediaKind, now: Date): string {
  return `${KIND_LABEL[kind]} ${formatThaiDate(now, true)}`;
}

/** "512 KB", "12 MB", "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${Number((bytes / GB).toFixed(1))} GB`;
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A download header for any name: plain for old clients, UTF-8 for the rest, never two lines. */
export function contentDisposition(name: string): string {
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}
