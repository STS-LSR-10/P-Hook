import { MAX_FILE_BYTES } from "@/lib/file";
import type { SlipImage } from "@/lib/ocr/provider";

const API_DATA = "https://api-data.line.me/v2/bot";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ImageError extends Error {
  constructor(
    readonly reason: "too_large" | "unsupported" | "download_failed" | "gone",
    message: string,
  ) {
    super(message);
  }
}

/** Download an image message's content from LINE (status only in errors, never the payload). */
export async function fetchLineImage(
  accessToken: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SlipImage> {
  const res = await fetchImpl(`${API_DATA}/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ImageError("download_failed", `LINE content failed: ${res.status}`);

  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!ALLOWED.has(mimeType)) throw new ImageError("unsupported", "unsupported image type");

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new ImageError("too_large", "image too large");

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageError("too_large", "image too large");
  return { bytes, mimeType };
}

export function extensionFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

/** Download any file message from LINE, for keeping (status only in errors, never the payload). */
export async function fetchLineFile(
  accessToken: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetchImpl(`${API_DATA}/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404 || res.status === 410) {
    throw new ImageError("gone", `LINE content gone: ${res.status}`);
  }
  if (!res.ok) throw new ImageError("download_failed", `LINE content failed: ${res.status}`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new ImageError("too_large", "file too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImageError("too_large", "file too large");
  if (bytes.byteLength === 0) throw new ImageError("download_failed", "empty file");
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim();
  return { bytes, mimeType: mimeType || "application/octet-stream" };
}

const MAX_PREVIEW_BYTES = 1024 * 1024;

/** LINE's small preview of a picture or video message. Throws when there is none. */
export async function fetchLinePreview(
  accessToken: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const res = await fetchImpl(
    `${API_DATA}/message/${encodeURIComponent(messageId)}/content/preview`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!res.ok) throw new ImageError("download_failed", `LINE preview failed: ${res.status}`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!ALLOWED.has(mimeType)) throw new ImageError("unsupported", "unsupported preview type");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) {
    throw new ImageError("too_large", "preview out of size");
  }
  return bytes;
}

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_MS = 30_000;

/** Download a voice message's audio from LINE (status only in errors, never the payload). */
export async function fetchLineAudio(
  accessToken: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetchImpl(`${API_DATA}/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ImageError("download_failed", `LINE content failed: ${res.status}`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) throw new ImageError("too_large", "audio too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new ImageError("too_large", "audio too large");
  if (bytes.byteLength === 0) throw new ImageError("download_failed", "empty audio");
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  return { bytes, mimeType };
}

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;

/** Why a PDF cannot be read, found from its bytes before any paid AI call. */
export type PdfProblem = "not_pdf" | "locked" | "too_many_pages";

/**
 * Cheap look at the file (no PDF library): the magic number, an /Encrypt entry (password-protected
 * statements) and a page count where the page objects are visible. Files that hide their page
 * objects in compressed streams count as unknown pages and pass; the AI provider has its own limit.
 */
export function inspectPdf(bytes: Uint8Array): PdfProblem | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!head.startsWith("%PDF-")) return "not_pdf";
  const body = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\b/.test(body)) return "locked";
  const pages = body.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  if (pages > MAX_PDF_PAGES) return "too_many_pages";
  return null;
}

/** Download a file message's content from LINE (status only in errors, never the payload). */
export async function fetchLinePdf(
  accessToken: string,
  messageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const res = await fetchImpl(`${API_DATA}/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ImageError("download_failed", `LINE content failed: ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES) throw new ImageError("too_large", "pdf too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ImageError("too_large", "pdf too large");
  return bytes;
}
