import { fileCapacity, fileDayLimit, formatBytes, isBlockedFile, cleanFileName } from "@/lib/file";
import type { FileDto } from "@/lib/file";
import {
  fileUsage,
  getMediaById,
  listFiles,
  rememberMedia,
  renameLatestFile,
  startFileWait,
  takeMediaById,
  takeRecentMedia,
  type RecentMedia,
} from "@/lib/file-repo";
import { saveFile, type SaveDeps, type SaveFailure } from "@/lib/file-save";
import { listNotes } from "@/lib/note-repo";
import { effectivePlan } from "@/lib/plan";
import type { UserRow } from "@/lib/repo";
import type { LineMessage } from "@/lib/types";
import { buildFileResults, buildFilesSavedCard } from "./file-flex";
import {
  FILE_ASK_KEEP_TEXT,
  FILE_ASK_PDF_TEXT,
  FILE_BLOCKED_TEXT,
  FILE_EXPIRED_TEXT,
  FILE_FAILED_TEXT,
  FILE_GONE_TEXT,
  FILE_NAMING_HINT_TEXT,
  FILE_NOT_FOUND_TEXT,
  FILE_SEND_NOW_TEXT,
  FILE_TOO_LARGE_TEXT,
  FILE_UNAVAILABLE_TEXT,
  fileDayLimitText,
  fileFullText,
  fileNotFoundText,
  fileRenamedText,
  fileSpaceText,
  noteListText,
  text,
} from "./messages";

export interface FileChatDeps extends SaveDeps {
  pageUrl: (path: string) => string | undefined;
}

type Media = Omit<RecentMedia, "id">;

const MAX_RESULTS = 5;
const LABEL_KEEP = "เก็บไฟล์";
const LABEL_READ = "อ่านเป็นรายการ";

const openUrlOf = (deps: FileChatDeps) => (id: string) => deps.pageUrl(`/files?open=${id}`);

function buttons(message: string, picks: [label: string, data: string][]): LineMessage {
  return {
    ...text(message),
    quickReply: {
      items: picks.map(([label, data]) => ({
        type: "action",
        action: { type: "postback", label, data, displayText: label },
      })),
    },
  };
}

async function failureText(
  reason: SaveFailure,
  user: UserRow,
  deps: FileChatDeps,
): Promise<LineMessage> {
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  switch (reason) {
    case "blocked":
      return text(FILE_BLOCKED_TEXT);
    case "too_large":
      return text(FILE_TOO_LARGE_TEXT);
    case "day_limit":
      return text(fileDayLimitText(fileDayLimit(plan)));
    case "full":
      return text(fileFullText(formatBytes(fileCapacity(plan))));
    case "gone":
      await startFileWait(deps.db, user.id, null, deps.now());
      return text(FILE_GONE_TEXT);
    case "unavailable":
      return text(FILE_UNAVAILABLE_TEXT);
    case "failed":
      return text(FILE_FAILED_TEXT);
  }
}

/** Keep these one after the other, then answer with what was kept and what went wrong. */
async function saveAll(
  deps: FileChatDeps,
  user: UserRow,
  items: { media: Media; name: string | null }[],
): Promise<LineMessage[]> {
  const saved: FileDto[] = [];
  let failure: SaveFailure | null = null;
  let unnamed = false;
  for (const { media, name } of items) {
    const result = await saveFile(deps, user, media, name);
    if (result.ok) {
      saved.push(result.file);
      unnamed ||= !name && !media.fileName;
    } else {
      failure ??= result.reason;
    }
  }
  const messages: LineMessage[] = [];
  if (saved.length > 0) {
    messages.push(
      buildFilesSavedCard({
        files: saved,
        openUrl: openUrlOf(deps),
        listUrl: deps.pageUrl("/files"),
        hint: unnamed ? FILE_NAMING_HINT_TEXT : undefined,
      }),
    );
  }
  if (failure) messages.push(await failureText(failure, user, deps));
  return messages;
}

/** The file that was being waited for. */
export function saveWaitingFile(
  deps: FileChatDeps,
  user: UserRow,
  media: Media,
  name: string | null,
): Promise<LineMessage[]> {
  return saveAll(deps, user, [{ media, name }]);
}

/** The question for a file already remembered. */
export const keepOffer = (id: string): LineMessage[] => [
  buttons(FILE_ASK_KEEP_TEXT, [[LABEL_KEEP, `a=fsv&id=${id}`]]),
];

/** Remember it and ask. Nothing is kept, and no AI is called, until a button is tapped. */
export async function offerToKeep(
  deps: FileChatDeps,
  user: UserRow,
  media: Media,
): Promise<LineMessage[]> {
  return keepOffer(await rememberMedia(deps.db, user.id, media, deps.now()));
}

/** A document in the chat: a PDF may also be read for its entries, which costs an AI call. */
export async function handleIncomingFile(
  deps: FileChatDeps,
  user: UserRow,
  media: Media,
): Promise<LineMessage[]> {
  if (media.fileName && isBlockedFile(media.fileName)) return [text(FILE_BLOCKED_TEXT)];
  if (!/\.pdf$/i.test(media.fileName?.trim() ?? "")) return offerToKeep(deps, user, media);
  const id = await rememberMedia(deps.db, user.id, media, deps.now());
  return [
    buttons(FILE_ASK_PDF_TEXT, [
      [LABEL_KEEP, `a=fsv&id=${id}`],
      [LABEL_READ, `a=frd&id=${id}`],
    ]),
  ];
}

/** "เก็บไว้": keep what was just sent, or wait for the next file when nothing was. */
export async function runFileSave(
  deps: FileChatDeps,
  user: UserRow,
  name: string | null,
): Promise<LineMessage[]> {
  const waiting = await takeRecentMedia(deps.db, user.id, deps.now());
  if (waiting.length === 0) {
    await startFileWait(deps.db, user.id, name, deps.now());
    return [text(FILE_SEND_NOW_TEXT)];
  }
  const numbered = name && waiting.length > 1;
  return saveAll(
    deps,
    user,
    waiting.map((media, i) => ({ media, name: numbered ? `${name} ${i + 1}` : name })),
  );
}

/** Files whose name holds `term`, and with `withNotes` the notes that do too. */
export async function runFileSearch(
  deps: FileChatDeps,
  user: UserRow,
  term: string,
  withNotes: boolean,
): Promise<LineMessage[]> {
  const [files, notes] = await Promise.all([
    listFiles(deps.db, user.id, { q: term, limit: MAX_RESULTS }),
    withNotes
      ? listNotes(deps.db, user.id, { q: term, limit: MAX_RESULTS })
      : { items: [], hasMore: false },
  ]);
  const messages: LineMessage[] = [];
  if (notes.items.length > 0) {
    const url = deps.pageUrl(`/notes?q=${encodeURIComponent(term)}`);
    messages.push(text(noteListText(`โน้ตที่มี "${term}"`, notes.items, url, notes.hasMore)));
  }
  if (files.items.length > 0) messages.push(buildFileResults(files.items, openUrlOf(deps)));
  return messages.length > 0 ? messages : [text(fileNotFoundText(term))];
}

/** "ไฟล์ของฉัน": the space used and the latest files. */
export async function runFileList(deps: FileChatDeps, user: UserRow): Promise<LineMessage[]> {
  const { items } = await listFiles(deps.db, user.id, { limit: MAX_RESULTS });
  if (items.length === 0) return [text(FILE_NOT_FOUND_TEXT)];
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  const used = await fileUsage(deps.db, user.id);
  return [
    text(fileSpaceText(formatBytes(used), formatBytes(fileCapacity(plan)), deps.pageUrl("/files"))),
    buildFileResults(items, openUrlOf(deps)),
  ];
}

export async function runFileRename(
  deps: FileChatDeps,
  user: UserRow,
  name: string,
): Promise<LineMessage[]> {
  const cleaned = cleanFileName(name);
  const file = cleaned ? await renameLatestFile(deps.db, user.id, cleaned) : null;
  return [text(file ? fileRenamedText(file.name) : FILE_NOT_FOUND_TEXT)];
}

/**
 * The buttons of a file. Keeping takes it, so a second tap does nothing; reading leaves it, because
 * the plan may refuse the reading and the file can still be kept.
 */
export async function handleFilePick(
  deps: FileChatDeps,
  user: UserRow,
  action: "fsv" | "frd",
  id: string,
  readPdf: (media: RecentMedia) => Promise<LineMessage[]>,
): Promise<LineMessage[]> {
  const media = await (action === "frd" ? getMediaById : takeMediaById)(
    deps.db,
    user.id,
    id,
    deps.now(),
  );
  if (!media) return [text(FILE_EXPIRED_TEXT)];
  if (action === "frd") return readPdf(media);
  return saveAll(deps, user, [{ media, name: null }]);
}
