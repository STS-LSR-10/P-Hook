import { apiError, guard } from "@/lib/api";
import { verifyFileToken } from "@/lib/auth/file-token";
import { getServerEnv } from "@/lib/env";
import { contentDisposition } from "@/lib/file";
import { getReadyFile } from "@/lib/file-repo";
import { getFileStore } from "@/lib/file-store";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/files/:id/download?t= — the token is the whole credential. Always a download with a
 * sandbox policy, so an HTML file somebody kept can never run on this domain.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { id } = await params;
    const token = new URL(request.url).searchParams.get("t") ?? "";
    const claims = await verifyFileToken(token, getServerEnv().SESSION_JWT_SECRET);
    if (!claims) return apiError("ลิงก์หมดอายุ เปิดไฟล์จากคลังอีกครั้งนะ", 401);
    if (claims.fileId !== id) return apiError("ลิงก์นี้ไม่ถูกต้อง", 403);

    const file = await getReadyFile(getAdminClient(), claims.userId, id);
    const object = file ? await (await getFileStore())?.get(file.r2Key) : null;
    if (!file || !object) return apiError("ไม่พบไฟล์นี้", 404);

    return new Response(object.body, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(file.name),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
