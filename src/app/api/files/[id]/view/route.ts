import { apiError, guard } from "@/lib/api";
import { verifyViewToken } from "@/lib/auth/file-token";
import { getServerEnv } from "@/lib/env";
import { isViewableImage, thumbKey } from "@/lib/file";
import { getReadyFile } from "@/lib/file-repo";
import { getFileStore } from "@/lib/file-store";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/files/:id/view?t=&size=thumb — a kept picture for an <img>, or its preview. Only plain
 * picture types are ever shown inline; everything else goes through the download route.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const userId = await verifyViewToken(
      url.searchParams.get("t") ?? "",
      getServerEnv().SESSION_JWT_SECRET,
    );
    if (!userId) return apiError("ลิงก์หมดอายุ", 401);

    const preview = url.searchParams.get("size") === "thumb";
    const file = await getReadyFile(getAdminClient(), userId, id);
    if (!file || !(preview ? file.hasThumb : isViewableImage(file.mimeType))) {
      return apiError("ไม่พบรูปนี้", 404);
    }
    const key = preview ? thumbKey(file.r2Key) : file.r2Key;
    const object = await (await getFileStore())?.get(key);
    if (!object) return apiError("ไม่พบรูปนี้", 404);

    return new Response(object.body, {
      headers: {
        "Content-Type": preview ? "image/jpeg" : file.mimeType,
        "Content-Length": String(object.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
