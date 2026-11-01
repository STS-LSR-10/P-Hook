"use client";

import { Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { MAX_NOTE_LENGTH, type NoteDto } from "@/lib/note";
import { formatThaiDate } from "@/lib/thai-date";

interface NotesResponse {
  items: NoteDto[];
  hasMore: boolean;
  count: number;
  limit: number;
  canAdd: boolean;
}

/** Reads `?q=` (the chat's "ค้นหาโน้ต" link opens the search already typed), which needs Suspense. */
export default function NotesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Notes />
    </Suspense>
  );
}

function Notes() {
  const { api } = useLiff();
  const initialQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [typed, setTyped] = useState(initialQuery);
  const first = useApi<NotesResponse>(
    `/api/notes${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  );
  // pages after the first one, loaded with "ดูเพิ่ม"
  const [more, setMore] = useState<NoteDto[]>([]);
  const [moreHasMore, setMoreHasMore] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<NoteDto | null>(null);

  // a new search or a reload starts from the first page again
  useEffect(() => {
    setMore([]);
    setMoreHasMore(null);
  }, [query, first.data]);

  const data = first.data;
  const items = data ? [...data.items, ...more] : [];
  const hasMore = moreHasMore ?? data?.hasMore ?? false;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      await api("/api/notes", { method: "POST", body: JSON.stringify({ body: draft }) });
      setDraft("");
      setNotice("จดโน้ตแล้ว");
      if (query) {
        setQuery("");
        setTyped("");
      } else {
        first.reload();
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "จดโน้ตไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function loadMore() {
    const last = items.at(-1);
    if (!last) return;
    setNotice(null);
    try {
      const params = new URLSearchParams({ before: last.createdAt });
      if (query) params.set("q", query);
      const page = await api<NotesResponse>(`/api/notes?${params.toString()}`);
      setMore((m) => [...m, ...page.items]);
      setMoreHasMore(page.hasMore);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ");
    }
  }

  async function remove(note: NoteDto) {
    if (!window.confirm("ลบโน้ตนี้ใช่ไหม?")) return;
    setNotice(null);
    try {
      await api(`/api/notes/${note.id}`, { method: "DELETE" });
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

  return (
    <main>
      <PageHeader
        title="โน้ต"
        right={
          <Link href="/files" className="text-sm font-semibold text-primary">
            ไฟล์ที่ฝากไว้
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        <form onSubmit={add} className={cardClass} aria-label="เพิ่มโน้ต">
          <label htmlFor="note-draft" className="sr-only">
            โน้ตใหม่
          </label>
          <textarea
            id="note-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            rows={3}
            placeholder="จดอะไรไว้ดี เช่น รหัสไวไฟ รายการซื้อของ ไอเดีย"
            className={`${fieldClass} h-auto resize-none py-3`}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="num text-xs text-muted">
              {draft.length}/{MAX_NOTE_LENGTH}
              {data ? ` · ใช้ไป ${data.count}/${data.limit} โน้ต` : ""}
            </p>
            <button
              type="submit"
              disabled={saving || !draft.trim() || (data ? !data.canAdd : false)}
              className="h-11 rounded-2xl bg-primary px-5 text-sm font-semibold text-surface disabled:opacity-60"
            >
              {saving ? "กำลังจด…" : "จดโน้ต"}
            </button>
          </div>
          {data && !data.canAdd ? (
            <p className="text-xs text-warn">โน้ตเต็มแล้ว ลบอันเก่าหรืออัปเกรดแผนเพื่อเก็บเพิ่ม</p>
          ) : null}
        </form>

        <form onSubmit={search} role="search" className="flex gap-2">
          <label htmlFor="note-search" className="sr-only">
            ค้นหาโน้ต
          </label>
          <input
            id="note-search"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={100}
            placeholder="ค้นหาในโน้ต"
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
            title={query ? "ไม่เจอโน้ตที่ค้นหา" : "ยังไม่มีโน้ต"}
            hint={
              query
                ? "ลองเปลี่ยนคำค้น"
                : 'จดที่ช่องด้านบน หรือพิมพ์ในแชท เช่น "โน้ต ซื้อนม รหัสไวไฟ 1234"'
            }
          />
        ) : (
          <>
            <ul className="space-y-3" aria-label="โน้ต">
              {items.map((n) => (
                <li key={n.id} className={cardClass}>
                  <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted">
                      {formatThaiDate(new Date(n.createdAt), true)}
                      {n.updatedAt !== n.createdAt ? " · แก้ไขแล้ว" : ""}
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(n)}
                        aria-label="แก้ไขโน้ต"
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(n)}
                        aria-label="ลบโน้ต"
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
                className="h-11 w-full rounded-2xl border border-border text-sm font-semibold"
              >
                ดูเพิ่ม
              </button>
            ) : null}
          </>
        )}
      </div>

      {editing ? (
        <EditSheet
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("แก้ไขแล้ว");
            first.reload();
          }}
        />
      ) : null}
    </main>
  );
}

function EditSheet({
  note,
  onClose,
  onSaved,
}: {
  note: NoteDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="แก้ไขโน้ต" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="note-edit" className="sr-only">
          เนื้อหาโน้ต
        </label>
        <textarea
          id="note-edit"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={6}
          className={`${fieldClass} h-auto resize-none py-3`}
        />
        <p className="num text-right text-xs text-muted">
          {body.length}/{MAX_NOTE_LENGTH}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </form>
    </Sheet>
  );
}
