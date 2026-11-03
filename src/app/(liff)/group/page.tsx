"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { EmptyState, LoadingBlock } from "@/components/liff/states";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * The address the first cards in a group linked to (`?id=`, `?tab=`, `?open=`). A group's files and
 * reminders now live on the vault and reminders pages, switched to the group, so it sends people there.
 */
export default function GroupPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <ToGroupSpace />
    </Suspense>
  );
}

function ToGroupSpace() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const valid = UUID_RE.test(id);
  const open = params.get("open") ?? "";
  const target = !valid
    ? null
    : params.get("tab") === "reminders"
      ? `/reminders?g=${id}`
      : `/vault?g=${id}${UUID_RE.test(open) ? `&open=${open}` : ""}`;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) return <LoadingBlock rows={4} />;
  return (
    <main className="min-h-screen bg-[#FAF7F2] px-4 pt-10">
      <EmptyState
        title="ไม่พบกลุ่มนี้"
        hint='เปิดหน้านี้จากการ์ดในกลุ่ม LINE เช่น พิมพ์ "ไฟล์กลุ่ม" ในกลุ่ม'
      />
    </main>
  );
}
