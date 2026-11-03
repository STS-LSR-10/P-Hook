"use client";

import { Bell, Download, FileText, ImageIcon, Repeat, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

/** What the space bar under a group's files shows. */
export type GroupUsage = Pick<
  FilesResponse,
  "usedBytes" | "groupBytes" | "capacityBytes" | "spaceLow"
>;

const CARD = "rounded-2xl border border-[#E7DFD2] bg-[#F6EFE6] text-left";
const viewUrl = (id: string, token: string) =>
  `/api/files/${id}/view?t=${encodeURIComponent(token)}&size=thumb`;
function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * A LINE group's files, for its owner and its members (kept apart from anyone's own), with a search
 * and a kind. `toOpen` is a file a card in the group asked to open; `onOpened` is told once it was.
 * Replaced, not changed, when the search or kind changes.
 */
export function GroupFiles({
  groupId,
  q,
  kind,
  toOpen,
  onOpened,
  onUsage,
}: {
  groupId: string;
  q: string;
  kind: "image" | "file" | null;
  toOpen: string | null;
  onOpened: () => void;
  onUsage: (usage: GroupUsage | "failed") => void;
}) {
  const { api, openExternal, status } = useLiff();
  const files = useApi<FilesResponse>(`/api/groups/${groupId}/files${query({ q, kind })}`);
  const [more, setMore] = useState<GroupFile[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<GroupFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (files.data) onUsage(files.data);
    else if (files.error) onUsage("failed");
  }, [files.data, files.error, onUsage]);

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
    onOpened();
  }, [toOpen, status, download, onOpened]);

  async function remove(file: GroupFile) {
    if (!window.confirm(`ลบไฟล์ "${file.name}" ออกจากคลังกลุ่มใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await api(`/api/groups/${groupId}/files/${file.id}`, { method: "DELETE" });
      setOpen(null);
      setNotice("ลบแล้ว");
      setMore([]);
      setHasMore(null);
      files.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  }

  const items = [...(files.data?.items ?? []), ...more];
  const last = items[items.length - 1];
  const moreToCome = hasMore ?? files.data?.hasMore ?? false;

  async function loadMore() {
    if (loadingMore || !last) return;
    setLoadingMore(true);
    setNotice(null);
    try {
      const page = await api<FilesResponse>(
        `/api/groups/${groupId}/files${query({ q, kind, before: last.createdAt })}`,
      );
      setMore((m) => [...m, ...page.items]);
      setHasMore(page.hasMore);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  }

  if (files.loading && !files.data) return <LoadingBlock rows={3} />;
  if (files.error || !files.data) {
    return <ErrorState message={files.error ?? "โหลดไฟล์ไม่สำเร็จ"} onRetry={files.reload} />;
  }
  const { viewToken } = files.data;

  return (
    <div className="space-y-2.5">
      {notice ? (
        <p role="status" className="rounded-2xl bg-[#E1F3DB] px-4 py-2 text-sm text-[#2F672B]">
          {notice}
        </p>
      ) : null}
      {items.length === 0 ? (
        q ? (
          <EmptyState title="ไม่พบไฟล์ที่ค้นหา" hint="ลองเปลี่ยนคำค้นนะครับ" />
        ) : (
          <EmptyState
            title={kind === "image" ? "กลุ่มนี้ยังไม่มีรูป" : "กลุ่มนี้ยังไม่มีไฟล์"}
            hint='พิมพ์ "เก็บไฟล์" ในกลุ่ม แล้วส่งไฟล์หรือรูปมาภายใน 5 นาที'
          />
        )
      ) : (
        <ul aria-label="ไฟล์ของกลุ่ม" className="space-y-2.5">
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
      {moreToCome ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="h-11 w-full rounded-2xl border border-stone-300 text-sm font-semibold text-[#2D7347] disabled:opacity-60"
        >
          {loadingMore ? "กำลังโหลด…" : "ดูเพิ่ม"}
        </button>
      ) : null}
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

/** A LINE group's reminders, for its owner and its members. Each may cancel the ones they set. */
export function GroupReminders({ groupId }: { groupId: string }) {
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
      <p className="text-xs text-slate-600">
        เตือนของกลุ่มส่งเข้ากลุ่มตามเวลา และนับรวมกับเตือนส่วนตัวของเจ้าของสมุด
      </p>
      {notice ? (
        <p role="status" className="text-sm text-slate-700">
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
