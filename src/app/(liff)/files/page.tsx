"use client";

import { Download, Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { formatBytes, MAX_NAME_LENGTH, type FileDto } from "@/lib/file";
import { formatThaiDate } from "@/lib/thai-date";

interface FilesResponse {
  items: FileDto[];
  hasMore: boolean;
  usedBytes: number;
  capacityBytes: number;
}

/** Reads `?open=` (the button on a card in the chat), which needs Suspense. */
export default function FilesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Files />
    </Suspense>
  );
}

function Files() {
  const { api, openExternal, status } = useLiff();
  const params = useSearchParams();
  const toOpen = params.get("open");
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const first = useApi<FilesResponse>(
    `/api/files${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  );
  const [more, setMore] = useState<FileDto[]>([]);
  const [moreHasMore, setMoreHasMore] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<FileDto | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    setMore([]);
    setMoreHasMore(null);
  }, [query, first.data]);

  const data = first.data;
  const items = [...(data?.items ?? []), ...more];
  const hasMore = moreHasMore ?? data?.hasMore ?? false;

  const open = useCallback(
    async (id: string) => {
      setNotice(null);
      try {
        const { url } = await api<{ url: string }>(`/api/files/${id}/link`, { method: "POST" });
        await openExternal(url);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "เปิดไฟล์ไม่สำเร็จ");
      }
    },
    [api, openExternal],
  );

  // the button on a card in the chat lands here
  useEffect(() => {
    if (!toOpen || opened.current || status !== "ready") return;
    opened.current = true;
    void open(toOpen);
  }, [toOpen, status, open]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    const q = query ? `&q=${encodeURIComponent(query)}` : "";
    try {
      const page = await api<FilesResponse>(
        `/api/files?before=${encodeURIComponent(last.createdAt)}${q}`,
      );
      setMore((m) => [...m, ...page.items]);
      setMoreHasMore(page.hasMore);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ");
    }
  }

  async function remove(file: FileDto) {
    if (!window.confirm(`ลบไฟล์ "${file.name}" ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    setNotice(null);
    try {
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      setNotice("ลบแล้ว");
      first.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  }

  function search(e: FormEvent) {
    e.preventDefault();
    setQuery(typed.trim());
  }

  const percent = data ? Math.min(100, Math.round((data.usedBytes / data.capacityBytes) * 100)) : 0;

  return (
    <main>
      <PageHeader
        title="ไฟล์"
        right={
          <Link href="/notes" className="text-sm font-semibold text-primary">
            โน้ต
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        {data ? (
          <section className={cardClass} aria-label="พื้นที่เก็บไฟล์">
            <p className="num text-sm">
              ใช้ไป {formatBytes(data.usedBytes)} จาก {formatBytes(data.capacityBytes)}
            </p>
            <div
              role="progressbar"
              aria-label="พื้นที่ที่ใช้ไป"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 overflow-hidden rounded-full bg-border"
            >
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
          </section>
        ) : null}

        <form onSubmit={search} role="search" className="flex gap-2">
          <label htmlFor="file-search" className="sr-only">
            ค้นหาไฟล์
          </label>
          <input
            id="file-search"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={100}
            placeholder="ค้นหาจากชื่อไฟล์"
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button
            type="submit"
            aria-label="ค้นหา"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-surface"
          >
            <Search className="h-5 w-5" aria-hidden />
          </button>
        </form>
        {query ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            ค้นหา “{query}”
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setTyped("");
              }}
              className="flex items-center gap-1 font-semibold text-primary"
            >
              <X className="h-4 w-4" aria-hidden /> ล้างการค้นหา
            </button>
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
            {notice}
          </p>
        ) : null}

        {first.loading && !data ? (
          <LoadingBlock rows={3} />
        ) : first.error && !data ? (
          <ErrorState message={first.error} onRetry={first.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            title={query ? "ไม่เจอไฟล์ที่ค้นหา" : "ยังไม่มีไฟล์"}
            hint={query ? "ลองเปลี่ยนคำค้น" : 'ส่งรูปหรือเอกสารในแชท แล้วพิมพ์ "เก็บไว้ให้หน่อย"'}
          />
        ) : (
          <>
            <ul className="space-y-3" aria-label="ไฟล์">
              {items.map((f) => (
                <li key={f.id} className={cardClass}>
                  <p className="break-words text-sm font-semibold">{f.name}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="num text-xs text-muted">
                      {formatBytes(f.sizeBytes)} · {formatThaiDate(new Date(f.createdAt))}
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void open(f.id)}
                        aria-label="เปิดไฟล์"
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-primary"
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(f)}
                        aria-label="เปลี่ยนชื่อไฟล์"
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(f)}
                        aria-label="ลบไฟล์"
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-expense"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="h-11 w-full rounded-2xl border border-border text-sm font-semibold text-primary"
              >
                ดูเพิ่ม
              </button>
            ) : null}
          </>
        )}
      </div>

      {editing ? (
        <RenameSheet
          file={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("เปลี่ยนชื่อแล้ว");
            first.reload();
          }}
        />
      ) : null}
    </main>
  );
}

function RenameSheet({
  file,
  onClose,
  onSaved,
}: {
  file: FileDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="เปลี่ยนชื่อไฟล์" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="file-name" className="text-sm font-semibold">
          ชื่อไฟล์
        </label>
        <input
          id="file-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          className={fieldClass}
        />
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </form>
    </Sheet>
  );
}
