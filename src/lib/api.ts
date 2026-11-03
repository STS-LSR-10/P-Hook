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
