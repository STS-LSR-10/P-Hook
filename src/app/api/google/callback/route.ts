import { verifyGoogleLinkToken } from "@/lib/auth/google-token";
import { getServerEnv } from "@/lib/env";
import { googleConfig } from "@/lib/google/config";
import { getUserBasics } from "@/lib/google/link-repo";
import { backToLine, googlePage } from "@/lib/google/pages";
import { addReminderToGoogle, linkGoogle } from "@/lib/google/sync";
import { t } from "@/lib/i18n";
import { log, safeMessage } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { getReminder } from "@/lib/user-reminder-repo";
import { runInZone } from "@/lib/zone-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google/callback?code=&state= — Google sends the person back here after the consent screen.
 * The state is the signed token from the connect page: it says who, and which reminder to add.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cfg = googleConfig();
  const claims = cfg
    ? await verifyGoogleLinkToken(
        url.searchParams.get("state") ?? "",
        getServerEnv().SESSION_JWT_SECRET,
      )
    : null;
  const db = getAdminClient();
  const user = claims ? await getUserBasics(db, claims.userId) : null;

  return runInZone(
    user?.timezone,
    async () => {
      if (!cfg || !claims || !user) {
        return googlePage({
          title: t("ลิงก์นี้ใช้ไม่ได้แล้ว"),
          message: t("กลับไปที่ไลน์ แล้วกดปุ่ม เพิ่มลงปฏิทิน บนการ์ดเตือนอีกครั้งนะ"),
          action: backToLine(),
          ok: false,
          status: 400,
        });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        return googlePage({
          title: t("ยังไม่ได้เชื่อม Google Calendar"),
          message: t("ไม่ได้ให้สิทธิ์ ก็ไม่เป็นไร เพิ่มลงปฏิทินในเครื่องแทนได้จากปุ่มบนการ์ดเตือน"),
          action: backToLine(),
          ok: false,
        });
      }
      try {
        const { email } = await linkGoogle(db, claims.userId, code, { cfg, fetch });
        const reminder = claims.reminderId
          ? await getReminder(db, claims.userId, claims.reminderId)
          : null;
        const added =
          reminder && reminder.status === "active"
            ? await addReminderToGoogle(db, claims.userId, reminder)
            : null;
        const who = email ?? "Google";
        return googlePage({
          title:
            added?.kind === "added"
              ? t("เพิ่มลง Google Calendar แล้ว")
              : t("เชื่อม Google Calendar แล้ว"),
          message:
            added?.kind === "added"
              ? t(
                  "{0} อยู่ในปฏิทินของ {1} แล้ว ถ้าแก้หรือยกเลิกเตือน ปฏิทินจะเปลี่ยนตามให้",
                  reminder?.body ?? "",
                  who,
                )
              : added
                ? t(
                    "เชื่อมกับ {0} แล้ว แต่ยังเพิ่มเตือนไม่สำเร็จ กลับไปกด เพิ่มลงปฏิทิน อีกครั้งนะ",
                    who,
                  )
                : t("เชื่อมกับ {0} แล้ว ครั้งต่อไปกด เพิ่มลงปฏิทิน แล้วเพิ่มได้ทันที", who),
          action: backToLine(),
          ok: added?.kind !== "failed",
        });
      } catch (error) {
        log.warn("google_link_failed", { reason: safeMessage(error) });
        return googlePage({
          title: t("เชื่อม Google Calendar ไม่สำเร็จ"),
          message: t("ลองใหม่อีกครั้งจากปุ่ม เพิ่มลงปฏิทิน บนการ์ดเตือนนะ"),
          action: backToLine(),
          ok: false,
          status: 502,
        });
      }
    },
    user?.currency,
    user?.locale,
  );
}
