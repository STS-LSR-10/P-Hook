import { Lock } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n";

/** Shown inside a section whose feature needs a paid plan (Pro or above). */
export function PlusLock({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-primary-soft px-3 py-2 text-sm text-primary">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">{t("สำหรับแผน Pro")}</span> · {children}{" "}
        <Link href="/upgrade" className="font-semibold underline">
          {t("ดูแผนอัปเกรด")}
        </Link>{" "}
        {t("หรือแลกวันใช้ด้วยเหรียญสะสมที่การ์ดแผนด้านบน")}
      </p>
    </div>
  );
}
