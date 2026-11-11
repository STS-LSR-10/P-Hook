"use client";

import { Crown, Flame, Gauge, Sparkles } from "lucide-react";
import Link from "next/link";
import { PLAN_LABEL } from "@/lib/plan";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import type { Me } from "./types";
import { t } from "@/lib/i18n";

/** Who is signed in, the plan with a way to its quotas, and the coins and streak. */
export function ProfileCard({ me }: { me: Me }) {
  const paid = me.plan !== "free";
  return (
    <section
      aria-label={t("โปรไฟล์และแผน")}
      className="space-y-4 rounded-3xl border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex items-center gap-3.5">
        <div className="relative shrink-0">
          {me.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.pictureUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-full object-cover ring-2 ring-primary-soft"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-primary-soft" aria-hidden />
          )}
          {paid ? (
            <span className="absolute -bottom-1 -right-1 flex items-center gap-0.5 rounded-full border border-surface bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">
              <Crown className="h-2.5 w-2.5" aria-hidden /> {PLAN_LABEL[me.plan]}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-base font-bold">
              {me.displayName ?? t("ผู้ใช้")}
            </h2>
            <Link
              href="/settings/quota"
              className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-[11px] font-semibold text-foreground"
            >
              <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden /> {t("โควตา")}
            </Link>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold",
                paid ? "bg-primary-soft text-primary" : "bg-background text-muted",
              )}
            >
              {t("แผน")} {PLAN_LABEL[me.plan]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {paid && me.planExpiresAt
              ? t("ใช้ได้ถึง {0}", formatThaiDate(new Date(me.planExpiresAt)))
              : t("แผนฟรี ใช้ได้ตลอด")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-primary-soft p-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface"
          >
            <Sparkles className="h-5 w-5 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted">{t("ฮูกคอยน์")}</p>
            <p className="num text-xl font-bold leading-tight text-primary">{me.points}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-warn-soft p-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface"
          >
            <Flame className="h-5 w-5 text-expense" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted">{t("จดต่อเนื่อง")}</p>
            <p className="num text-xl font-bold leading-tight text-warn">
              {me.streak} <span className="text-xs font-normal text-muted">{t("วัน")}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
