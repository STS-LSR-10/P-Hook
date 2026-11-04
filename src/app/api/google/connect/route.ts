import { verifyGoogleLinkToken } from "@/lib/auth/google-token";
import { getServerEnv } from "@/lib/env";
import { googleConfig } from "@/lib/google/config";
import { getUserBasics } from "@/lib/google/link-repo";
import { googleAuthUrl } from "@/lib/google/oauth";
import { backToLine, googlePage } from "@/lib/google/pages";
import { t } from "@/lib/i18n";
import { getAdminClient } from "@/lib/supabase/admin";
import { runInZone } from "@/lib/zone-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google/connect?t= — opened in the phone's own browser (Google refuses to sign in inside
 * LINE). It first says whose พี่ฮูก the calendar will be linked to, so a link someone else sent is
 * seen for what it is, then goes on to Google's sign-in with the same token as the `state`.
 */
export async function GET(request: Request): Promise<Response> {
  const cfg = googleConfig();
  const tokenText = new URL(request.url).searchParams.get("t") ?? "";
  const claims = cfg
    ? await verifyGoogleLinkToken(tokenText, getServerEnv().SESSION_JWT_SECRET)
    : null;
  const user = claims ? await getUserBasics(getAdminClient(), claims.userId) : null;
  return runInZone(
    user?.timezone,
    () => {
      if (!cfg || !claims || !user) {
        return googlePage({
          title: t("ลิงก์นี้ใช้ไม่ได้แล้ว"),
          message: t("กลับไปที่ไลน์ แล้วกดปุ่ม เพิ่มลงปฏิทิน บนการ์ดเตือนอีกครั้งนะ"),
          action: backToLine(),
          ok: false,
          status: 400,
        });
      }
      return googlePage({
        title: t("เชื่อม Google Calendar"),
        message: t(
          "เชื่อมปฏิทิน Google กับพี่ฮูกของ {0} พี่ฮูกจะเพิ่มเตือนที่คุณเลือกลงปฏิทิน และแก้หรือลบตามเมื่อเปลี่ยนเตือน ขอสิทธิ์แค่จัดการกิจกรรมในปฏิทินเท่านั้น",
          user.displayName ?? t("คุณ"),
        ),
        warning: t(
          "ถ้ามีคนอื่นส่งลิงก์นี้มาให้ อย่ากดต่อ ลิงก์นี้ใช้ได้เฉพาะเจ้าของบัญชีไลน์ที่กดปุ่ม เพิ่มลงปฏิทิน เอง",
        ),
        action: { label: t("ลงชื่อเข้าใช้ด้วย Google"), href: googleAuthUrl(cfg, tokenText) },
      });
    },
    user?.currency,
    user?.locale,
  );
}
