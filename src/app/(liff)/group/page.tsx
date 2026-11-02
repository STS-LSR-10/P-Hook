"use client";

import { Bell, Download, FileText, ImageIcon, Repeat, Trash2, Video } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/liff/states";
import { formatBytes, type FileDto } from "@/lib/file";
import { formatThaiDate } from "@/lib/thai-date";
import { describeReminder, type ReminderDto } from "@/lib/user-reminder";
import { cn } from "@/lib/utils";

type GroupFile = FileDto & { mine: boolean };
interface FilesResponse {
  items: GroupFile[];
  hasMore: boolean;
  /** The space figures are the owner's: null for a member, who sees only `spaceLow`. */
  usedBytes: number | null;
  groupBytes: number | null;
  capacityBytes: number | null;
  spaceLow: boolean;
  isOwner: boolean;
  viewToken: string;
}
type GroupReminder = ReminderDto & { mine: boolean };
interface RemindersResponse {
  items: GroupReminder[];
  isOwner: boolean;
}

type Tab = "files" | "reminders";
const UUID_RE = /^[0-9a-f-]{36}$/i;
const CARD = "rounded-2xl border border-[#E7DFD2] bg-[#F6EFE6] text-left";
const viewUrl = (id: string, token: string) =>
  `/api/files/${id}/view?t=${encodeURIComponent(token)}&size=thumb`;

/** Reads `?id=` (the group), `?tab=` and `?open=` (the links from the cards in a group). */
export default function GroupPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <GroupSpace />
    </Suspense>
  );
}

/** A LINE group's files and reminders, for its owner and its members. Kept apart from anyone's own. */
function GroupSpace() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [tab, setTab] = useState<Tab>(params.get("tab") === "reminders" ? "reminders" : "files");
  const requestedOpen = params.get("open") ?? "";

  if (!UUID_RE.test(id)) {
    return (
      <main className="min-h-screen bg-[#FAF7F2] px-4 pt-10">
        <EmptyState
          title="ไม่พบกลุ่มนี้"
          hint='เปิดหน้านี้จากการ์ดในกลุ่ม LINE เช่น พิมพ์ "ไฟล์กลุ่ม" ในกลุ่ม'
        />
      </main>
    );
  }

  return (
    <main className="-mb-24 flex min-h-screen flex-col bg-[#FAF7F2] pb-[calc(4rem+env(safe-area-inset-bottom))] text-stone-800">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-5">
        <h1 className="text-xl font-bold text-stone-900">คลังกลุ่ม | พี่ฮูก</h1>
        <span className="rounded-full bg-[#FCE9C8] px-3 py-1 text-xs font-semibold text-[#7A4A06]">
          กลุ่ม
        </span>
      </header>
      <div role="tablist" aria-label="ส่วนของกลุ่ม" className="flex gap-2 px-4">
        {(
          [
            ["files", "ไฟล์"],
            ["reminders", "เตือน"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "h-10 flex-1 rounded-full text-sm font-semibold",
              tab === key ? "bg-[#2D7347] text-white" : "bg-[#EFE7DA] text-stone-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 px-4 pt-3">
        {tab === "files" ? (
          <GroupFiles groupId={id} toOpen={UUID_RE.test(requestedOpen) ? requestedOpen : null} />
        ) : (
          <GroupReminders groupId={id} />
        )}
      </div>
    </main>
  );
}

function GroupFiles({ groupId, toOpen }: { groupId: string; toOpen: string | null }) {
  const { api, openExternal, status } = useLiff();
  const router = useRouter();
  const files = useApi<FilesResponse>(`/api/groups/${groupId}/files`);
  const [open, setOpen] = useState<GroupFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opened = useRef(false);

  const download = useCallback(
    async (fileId: string) => {
      setNotice(null);
      try {
        const { url } = await api<{ url: string }>(`/api/groups/${groupId}/files/${fileId}/link`, {
          method: "POST",
        });
        await openExternal(url);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "เปิดไฟล์ไม่สำเร็จ");
      }
    },
    [api, openExternal, groupId],
  );

  // the button on a card in the group lands here; the address loses it, so a reload opens nothing
  useEffect(() => {
    if (!toOpen || opened.current || status !== "ready") return;
    opened.current = true;
    void download(toOpen);
    router.replace(`/group?id=${groupId}`);
  }, [toOpen, status, download, router, groupId]);

  async function remove(file: GroupFile) {
    if (!window.confirm(`ลบไฟล์ "${file.name}" ออกจากคลังกลุ่มใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await api(`/api/groups/${groupId}/files/${file.id}`, { method: "DELETE" });
      setOpen(null);
      setNotice("ลบแล้ว");
      files.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  }

  if (files.loading && !files.data) return <LoadingBlock rows={4} />;
  if (files.error || !files.data) {
    return <ErrorState message={files.error ?? "โหลดไฟล์ไม่สำเร็จ"} onRetry={files.reload} />;
  }
  const { items, usedBytes, groupBytes, capacityBytes, spaceLow, viewToken } = files.data;

  return (
    <div className="space-y-3">
      {usedBytes !== null && capacityBytes !== null ? (
        <SpaceCard used={usedBytes} group={groupBytes ?? 0} capacity={capacityBytes} />
      ) : spaceLow ? (
        <p role="status" className={cn(CARD, "p-3.5 text-sm text-[#7A4A06]")}>
          พื้นที่เก็บไฟล์ของเจ้าของสมุดใกล้เต็มแล้ว ลบไฟล์ที่ไม่ใช้ก่อนเก็บเพิ่มนะ
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-stone-700">
          {notice}
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title="กลุ่มนี้ยังไม่มีไฟล์"
          hint='พิมพ์ "เก็บไฟล์" ในกลุ่ม แล้วส่งไฟล์หรือรูปมาภายใน 5 นาที'
        />
      ) : (
        <ul className="space-y-2">
          {items.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => setOpen(file)}
                className={cn(CARD, "flex w-full items-center gap-3 p-3.5")}
              >
                <Thumb file={file} token={viewToken} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-stone-900">
                    {file.name}
                  </span>
                  <span className="num mt-0.5 block text-xs text-stone-600">
                    {formatBytes(file.sizeBytes)} · {formatThaiDate(new Date(file.createdAt))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <Sheet title="ไฟล์ของกลุ่ม" onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <p className="break-words text-sm font-semibold">{open.name}</p>
            <p className="num text-xs text-muted">
              {formatBytes(open.sizeBytes)} · {formatThaiDate(new Date(open.createdAt), true)}
            </p>
            <button
              type="button"
              onClick={() => void download(open.id)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-surface"
            >
              <Download className="h-4 w-4" aria-hidden /> เปิดไฟล์
            </button>
            {open.mine ? (
              <button
                type="button"
                onClick={() => void remove(open)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-expense"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> ลบไฟล์
              </button>
            ) : (
              <p className="text-xs text-stone-600">ลบได้เฉพาะคนที่เก็บไฟล์นี้ หรือเจ้าของสมุด</p>
            )}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/** The owner's space, which their own files share. */
function SpaceCard({ used, group, capacity }: { used: number; group: number; capacity: number }) {
  const percent = Math.min(100, Math.round((used / Math.max(1, capacity)) * 100));
  return (
    <section aria-label="พื้นที่" className={cn(CARD, "space-y-2 p-3.5")}>
      <p className="num text-sm font-semibold text-stone-900">
        พื้นที่ของคุณ ใช้ไป {formatBytes(used)} จาก {formatBytes(capacity)}
      </p>
      <div
        role="progressbar"
        aria-label="พื้นที่ที่ใช้"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-[#E7DFD2]"
      >
        <div className="h-full rounded-full bg-[#2D7347]" style={{ width: `${percent}%` }} />
      </div>
      <p className="num text-xs text-stone-600">
        ไฟล์ในกลุ่มของคุณ {formatBytes(group)} · ใช้พื้นที่เดียวกับไฟล์ส่วนตัว
      </p>
    </section>
  );
}

/** The small preview; an icon when there is none, or it does not load. */
function Thumb({ file, token }: { file: FileDto; token: string }) {
  const [failed, setFailed] = useState(false);
  const className = "h-12 w-12 shrink-0 rounded-xl";
  if (file.hasThumb && token && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={viewUrl(file.id, token)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("object-cover", className)}
      />
    );
  }
  const Icon = file.mimeType.startsWith("image/")
    ? ImageIcon
    : file.mimeType.startsWith("video/")
      ? Video
      : FileText;
  return (
    <span className={cn("flex items-center justify-center bg-amber-100 text-amber-800", className)}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function GroupReminders({ groupId }: { groupId: string }) {
  const { api } = useLiff();
  const reminders = useApi<RemindersResponse>(`/api/groups/${groupId}/reminders`);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(r: GroupReminder) {
    if (!window.confirm(`ยกเลิกเตือน "${r.body}" ของกลุ่มใช่ไหม?`)) return;
    setBusy(r.id);
    try {
      await api(`/api/groups/${groupId}/reminders/${r.id}`, { method: "DELETE" });
      setNotice("ยกเลิกแล้ว");
      reminders.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  if (reminders.loading && !reminders.data) return <LoadingBlock rows={3} />;
  if (reminders.error || !reminders.data) {
    return (
      <ErrorState message={reminders.error ?? "โหลดเตือนไม่สำเร็จ"} onRetry={reminders.reload} />
    );
  }
  const { items } = reminders.data;

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-600">
        เตือนของกลุ่มส่งเข้ากลุ่มตามเวลา และนับรวมกับเตือนส่วนตัวของเจ้าของสมุด
      </p>
      {notice ? (
        <p role="status" className="text-sm text-stone-700">
          {notice}
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title="กลุ่มนี้ยังไม่มีเตือน"
          hint='พิมพ์ในกลุ่ม เช่น "เตือน พรุ่งนี้ 9 โมง ประชุม"'
        />
      ) : (
        <ul className="space-y-2">
          {items.map((r) => {
            const Icon = r.repeat ? Repeat : Bell;
            return (
              <li key={r.id} className={cn(CARD, "flex items-start gap-3 p-3.5")}>
                <span className="shrink-0 rounded-xl bg-emerald-100 p-2.5 text-emerald-800">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-stone-900">
                    {r.body}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-600">
                    {describeReminder(new Date(r.remindAt), r.repeat)}
                  </span>
                </span>
                {r.mine ? (
                  <button
                    type="button"
                    onClick={() => void cancel(r)}
                    disabled={busy === r.id}
                    aria-label={`ยกเลิกเตือน ${r.body}`}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-expense disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
