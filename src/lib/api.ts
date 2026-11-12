import { t } from "@/lib/i18n";
import { log } from "@/lib/log";
import { withZoneScope } from "@/lib/zone-scope";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Error body shape: { error: string } with a polite Thai message. */
export function apiError(message: string, status: number): Response {
  // the message is written in Thai; the person reads it in their own language
  return json({ error: t(message) }, status);
}

export const SERVER_ERROR_TEXT = "ขออภัย ระบบสะดุดชั่วคราว ลองใหม่อีกครั้งนะ";

/** Wrap a handler so unexpected errors become a friendly 500 (message is logged without PII). */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    // the request runs in the person's zone once requireUser knows them
    return await withZoneScope(fn);
  } catch (error) {
    log.error("api_error", error);
    return apiError(SERVER_ERROR_TEXT, 500);
  }
}

/** The largest JSON body an API route reads (the biggest real one is a few kilobytes). */
export const MAX_JSON_BYTES = 100_000;

/**
 * Read a JSON body, but never more than `maxBytes` of it: an oversized body is refused before it is
 * parsed or checked, so it cannot be used to exhaust memory. null for too large, unreadable or not JSON.
 */
export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  try {
    // the header can be missing or wrong, so the bytes are counted as they arrive
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
