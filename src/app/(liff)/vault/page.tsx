"use client";

import {
  Archive,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  LayoutGrid,
  Link2,
  List,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { Logo } from "@/components/logo";
import { formatBytes, isViewableImage, MAX_NAME_LENGTH, type FileDto } from "@/lib/file";
import { firstUrl, MAX_NOTE_LENGTH, noteTitle, type NoteDto } from "@/lib/note";
import { looksSecret } from "@/lib/secret-text";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

interface NotesResponse {
  items: NoteDto[];
  hasMore: boolean;
  canAdd: boolean;
}
interface FilesResponse {
  items: FileDto[];
  hasMore: boolean;
  usedBytes: number;
  capacityBytes: number;
  viewToken: string;
}

type Tab = "all" | "note" | "link" | "image" | "file";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "note", label: "โน้ต" },
  { key: "link", label: "ลิงก์" },
  { key: "image", label: "รูป" },
  { key: "file", label: "ไฟล์" },
];
const isTab = (value: string | null): value is Tab => TABS.some((t) => t.key === value);

const UUID_RE = /^[0-9a-f-]{36}$/i;
const CARD = "rounded-2xl border border-[#E7DFD2] bg-[#F6EFE6] text-left";
const isPicture = (file: FileDto) => file.mimeType.startsWith("image/");
const viewUrl = (id: string, token: string, thumb = false) =>
  `/api/files/${id}/view?t=${encodeURIComponent(token)}${thumb ? "&size=thumb" : ""}`;

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Reads `?tab=`, `?q=` and `?open=` (the links from the chat), which needs Suspense. */
export default function VaultPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Vault />
    </Suspense>
  );
}

function Vault() {
  const { api, openExternal, status } = useLiff();
  const params = useSearchParams();
  const requested = params.get("tab");
  const requestedOpen = params.get("open") ?? "";
  const toOpen = UUID_RE.test(requestedOpen) ? requestedOpen : null;

  const [tab, setTab] = useState<Tab>(isTab(requested) ? requested : "all");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [typed, setTyped] = useState(search);
  const [grid, setGrid] = useState(false);
  const [moreNotes, setMoreNotes] = useState<NoteDto[]>([]);
  const [moreFiles, setMoreFiles] = useState<FileDto[]>([]);
  const [notesHaveMore, setNotesHaveMore] = useState<boolean | null>(null);
  const [filesHaveMore, setFilesHaveMore] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openNote, setOpenNote] = useState<NoteDto | null>(null);
  const [openFile, setOpenFile] = useState<FileDto | null>(null);
  const [openPicture, setOpenPicture] = useState<FileDto | null>(null);
  const opened = useRef(false);

  const q = search || null;
  const showsNotes = tab === "all" || tab === "note" || tab === "link";
  const showsFiles = tab === "all" || tab === "image" || tab === "file";
  const links = tab === "link" ? "1" : null;
  const kind = tab === "image" || tab === "file" ? tab : null;
  const notes = useApi<NotesResponse>(`/api/notes${query({ q, links })}`);
  // always asked for: the space bar needs it on every tab
  const files = useApi<FilesResponse>(`/api/files${query({ q, kind })}`);

  useEffect(() => {
    setMoreNotes([]);
    setNotesHaveMore(null);
  }, [notes.data]);
  useEffect(() => {
    setMoreFiles([]);
    setFilesHaveMore(null);
  }, [files.data]);

  const noteItems = showsNotes ? [...(notes.data?.items ?? []), ...moreNotes] : [];
  const fileItems = showsFiles ? [...(files.data?.items ?? []), ...moreFiles] : [];
  const entries = [
    ...noteItems.map((note) => ({ at: note.createdAt, note, file: null })),
    ...fileItems.map((file) => ({ at: file.createdAt, note: null, file })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const hasMore =
    (showsNotes && (notesHaveMore ?? notes.data?.hasMore ?? false)) ||
    (showsFiles && (filesHaveMore ?? files.data?.hasMore ?? false));
  const loading =
    (showsFiles && files.loading && !files.data) || (showsNotes && notes.loading && !notes.data);
  const failure =
    (showsFiles && !files.data && files.error) || (showsNotes && !notes.data && notes.error);
  const token = files.data?.viewToken ?? "";

  const reload = () => {
    notes.reload();
    files.reload();
  };

  const download = useCallback(
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
    void download(toOpen);
  }, [toOpen, status, download]);

  async function loadMore() {
    try {
      const lastNote = noteItems[noteItems.length - 1];
      const lastFile = fileItems[fileItems.length - 1];
      if (showsNotes && lastNote && (notesHaveMore ?? notes.data?.hasMore)) {
        const before = lastNote.createdAt;
        const page = await api<NotesResponse>(`/api/notes${query({ q, links, before })}`);
        setMoreNotes((m) => [...m, ...page.items]);
        setNotesHaveMore(page.hasMore);
      }
      if (showsFiles && lastFile && (filesHaveMore ?? files.data?.hasMore)) {
        const before = lastFile.createdAt;
        const page = await api<FilesResponse>(`/api/files${query({ q, kind, before })}`);
        setMoreFiles((m) => [...m, ...page.items]);
        setFilesHaveMore(page.hasMore);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ");
    }
  }

  function done(message: string) {
    setOpenNote(null);
    setOpenFile(null);
    setOpenPicture(null);
    setAdding(false);
    setNotice(message);
    reload();
  }

  function openItem(file: FileDto) {
    if (isViewableImage(file.mimeType)) setOpenPicture(file);
    else setOpenFile(file);
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(typed.trim());
  }

  const usage = files.data;
  const percent = usage
    ? Math.min(100, Math.round((usage.usedBytes / usage.capacityBytes) * 100))
    : 0;
  const pictureList = tab === "image" && grid;

  return (
    <main className="-mb-24 flex min-h-screen flex-col bg-[#FAF7F2] pb-[calc(4rem+env(safe-area-inset-bottom))] text-stone-800">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-5">
        <h1 className="text-xl font-bold text-stone-900">คลัง | พี่ฮูก</h1>
        <span className="rounded-full bg-[#E1F3DB] px-3 py-1 text-xs font-semibold text-[#2F672B]">
          ส่วนตัว
        </span>
      </header>

      <div className="space-y-2 px-4">
        <form onSubmit={submitSearch} role="search" className="flex gap-2">
          <label htmlFor="vault-search" className="sr-only">
            ค้นหาในคลัง
          </label>
          <input
            id="vault-search"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={100}
            placeholder="บิลค่าไฟ, รหัสคอม, ใบเสนอราคา"
            className="h-11 min-w-0 flex-1 rounded-xl bg-[#EFEBE3] px-4 text-sm text-stone-800 placeholder:text-stone-500"
          />
          <button
            type="submit"
            aria-label="ค้นหา"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2D7347] text-white"
          >
            <Search className="h-5 w-5" aria-hidden />
          </button>
        </form>
        {search ? (
          <p className="flex items-center gap-2 text-sm text-stone-600">
            ค้นหา “{search}”
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setTyped("");
              }}
              className="flex items-center gap-1 font-semibold text-[#2D7347]"
            >
              <X className="h-4 w-4" aria-hidden /> ล้าง
            </button>
          </p>
        ) : null}
      </div>

      <nav
        aria-label="หมวดในคลัง"
        className="mt-1 flex justify-between border-b border-stone-200 px-4"
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "border-b-2 px-2 py-2.5 text-sm",
              tab === key
                ? "border-stone-900 font-semibold text-stone-950"
                : "border-transparent text-stone-600",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-2.5 px-4 py-3">
        {notice ? (
          <p role="status" className="rounded-2xl bg-[#E1F3DB] px-4 py-2 text-sm text-[#2F672B]">
            {notice}
          </p>
        ) : null}

        {tab === "image" && entries.length > 0 ? (
          <div className="flex justify-end">
            <div className="flex rounded-lg bg-[#EAE3D6] p-0.5 text-xs">
              {[
                { on: false, label: "รายการ", Icon: List },
                { on: true, label: "รูปเล็ก", Icon: LayoutGrid },
              ].map(({ on, label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={grid === on}
                  onClick={() => setGrid(on)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-stone-700",
                    grid === on && "bg-white font-semibold text-stone-900",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <LoadingBlock rows={3} />
        ) : failure ? (
          <ErrorState message={failure} onRetry={reload} />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Logo size={140} />
            <h2 className="mt-2 text-lg font-bold text-stone-950">
              {search ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีอะไรในคลังเลยครับ"}
            </h2>
            <p className="text-sm text-stone-700">
              {search
                ? "ลองเปลี่ยนคำค้นนะครับ"
                : "ส่งรูป ไฟล์ หรือพิมพ์คุยกับพี่ฮูกในแชทได้เลยนะครับ เดี๋ยวพี่ฮูกจะเก็บรวบรวมไว้ที่นี่เอง!"}
            </p>
          </div>
        ) : pictureList ? (
          <ul aria-label="รูปเล็ก" className="grid grid-cols-3 gap-2">
            {fileItems.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  aria-label={file.name}
                  onClick={() => openItem(file)}
                  className="block aspect-square w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100"
                >
                  <Thumb file={file} token={token} className="h-full w-full" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul aria-label="รายการในคลัง" className="space-y-2.5">
            {entries.map(({ note, file }) =>
              note ? (
                <li key={`n-${note.id}`}>
                  <NoteRow note={note} onOpen={() => setOpenNote(note)} />
                </li>
              ) : file ? (
                <li key={`f-${file.id}`}>
                  <FileRow file={file} token={token} onOpen={() => openItem(file)} />
                </li>
              ) : null,
            )}
          </ul>
        )}

        {!loading && hasMore ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="h-11 w-full rounded-2xl border border-stone-300 text-sm font-semibold text-[#2D7347]"
          >
            ดูเพิ่ม
          </button>
        ) : null}
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] border-t border-stone-200 bg-[#FAF7F2] px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-900">
            <Archive className="h-4 w-4" aria-hidden /> พื้นที่เก็บไฟล์
          </p>
          {usage ? (
            <p className="num text-xs text-stone-700">
              {formatBytes(usage.usedBytes)} / {formatBytes(usage.capacityBytes)}
            </p>
          ) : null}
          <button
            type="button"
            aria-label="เพิ่มโน้ต"
            onClick={() => setAdding(true)}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2D7347] text-white"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div
          role="progressbar"
          aria-label="พื้นที่ที่ใช้ไป"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E8E2D6]"
        >
          <div className="h-full bg-[#2D7347]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {adding ? (
        <AddNoteSheet
          canAdd={notes.data?.canAdd ?? true}
          onClose={() => setAdding(false)}
          onSaved={() => done("จดแล้ว")}
        />
      ) : null}
      {openNote ? (
        <NoteSheet
          note={openNote}
          onClose={() => setOpenNote(null)}
          onDone={done}
          onOpenLink={(url) => void openExternal(url)}
        />
      ) : null}
      {openFile ? (
        <FileSheet
          file={openFile}
          onClose={() => setOpenFile(null)}
          onDone={done}
          onDownload={() => void download(openFile.id)}
        />
      ) : null}
      {openPicture ? (
        <Lightbox
          file={openPicture}
          token={token}
          onClose={() => setOpenPicture(null)}
          onDownload={() => void download(openPicture.id)}
          onMore={() => {
            setOpenFile(openPicture);
            setOpenPicture(null);
          }}
        />
      ) : null}
    </main>
  );
}

function NoteRow({ note, onOpen }: { note: NoteDto; onOpen: () => void }) {
  const secret = looksSecret(note.body);
  const url = firstUrl(note.body);
  const Icon = url ? Link2 : StickyNote;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(CARD, "flex w-full items-start gap-3 p-3.5")}
    >
      <span className="shrink-0 rounded-xl bg-emerald-100 p-2.5 text-emerald-800">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-stone-900">
          {secret ? "ซ่อนเนื้อหาไว้ กดเพื่อดู" : noteTitle(note.body)}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600">
          {url ? "ลิงก์" : "โน้ต"} · {formatThaiDate(new Date(note.createdAt))}
        </span>
      </span>
    </button>
  );
}

function FileRow({ file, token, onOpen }: { file: FileDto; token: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(CARD, "flex w-full items-center gap-3 p-3.5")}
    >
      <Thumb file={file} token={token} className="h-12 w-12 shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-stone-900">{file.name}</span>
        <span className="num mt-0.5 block text-xs text-stone-600">
          {formatBytes(file.sizeBytes)} · {formatThaiDate(new Date(file.createdAt))}
        </span>
      </span>
    </button>
  );
}

/** The small preview; an icon when there is none, or it does not load. */
function Thumb({ file, token, className }: { file: FileDto; token: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (file.hasThumb && token && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={viewUrl(file.id, token, true)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("object-cover", className)}
      />
    );
  }
  const Icon = isPicture(file) ? ImageIcon : file.mimeType.startsWith("video/") ? Video : FileText;
  return (
    <span className={cn("flex items-center justify-center bg-amber-100 text-amber-800", className)}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function AddNoteSheet({
  canAdd,
  onClose,
  onSaved,
}: {
  canAdd: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/notes", { method: "POST", body: JSON.stringify({ body }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "จดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="เพิ่มโน้ต" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="vault-new-note" className="sr-only">
          โน้ตใหม่
        </label>
        <textarea
          id="vault-new-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={5}
          placeholder="จดอะไรไว้ดี เช่น รายการซื้อของ ลิงก์ ที่อยู่"
          className={`${fieldClass} h-auto resize-none py-3`}
        />
        {!canAdd ? (
          <p className="text-sm text-warn">โน้ตเต็มแล้ว ลบอันเก่าหรืออัปเกรดแผนเพื่อเก็บเพิ่ม</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !canAdd || !body.trim()}
          className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
        >
          {busy ? "กำลังจด…" : "จดโน้ต"}
        </button>
      </form>
    </Sheet>
  );
}

function NoteSheet({
  note,
  onClose,
  onDone,
  onOpenLink,
}: {
  note: NoteDto;
  onClose: () => void;
  onDone: (message: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const { api } = useLiff();
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = firstUrl(note.body);

  async function run(task: () => Promise<unknown>, message: string, failed: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
      onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
      "แก้ไขแล้ว",
      "บันทึกไม่สำเร็จ",
    );
  };
  const remove = () => {
    if (!window.confirm("ลบโน้ตนี้ใช่ไหม?")) return;
    void run(() => api(`/api/notes/${note.id}`, { method: "DELETE" }), "ลบแล้ว", "ลบไม่สำเร็จ");
  };

  return (
    <Sheet title="โน้ต" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="vault-note" className="sr-only">
          เนื้อหาโน้ต
        </label>
        <textarea
          id="vault-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={6}
          className={`${fieldClass} h-auto resize-none py-3`}
        />
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        {url ? (
          <button
            type="button"
            onClick={() => onOpenLink(url)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border font-semibold text-primary"
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> เปิดลิงก์
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-expense"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> ลบโน้ต
        </button>
      </form>
    </Sheet>
  );
}

function FileSheet({
  file,
  onClose,
  onDone,
  onDownload,
}: {
  file: FileDto;
  onClose: () => void;
  onDone: (message: string) => void;
  onDownload: () => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<unknown>, message: string, failed: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
      onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api(`/api/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      "เปลี่ยนชื่อแล้ว",
      "บันทึกไม่สำเร็จ",
    );
  };
  const remove = () => {
    if (!window.confirm(`ลบไฟล์ "${file.name}" ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) return;
    void run(() => api(`/api/files/${file.id}`, { method: "DELETE" }), "ลบแล้ว", "ลบไม่สำเร็จ");
  };

  return (
    <Sheet title="ไฟล์" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="num text-xs text-muted">
          {formatBytes(file.sizeBytes)} · {formatThaiDate(new Date(file.createdAt), true)}
        </p>
        <button
          type="button"
          onClick={onDownload}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-surface"
        >
          <Download className="h-4 w-4" aria-hidden /> เปิดไฟล์
        </button>
        <label htmlFor="vault-file-name" className="block text-sm font-semibold">
          ชื่อไฟล์
        </label>
        <input
          id="vault-file-name"
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
          className="h-11 w-full rounded-2xl border border-border font-semibold text-primary disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึกชื่อ"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-expense"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> ลบไฟล์
        </button>
      </form>
    </Sheet>
  );
}

function Lightbox({
  file,
  token,
  onClose,
  onDownload,
  onMore,
}: {
  file: FileDto;
  token: string;
  onClose: () => void;
  onDownload: () => void;
  onMore: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/85 p-3"
    >
      <div className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-[#FAF7F2]">
        <div className="flex items-center justify-between gap-2 bg-[#F2ECE2] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-stone-900">{file.name}</p>
            <p className="num text-xs text-stone-600">
              {formatThaiDate(new Date(file.createdAt), true)} · {formatBytes(file.sizeBytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex min-h-64 items-center justify-center bg-stone-950 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewUrl(file.id, token)}
            alt={file.name}
            className="max-h-[60vh] max-w-full rounded-lg object-contain"
          />
        </div>
        <div className="flex gap-2 p-3">
          <button
            type="button"
            onClick={onDownload}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2D7347] text-sm font-semibold text-white"
          >
            <Download className="h-4 w-4" aria-hidden /> ดาวน์โหลด
          </button>
          <button
            type="button"
            onClick={onMore}
            className="h-11 rounded-xl bg-stone-200 px-4 text-sm font-semibold text-stone-800"
          >
            ชื่อ/ลบ
          </button>
        </div>
      </div>
    </div>
  );
}
