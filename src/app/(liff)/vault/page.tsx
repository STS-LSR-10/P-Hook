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
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { SpaceSwitch } from "@/components/liff/space-switch";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { Logo } from "@/components/logo";
import { formatBytes, isViewableImage, MAX_NAME_LENGTH, type FileDto } from "@/lib/file";
import { firstUrl, MAX_NOTE_LENGTH, noteTitle, type NoteDto } from "@/lib/note";
import { looksSecret } from "@/lib/secret-text";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t as tr } from "@/lib/i18n";

/** In a group, `mine` says whether this person may change or remove it (always so for their own). */
type VaultNote = NoteDto & { mine?: boolean };
type VaultFile = FileDto & { mine?: boolean };
interface NotesResponse {
  items: VaultNote[];
  hasMore: boolean;
  canAdd: boolean;
  /** Their own only: the notes kept in their groups, which share the limit. */
  inGroups?: number;
}
/** Whether a note may be written now, and (their own only) how many of the limit groups take. */
interface Room {
  canAdd: boolean;
  inGroups: number;
}
const ROOM: Room = { canAdd: true, inGroups: 0 };
interface FilesResponse {
  items: VaultFile[];
  hasMore: boolean;
  /** The space is always the owner's: in a group a member gets null, and only `spaceLow`. */
  usedBytes: number | null;
  capacityBytes: number | null;
  /** A group's only: what the owner's groups take of it. */
  groupBytes?: number | null;
  spaceLow?: boolean;
  viewToken: string;
}

type Usage =
  Pick<FilesResponse, "usedBytes" | "capacityBytes" | "groupBytes" | "spaceLow"> | "failed";

/** Where the list's notes and files come from: the person's own, or a group's. */
interface Space {
  notes: string;
  files: string;
  group: boolean;
}
const spaceOf = (groupId: string | null): Space =>
  groupId
    ? { notes: `/api/groups/${groupId}/notes`, files: `/api/groups/${groupId}/files`, group: true }
    : { notes: "/api/notes", files: "/api/files", group: false };
const mayChange = (item: { mine?: boolean }) => item.mine !== false;

type Tab = "all" | "note" | "link" | "image" | "file";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: tr("ทั้งหมด") },
  { key: "note", label: tr("โน้ต") },
  { key: "link", label: tr("ลิงก์") },
  { key: "image", label: tr("รูป") },
  { key: "file", label: tr("ไฟล์") },
];
const EMPTY: Record<Tab, { title: string; hint: string }> = {
  all: {
    title: tr("ยังไม่มีอะไรในคลังเลยครับ"),
    hint: tr(
      "ส่งรูป ไฟล์ หรือพิมพ์คุยกับพี่ฮูกในแชทได้เลยนะครับ เดี๋ยวพี่ฮูกจะเก็บรวบรวมไว้ที่นี่เอง!",
    ),
  },
  note: { title: tr("ยังไม่มีโน้ต"), hint: tr('กดปุ่ม + หรือพิมพ์ในแชท เช่น "โน้ต ซื้อนม"') },
  link: { title: tr("ยังไม่มีลิงก์"), hint: tr("จดโน้ตที่มีลิงก์ แล้วจะขึ้นที่นี่ครับ") },
  image: { title: tr("ยังไม่มีรูป"), hint: tr('ส่งรูปในแชท แล้วพิมพ์ "เก็บไว้ให้หน่อย"') },
  file: { title: tr("ยังไม่มีไฟล์"), hint: tr('ส่งไฟล์ในแชท แล้วพิมพ์ "เก็บไว้ให้หน่อย"') },
};

const GROUP_EMPTY: Record<Tab, { title: string; hint: string }> = {
  all: {
    title: tr("กลุ่มนี้ยังไม่มีอะไรในคลัง"),
    hint: tr('พิมพ์ในกลุ่ม เช่น "โน้ต ซื้อน้ำแข็ง" หรือ "เก็บไฟล์" แล้วส่งไฟล์มา'),
  },
  note: {
    title: tr("กลุ่มนี้ยังไม่มีโน้ต"),
    hint: tr('กดปุ่ม + หรือพิมพ์ในกลุ่ม เช่น "โน้ต ซื้อน้ำแข็ง"'),
  },
  link: { title: tr("กลุ่มนี้ยังไม่มีลิงก์"), hint: tr("จดโน้ตที่มีลิงก์ แล้วจะขึ้นที่นี่ครับ") },
  image: {
    title: tr("กลุ่มนี้ยังไม่มีรูป"),
    hint: tr('พิมพ์ "เก็บรูป" ในกลุ่ม แล้วส่งรูปมาภายใน 5 นาที'),
  },
  file: {
    title: tr("กลุ่มนี้ยังไม่มีไฟล์"),
    hint: tr('พิมพ์ "เก็บไฟล์" ในกลุ่ม แล้วส่งไฟล์มาภายใน 5 นาที'),
  },
};

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

/**
 * Reads `?tab=`, `?q=`, `?open=` and `?g=` (a group's notes and files, from the links in a group or
 * the switch at the top), which needs Suspense.
 */
export default function VaultPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Vault />
    </Suspense>
  );
}

function Vault() {
  const { api, openExternal, status } = useLiff();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("tab");
  const requestedOpen = params.get("open") ?? "";
  const toOpen = UUID_RE.test(requestedOpen) ? requestedOpen : null;
  const requestedGroup = params.get("g") ?? "";
  const groupId = UUID_RE.test(requestedGroup) ? requestedGroup : null;
  const space = spaceOf(groupId);

  const [tab, setTab] = useState<Tab>(isTab(requested) ? requested : "all");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [typed, setTyped] = useState(search);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [room, setRoom] = useState<Room>(ROOM);
  // bumped after a change, so the list below loads again
  const [version, setVersion] = useState(0);
  const opened = useRef(false);

  const download = useCallback(
    async (id: string) => {
      setNotice(null);
      try {
        const { url } = await api<{ url: string }>(`${space.files}/${id}/link`, {
          method: "POST",
        });
        await openExternal(url);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : tr("เปิดไฟล์ไม่สำเร็จ"));
      }
    },
    [api, openExternal, space.files],
  );

  // the button on a card in the chat lands here; the address loses it, so a reload opens nothing
  useEffect(() => {
    if (!toOpen || opened.current || status !== "ready") return;
    opened.current = true;
    void download(toOpen);
    router.replace(groupId ? `/vault?g=${groupId}` : "/vault");
  }, [groupId, toOpen, status, download, router]);

  function switchSpace(next: string | null) {
    setNotice(null);
    setUsage(null);
    setRoom(ROOM);
    router.replace(next ? `/vault?g=${next}` : "/vault");
  }

  const done = useCallback((message: string) => {
    setAdding(false);
    setNotice(message);
    setVersion((v) => v + 1);
  }, []);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(typed.trim());
  }

  // in a group the space is still the owner's; a member sees only whether it is running out
  const bar =
    usage && usage !== "failed" && usage.usedBytes !== null
      ? {
          usedBytes: usage.usedBytes,
          capacityBytes: usage.capacityBytes ?? 0,
          groupBytes: usage.groupBytes ?? 0,
        }
      : null;
  const percent = bar
    ? Math.min(100, Math.round((bar.usedBytes / Math.max(1, bar.capacityBytes)) * 100))
    : 0;
  const spaceText =
    usage === null
      ? ""
      : usage === "failed"
        ? tr("โหลดไม่สำเร็จ")
        : bar
          ? `${formatBytes(bar.usedBytes)} / ${formatBytes(bar.capacityBytes)}`
          : usage.spaceLow
            ? tr("ของเจ้าของสมุดใกล้เต็มแล้ว")
            : tr("ใช้พื้นที่ของเจ้าของสมุด");

  return (
    <main className="-mb-24 flex min-h-screen flex-col bg-[#FAF7F2] pb-[calc(4rem+env(safe-area-inset-bottom))] text-stone-800">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-5">
        <h1 className="text-xl font-bold text-stone-900">{tr("คลัง | พี่ฮูก")}</h1>
        <SpaceSwitch groupId={groupId} onChange={switchSpace} />
      </header>

      <div className="space-y-2 px-4">
        <form onSubmit={submitSearch} role="search" className="flex gap-2">
          <label htmlFor="vault-search" className="sr-only">
            {tr("ค้นหาในคลัง")}
          </label>
          <input
            id="vault-search"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={100}
            placeholder={
              groupId ? tr("รหัสไวไฟ, เมนูร้าน, สัญญา") : tr("บิลค่าไฟ, รหัสคอม, ใบเสนอราคา")
            }
            className="h-11 min-w-0 flex-1 rounded-xl bg-[#EFEBE3] px-4 text-sm text-stone-800 placeholder:text-stone-500"
          />
          <button
            type="submit"
            aria-label={tr("ค้นหา")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2D7347] text-white"
          >
            <Search className="h-5 w-5" aria-hidden />
          </button>
        </form>
        {search ? (
          <p className="flex items-center gap-2 text-sm text-stone-600">
            {tr("ค้นหา “")}
            {search}”
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setTyped("");
              }}
              className="flex items-center gap-1 font-semibold text-[#2D7347]"
            >
              <X className="h-4 w-4" aria-hidden /> {tr("ล้าง")}
            </button>
          </p>
        ) : null}
      </div>

      <nav
        aria-label={tr("หมวดในคลัง")}
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
        {/* a new key starts clean: no old list, and an answer to an old request lands nowhere */}
        <VaultList
          key={`${groupId ?? ""}|${tab}|${search}|${version}`}
          space={space}
          tab={tab}
          search={search}
          onUsage={setUsage}
          onRoom={setRoom}
          onDone={done}
          onDownload={download}
          onOpenLink={openExternal}
        />
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] border-t border-stone-200 bg-[#FAF7F2] px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-900">
            <Archive className="h-4 w-4" aria-hidden /> {tr("พื้นที่เก็บไฟล์")}
          </p>
          <p className="num text-xs text-stone-700">{spaceText}</p>
          <button
            type="button"
            aria-label={groupId ? tr("เพิ่มโน้ตของกลุ่ม") : tr("เพิ่มโน้ต")}
            onClick={() => setAdding(true)}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2D7347] text-white"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {!groupId || bar ? (
          <div
            role="progressbar"
            aria-label={tr("พื้นที่ที่ใช้ไป")}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E8E2D6]"
          >
            <div className="h-full bg-[#2D7347]" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
        {groupId && bar ? (
          <p className="num mt-1 text-xs text-stone-600">
            {tr("ไฟล์ในกลุ่มของคุณ")} {formatBytes(bar.groupBytes)}{" "}
            {tr("· ใช้พื้นที่เดียวกับไฟล์ส่วนตัว")}
          </p>
        ) : null}
      </div>

      {adding ? (
        <AddNoteSheet
          space={space}
          room={room}
          onClose={() => setAdding(false)}
          onSaved={() => done(tr("จดแล้ว"))}
        />
      ) : null}
    </main>
  );
}

/** One space, tab and search. It is replaced, not changed, when any of them changes. */
function VaultList({
  space,
  tab,
  search,
  onUsage,
  onRoom,
  onDone,
  onDownload,
  onOpenLink,
}: {
  space: Space;
  tab: Tab;
  search: string;
  onUsage: (usage: Usage) => void;
  onRoom: (room: Room) => void;
  onDone: (message: string) => void;
  onDownload: (id: string) => Promise<void>;
  onOpenLink: (url: string) => Promise<void>;
}) {
  const { api } = useLiff();
  const [grid, setGrid] = useState(false);
  const [moreNotes, setMoreNotes] = useState<VaultNote[]>([]);
  const [moreFiles, setMoreFiles] = useState<VaultFile[]>([]);
  const [notesHaveMore, setNotesHaveMore] = useState<boolean | null>(null);
  const [filesHaveMore, setFilesHaveMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<VaultNote | null>(null);
  const [openFile, setOpenFile] = useState<VaultFile | null>(null);
  const [openPicture, setOpenPicture] = useState<VaultFile | null>(null);

  const q = search || null;
  const showsNotes = tab === "all" || tab === "note" || tab === "link";
  const showsFiles = tab === "all" || tab === "image" || tab === "file";
  const links = tab === "link" ? "1" : null;
  const kind = tab === "image" || tab === "file" ? tab : null;
  const notes = useApi<NotesResponse>(`${space.notes}${query({ q, links })}`);
  // always asked for: the space bar needs it on every tab
  const files = useApi<FilesResponse>(`${space.files}${query({ q, kind })}`);

  useEffect(() => {
    if (files.data) onUsage(files.data);
    else if (files.error) onUsage("failed");
  }, [files.data, files.error, onUsage]);
  useEffect(() => {
    if (notes.data) onRoom({ canAdd: notes.data.canAdd, inGroups: notes.data.inGroups ?? 0 });
  }, [notes.data, onRoom]);

  const noteItems = showsNotes ? [...(notes.data?.items ?? []), ...moreNotes] : [];
  const fileItems = showsFiles ? [...(files.data?.items ?? []), ...moreFiles] : [];
  const lastNote = noteItems[noteItems.length - 1];
  const lastFile = fileItems[fileItems.length - 1];
  const noteMore = showsNotes && (notesHaveMore ?? notes.data?.hasMore ?? false);
  const fileMore = showsFiles && (filesHaveMore ?? files.data?.hasMore ?? false);

  // Each list has its own pages, so one may reach far further back than the other. What is older than
  // the end of a list with more to come waits, or it would show above things not loaded yet.
  const ends = [noteMore ? lastNote : undefined, fileMore ? lastFile : undefined]
    .filter((item) => item !== undefined)
    .map((item) => new Date(item.createdAt).getTime());
  const cutoff = ends.length > 0 ? Math.max(...ends) : -Infinity;
  const entries = [
    ...noteItems.map((note) => ({ at: note.createdAt, note, file: null })),
    ...fileItems.map((file) => ({ at: file.createdAt, note: null, file })),
  ]
    .filter((entry) => new Date(entry.at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const notesFailed = showsNotes && !notes.data && !notes.loading ? notes.error : null;
  const filesFailed = showsFiles && !files.data && !files.loading ? files.error : null;
  const loading =
    (showsFiles && files.loading && !files.data) || (showsNotes && notes.loading && !notes.data);
  const shownLists = (showsNotes ? 1 : 0) + (showsFiles ? 1 : 0);
  const failedLists = (notesFailed ? 1 : 0) + (filesFailed ? 1 : 0);
  const failure = failedLists === shownLists ? (notesFailed ?? filesFailed) : null;
  const token = files.data?.viewToken ?? "";

  const reload = () => {
    if (notesFailed) notes.reload();
    if (filesFailed) files.reload();
    if (!notesFailed && !filesFailed) {
      notes.reload();
      files.reload();
    }
  };

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(null);
    try {
      const at = (item: { createdAt: string } | undefined) =>
        item ? new Date(item.createdAt).getTime() : -Infinity;
      if (noteMore && lastNote && at(lastNote) === cutoff) {
        const before = lastNote.createdAt;
        const page = await api<NotesResponse>(`${space.notes}${query({ q, links, before })}`);
        setMoreNotes((m) => [...m, ...page.items]);
        setNotesHaveMore(page.hasMore);
      }
      if (fileMore && lastFile && at(lastFile) === cutoff) {
        const before = lastFile.createdAt;
        const page = await api<FilesResponse>(`${space.files}${query({ q, kind, before })}`);
        setMoreFiles((m) => [...m, ...page.items]);
        setFilesHaveMore(page.hasMore);
      }
    } catch (err) {
      setMoreFailed(err instanceof Error ? err.message : tr("โหลดเพิ่มไม่สำเร็จ"));
    } finally {
      setLoadingMore(false);
    }
  }

  function openItem(file: FileDto) {
    if (isViewableImage(file.mimeType)) setOpenPicture(file);
    else setOpenFile(file);
  }

  const partial = failure
    ? null
    : notesFailed
      ? tr("โหลดโน้ตไม่สำเร็จ")
      : filesFailed
        ? tr("โหลดไฟล์ไม่สำเร็จ")
        : null;
  const empty = (space.group ? GROUP_EMPTY : EMPTY)[tab];

  return (
    <>
      {partial ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>{partial}</span>
          <button type="button" onClick={reload} className="font-semibold">
            {tr("ลองอีกครั้ง")}
          </button>
        </div>
      ) : null}

      {tab === "image" && entries.length > 0 ? (
        <div className="flex justify-end">
          <div className="flex rounded-lg bg-[#EAE3D6] p-0.5 text-xs">
            {[
              { on: false, label: tr("รายการ"), Icon: List },
              { on: true, label: tr("รูปเล็ก"), Icon: LayoutGrid },
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
      ) : entries.length === 0 && !partial ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Logo size={140} />
          <h2 className="mt-2 text-lg font-bold text-stone-950">
            {search ? tr("ไม่พบรายการที่ค้นหา") : empty.title}
          </h2>
          <p className="text-sm text-stone-700">
            {search ? tr("ลองเปลี่ยนคำค้นนะครับ") : empty.hint}
          </p>
        </div>
      ) : tab === "image" && grid ? (
        <ul aria-label={tr("รูปเล็ก")} className="grid grid-cols-3 gap-2">
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
        <ul aria-label={tr("รายการในคลัง")} className="space-y-2.5">
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

      {moreFailed ? (
        <p role="alert" className="text-sm text-expense">
          {moreFailed}
        </p>
      ) : null}
      {!loading && !failure && (noteMore || fileMore) ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="h-11 w-full rounded-2xl border border-stone-300 text-sm font-semibold text-[#2D7347] disabled:opacity-60"
        >
          {loadingMore ? tr("กำลังโหลด…") : tr("ดูเพิ่ม")}
        </button>
      ) : null}

      {openNote ? (
        <NoteSheet
          space={space}
          note={openNote}
          onClose={() => setOpenNote(null)}
          onDone={onDone}
          onOpenLink={(url) => void onOpenLink(url)}
        />
      ) : null}
      {openFile ? (
        <FileSheet
          space={space}
          file={openFile}
          onClose={() => setOpenFile(null)}
          onDone={onDone}
          onDownload={() => void onDownload(openFile.id)}
        />
      ) : null}
      {openPicture ? (
        <Lightbox
          file={openPicture}
          token={token}
          onClose={() => setOpenPicture(null)}
          onDownload={() => void onDownload(openPicture.id)}
          onMore={() => {
            setOpenFile(openPicture);
            setOpenPicture(null);
          }}
        />
      ) : null}
    </>
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
          {secret ? tr("ซ่อนเนื้อหาไว้ กดเพื่อดู") : noteTitle(note.body)}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600">
          {url ? tr("ลิงก์") : tr("โน้ต")} · {formatThaiDate(new Date(note.createdAt))}
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
  space,
  room,
  onClose,
  onSaved,
}: {
  space: Space;
  room: Room;
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
      await api(space.notes, { method: "POST", body: JSON.stringify({ body }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("จดไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={space.group ? tr("เพิ่มโน้ตของกลุ่ม") : tr("เพิ่มโน้ต")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="vault-new-note" className="sr-only">
          {tr("โน้ตใหม่")}
        </label>
        <textarea
          id="vault-new-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={5}
          placeholder={tr("จดอะไรไว้ดี เช่น รายการซื้อของ ลิงก์ ที่อยู่")}
          className={`${fieldClass} h-auto resize-none py-3`}
        />
        {space.group ? (
          <p className="text-xs text-stone-600">
            {tr("ทุกคนในกลุ่มเห็นโน้ตนี้ ไม่ควรจดรหัสผ่านสำคัญไว้")}
          </p>
        ) : null}
        {!room.canAdd ? (
          <p className="text-sm text-warn">
            {space.group
              ? tr("จดเพิ่มไม่ได้ตอนนี้ โน้ตของเจ้าของสมุดอาจเต็ม หรือสมุดกลุ่มปิดอยู่")
              : room.inGroups > 0
                ? tr(
                    "โน้ตเต็มแล้ว (นับรวมโน้ตในกลุ่มของคุณ {0} รายการ) ลบอันเก่าในคลังส่วนตัวหรือของกลุ่ม หรืออัปเกรดแผนเพื่อเก็บเพิ่ม",
                    room.inGroups,
                  )
                : tr("โน้ตเต็มแล้ว ลบอันเก่าหรืออัปเกรดแผนเพื่อเก็บเพิ่ม")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !room.canAdd || !body.trim()}
          className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
        >
          {busy ? tr("กำลังจด…") : tr("จดโน้ต")}
        </button>
      </form>
    </Sheet>
  );
}

function NoteSheet({
  space,
  note,
  onClose,
  onDone,
  onOpenLink,
}: {
  space: Space;
  note: VaultNote;
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
      () => api(`${space.notes}/${note.id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
      tr("แก้ไขแล้ว"),
      tr("บันทึกไม่สำเร็จ"),
    );
  };
  const remove = () => {
    if (!window.confirm(tr("ลบโน้ตนี้ใช่ไหม?"))) return;
    void run(
      () => api(`${space.notes}/${note.id}`, { method: "DELETE" }),
      tr("ลบแล้ว"),
      tr("ลบไม่สำเร็จ"),
    );
  };
  const editable = mayChange(note);

  return (
    <Sheet title={space.group ? tr("โน้ตของกลุ่ม") : tr("โน้ต")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label htmlFor="vault-note" className="sr-only">
          {tr("เนื้อหาโน้ต")}
        </label>
        <textarea
          id="vault-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={6}
          readOnly={!editable}
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
            <ExternalLink className="h-4 w-4" aria-hidden /> {tr("เปิดลิงก์")}
          </button>
        ) : null}
        {editable ? (
          <>
            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-60"
            >
              {busy ? tr("กำลังบันทึก…") : tr("บันทึก")}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-expense"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> {tr("ลบโน้ต")}
            </button>
          </>
        ) : (
          <p className="text-xs text-stone-600">
            {tr("แก้หรือลบได้เฉพาะคนที่จดโน้ตนี้ หรือเจ้าของสมุด")}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function FileSheet({
  space,
  file,
  onClose,
  onDone,
  onDownload,
}: {
  space: Space;
  file: VaultFile;
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
      () => api(`${space.files}/${file.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      tr("เปลี่ยนชื่อแล้ว"),
      tr("บันทึกไม่สำเร็จ"),
    );
  };
  const remove = () => {
    if (!window.confirm(tr('ลบไฟล์ "{0}" ใช่ไหม? ลบแล้วกู้คืนไม่ได้', file.name))) return;
    void run(
      () => api(`${space.files}/${file.id}`, { method: "DELETE" }),
      tr("ลบแล้ว"),
      tr("ลบไม่สำเร็จ"),
    );
  };

  return (
    <Sheet title={space.group ? tr("ไฟล์ของกลุ่ม") : tr("ไฟล์")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="num text-xs text-muted">
          {formatBytes(file.sizeBytes)} · {formatThaiDate(new Date(file.createdAt), true)}
        </p>
        <button
          type="button"
          onClick={onDownload}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-surface"
        >
          <Download className="h-4 w-4" aria-hidden /> {tr("เปิดไฟล์")}
        </button>
        {/* a group's file keeps the name it was kept with */}
        {!space.group ? (
          <>
            <label htmlFor="vault-file-name" className="block text-sm font-semibold">
              {tr("ชื่อไฟล์")}
            </label>
            <input
              id="vault-file-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              className={fieldClass}
            />
          </>
        ) : (
          <p className="break-words text-sm font-semibold">{file.name}</p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        {!space.group ? (
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="h-11 w-full rounded-2xl border border-border font-semibold text-primary disabled:opacity-60"
          >
            {busy ? tr("กำลังบันทึก…") : tr("บันทึกชื่อ")}
          </button>
        ) : null}
        {mayChange(file) ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-expense"
          >
            <Trash2 className="h-4 w-4" aria-hidden /> {tr("ลบไฟล์")}
          </button>
        ) : (
          <p className="text-xs text-stone-600">
            {tr("ลบได้เฉพาะคนที่เก็บไฟล์นี้ หรือเจ้าของสมุด")}
          </p>
        )}
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
            aria-label={tr("ปิด")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex min-h-64 items-center justify-center bg-stone-950 p-3">
          {failed ? (
            <p className="text-sm text-stone-200">{tr("โหลดรูปไม่สำเร็จ ลองดาวน์โหลดแทนนะครับ")}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewUrl(file.id, token)}
              alt={file.name}
              onError={() => setFailed(true)}
              className="max-h-[60vh] max-w-full rounded-lg object-contain"
            />
          )}
        </div>
        <div className="flex gap-2 p-3">
          <button
            type="button"
            onClick={onDownload}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2D7347] text-sm font-semibold text-white"
          >
            <Download className="h-4 w-4" aria-hidden /> {tr("ดาวน์โหลด")}
          </button>
          <button
            type="button"
            onClick={onMore}
            className="h-11 rounded-xl bg-stone-200 px-4 text-sm font-semibold text-stone-800"
          >
            {tr("ชื่อ/ลบ")}
          </button>
        </div>
      </div>
    </div>
  );
}
