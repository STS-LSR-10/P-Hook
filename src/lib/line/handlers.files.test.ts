import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentDecision } from "@/lib/ai/intent-router";
import { needsRouter } from "@/lib/ai/route-text";
import type { FileDto } from "@/lib/file";
import type { RecentMedia } from "@/lib/file-repo";
import { createMemoryStore } from "@/lib/file-store";
import type { SaveFailure, SaveResult } from "@/lib/file-save";
import { parseMessage } from "@/lib/parse/text-parser";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";
import {
  FILE_ASK_KEEP_TEXT,
  FILE_BLOCKED_TEXT,
  FILE_EXPIRED_TEXT,
  FILE_GONE_TEXT,
  FILE_NAME_ASK_TEXT,
  FILE_NAME_MANY_TEXT,
  FILE_NOT_FOUND_TEXT,
  FILE_SEND_NOW_TEXT,
  FILE_VIDEO_ELSEWHERE_TEXT,
  TOO_MANY_MESSAGES_TEXT,
  fileFullText,
  fileNotFoundText,
} from "./messages";

const ID = "11111111-1111-4111-8111-111111111111";
let photoWait: { tx_id: string; expired: boolean } | null = null;
let fileWait: { name: string | null } | null = null;
let recent: RecentMedia[] = [];
let byId: RecentMedia | null = null;
let peeked: RecentMedia | null = null;
let limited = "";
const forgotten: string[] = [];
const limitCalls: string[] = [];
let failure: SaveFailure | null = null;
let latest: FileDto | null = null;
let found: FileDto[] = [];
let notes: { id: string; body: string; createdAt: string; updatedAt: string }[] = [];
const fileQueries: (string | undefined)[] = [];
const noteQueries: (string | undefined)[] = [];
const saves: { media: Omit<RecentMedia, "id">; name: string | null }[] = [];
const remembered: Omit<RecentMedia, "id">[] = [];
const waits: (string | null)[] = [];
const renames: string[] = [];
const handleSlipImage = vi.fn();
const handlePdfMessage = vi.fn(async () => [{ type: "text", text: "pdf read" }]);
const handleVoiceMessage = vi.fn(async () => [{ type: "text", text: "voice" }]);
const handlePhotoImage = vi.fn(async () => [{ type: "text", text: "photo" }]);

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "free",
    plan_expires_at: null,
  }),
  getSettings: async () => ({ confirm_style: "off", budget_cycle: "monthly", cycle_start_day: 1 }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
}));
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async () => true,
  refundUsage: async () => undefined,
}));
vi.mock("@/lib/photo-repo", async (original) => ({
  ...(await original<typeof import("@/lib/photo-repo")>()),
  getLivePhotoWait: async () => photoWait,
}));
vi.mock("@/lib/photos", async (original) => ({
  ...(await original<typeof import("@/lib/photos")>()),
  handlePhotoImage: (...a: unknown[]) => handlePhotoImage(...(a as [])),
}));
vi.mock("@/lib/slips", async (original) => ({
  ...(await original<typeof import("@/lib/slips")>()),
  handleSlipImage: (...a: unknown[]) => handleSlipImage(...a),
}));
vi.mock("./pdf", async (original) => ({
  ...(await original<typeof import("./pdf")>()),
  handlePdfMessage: (...a: unknown[]) => handlePdfMessage(...(a as [])),
}));
vi.mock("./voice", () => ({
  handleVoiceMessage: (...a: unknown[]) => handleVoiceMessage(...(a as [])),
}));
vi.mock("@/lib/file-repo", () => ({
  takeFileWait: async () => {
    const w = fileWait;
    fileWait = null;
    return w;
  },
  startFileWait: async (_db: unknown, _u: string, name: string | null) => void waits.push(name),
  rememberMedia: async (_db: unknown, _u: string, media: Omit<RecentMedia, "id">) => {
    remembered.push(media);
    return ID;
  },
  takeRecentMedia: async () => {
    const r = recent;
    recent = [];
    return r;
  },
  forgetMedia: async (_db: unknown, _u: string, id: string) => void forgotten.push(id),
  getMediaById: async () => peeked,
  takeMediaById: async () => {
    const r = byId;
    byId = null;
    return r;
  },
  listFiles: async (_db: unknown, _u: string, o: { q?: string }) => {
    fileQueries.push(o.q);
    return { items: found, hasMore: false };
  },
  fileUsage: async () => 12 * 1024 * 1024,
  renameLatestFile: async (_db: unknown, _u: string, name: string) => {
    renames.push(name);
    return latest;
  },
}));
vi.mock("@/lib/note-repo", () => ({
  listNotes: async (_db: unknown, _u: string, o: { q?: string }) => {
    noteQueries.push(o.q);
    return { items: notes, hasMore: false };
  },
}));
vi.mock("@/lib/file-save", () => ({
  saveFile: async (
    _d: unknown,
    _u: unknown,
    media: Omit<RecentMedia, "id">,
    name: string | null,
  ): Promise<SaveResult> => {
    saves.push({ media, name });
    if (failure) return { ok: false, reason: failure };
    return {
      ok: true,
      file: {
        id: ID,
        name: name ?? media.fileName ?? "รูป 1 พ.ย. 2569 12:00",
        mimeType: "image/png",
        sizeBytes: 10,
        createdAt: "2026-11-01T05:00:00Z",
      },
    };
  },
}));

const USER = "U" + "a".repeat(32);
const base = { replyToken: "rt", source: { type: "user", userId: USER } };
const say = (t: string): LineEvent => ({
  ...base,
  type: "message",
  message: { type: "text", id: "1", text: t },
});
const picture: LineEvent = { ...base, type: "message", message: { type: "image", id: "img1" } };
const fileEvent = (fileName: string): LineEvent => ({
  ...base,
  type: "message",
  message: { type: "file", id: "f1", fileName, fileSize: 100 },
});
const video = (type = "line"): LineEvent => ({
  ...base,
  type: "message",
  message: { type: "video", id: "v1", contentProvider: { type } },
});
const tap = (data: string): LineEvent => ({ ...base, type: "postback", postback: { data } });

const route = vi.fn();
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-11-01T05:00:00Z"),
    limit: async (bucket) => {
      limitCalls.push(bucket);
      return { allowed: bucket !== limited, hits: 1, limit: 30 };
    },
    slip: {
      fetchImage: async () => ({ bytes: new Uint8Array(1), mimeType: "image/png" }),
      ocr: { name: "o", extract: async () => ({}) },
    } as unknown as HandlerDeps["slip"],
    pdf: { fetchPdf: async () => new Uint8Array(1), reader: { name: "r", read: async () => ({}) } },
    voice: {
      fetchAudio: async () => ({ bytes: new Uint8Array(1), mimeType: "audio/mp4" }),
      transcriber: { name: "t", transcribe: async () => "x" },
    },
    files: {
      fetchFile: async () => ({ bytes: new Uint8Array(1), mimeType: "image/png" }),
      store: createMemoryStore(),
    },
    router: { name: "t", route },
  };
  return { deps, reply };
}
type Sent = {
  text?: string;
  altText?: string;
  quickReply?: { items: { action: { data?: string; label?: string } }[] };
};
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as Sent[];
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply)
    .map((m) => m.text)
    .join("\n");
const buttons = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply).flatMap((m) => m.quickReply?.items.map((i) => i.action) ?? []);
const media = (messageId: string): RecentMedia => ({
  id: ID,
  messageId,
  kind: "image",
  fileName: null,
  fileSize: null,
});

beforeEach(() => {
  photoWait = null;
  fileWait = null;
  recent = [];
  byId = null;
  peeked = null;
  limited = "";
  forgotten.length = 0;
  limitCalls.length = 0;
  failure = null;
  latest = null;
  found = [];
  notes = [];
  fileQueries.length = 0;
  noteQueries.length = 0;
  saves.length = 0;
  remembered.length = 0;
  waits.length = 0;
  renames.length = 0;
  vi.clearAllMocks();
  route.mockReset();
  handleSlipImage.mockResolvedValue([{ type: "text", text: "slip read" }]);
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("a picture in the chat", () => {
  it("a waiting save beats the slip reader", async () => {
    fileWait = { name: "บัตร" };
    const { deps } = setup();
    await handleEvent(picture, deps);
    expect(saves[0]?.name).toBe("บัตร");
    expect(handleSlipImage).not.toHaveBeenCalled();
  });

  it("a photo wait beats the file wait", async () => {
    photoWait = { tx_id: "t1", expired: false };
    fileWait = { name: null };
    const { deps } = setup();
    await handleEvent(picture, deps);
    expect(handlePhotoImage).toHaveBeenCalledOnce();
    expect(saves).toEqual([]);
  });

  it("an image still reads as a slip, and is remembered", async () => {
    const { deps } = setup();
    await handleEvent(picture, deps);
    expect(handleSlipImage).toHaveBeenCalledOnce();
    expect(remembered[0]).toMatchObject({ messageId: "img1", kind: "image" });
  });

  it("a picture that is no slip offers to keep it", async () => {
    handleSlipImage.mockImplementation(async (d: { onNotSlip?: () => Promise<unknown[]> }) =>
      d.onNotSlip ? d.onNotSlip() : [],
    );
    const { deps, reply } = setup();
    await handleEvent(picture, deps);
    expect(said(reply)).toBe(FILE_ASK_KEEP_TEXT);
    expect(buttons(reply)[0]?.data).toBe(`a=fsv&id=${ID}`);
  });

  it("offering to keep it does not bring back a file already taken", async () => {
    handleSlipImage.mockImplementation(async (d: { onNotSlip?: () => Promise<unknown[]> }) =>
      d.onNotSlip ? d.onNotSlip() : [],
    );
    const { deps } = setup();
    await handleEvent(picture, deps);
    expect(remembered).toHaveLength(1);
  });

  it("a slip that was recorded is forgotten, so เก็บไว้ does not keep it again", async () => {
    handleSlipImage.mockImplementation(async (d: { onRecorded?: () => Promise<void> }) => {
      await d.onRecorded?.();
      return [{ type: "text", text: "slip read" }];
    });
    const { deps } = setup();
    await handleEvent(picture, deps);
    expect(forgotten).toEqual([ID]);
  });

  it("a saved picture says how to name it", async () => {
    fileWait = { name: null };
    const { deps, reply } = setup();
    await handleEvent(picture, deps);
    expect(JSON.stringify(sent(reply))).toContain("ชื่อไฟล์");
  });
});

describe("a file in the chat", () => {
  it("a PDF asks first and calls no AI", async () => {
    const { deps, reply } = setup();
    await handleEvent(fileEvent("งบ.pdf"), deps);
    expect(handlePdfMessage).not.toHaveBeenCalled();
    expect(buttons(reply).map((b) => [b.label, b.data])).toEqual([
      ["เก็บไฟล์", `a=fsv&id=${ID}`],
      ["อ่านเป็นรายการ", `a=frd&id=${ID}`],
    ]);
  });

  it("a document counts as a file arriving, not as a paid reading", async () => {
    const { deps } = setup();
    await handleEvent(fileEvent("งาน.docx"), deps);
    expect(limitCalls).toEqual(["chat_file"]);
  });

  it("reading counts against the paid limit", async () => {
    peeked = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
    const { deps } = setup();
    await handleEvent(tap(`a=frd&id=${ID}`), deps);
    expect(limitCalls).toContain("chat_pdf");
  });

  it("over the paid limit reading stops, and the file stays", async () => {
    peeked = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
    limited = "chat_pdf";
    const { deps, reply } = setup();
    await handleEvent(tap(`a=frd&id=${ID}`), deps);
    expect(handlePdfMessage).not.toHaveBeenCalled();
    expect(said(reply)).toBe(TOO_MANY_MESSAGES_TEXT);
  });

  it("reading leaves the file, so it can still be kept", async () => {
    peeked = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
    byId = peeked;
    const { deps } = setup();
    await handleEvent(tap(`a=frd&id=${ID}`), deps);
    expect(byId).not.toBeNull();
  });

  it("reading from a stale button says so", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap(`a=frd&id=${ID}`), deps);
    expect(said(reply)).toBe(FILE_EXPIRED_TEXT);
  });

  it("reading a PDF from its button", async () => {
    peeked = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
    const { deps } = setup();
    await handleEvent(tap(`a=frd&id=${ID}`), deps);
    expect(handlePdfMessage.mock.calls[0]).toContainEqual({
      id: "f1",
      fileName: "งบ.pdf",
      fileSize: 100,
    });
  });

  it("keeping a PDF from its button", async () => {
    byId = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
    const { deps } = setup();
    await handleEvent(tap(`a=fsv&id=${ID}`), deps);
    expect(saves[0]?.media.messageId).toBe("f1");
    expect(handlePdfMessage).not.toHaveBeenCalled();
  });

  it("a document offers to keep it", async () => {
    const { deps, reply } = setup();
    await handleEvent(fileEvent("งาน.docx"), deps);
    expect(buttons(reply).map((b) => b.label)).toEqual(["เก็บไฟล์"]);
  });

  it("a waiting save keeps a PDF without asking", async () => {
    fileWait = { name: null };
    const { deps } = setup();
    await handleEvent(fileEvent("งบ.pdf"), deps);
    expect(saves).toHaveLength(1);
  });

  it("a blocked file is refused", async () => {
    const { deps, reply } = setup();
    await handleEvent(fileEvent("a.exe"), deps);
    expect(said(reply)).toBe(FILE_BLOCKED_TEXT);
    expect(remembered).toEqual([]);
  });

  it("without the file store a PDF reads straight away, as before", async () => {
    const { deps } = setup();
    delete deps.files;
    await handleEvent(fileEvent("งบ.pdf"), deps);
    expect(handlePdfMessage).toHaveBeenCalledOnce();
  });
});

describe("a video or voice message", () => {
  it("a video offers to keep it", async () => {
    const { deps, reply } = setup();
    await handleEvent(video(), deps);
    expect(buttons(reply)[0]?.data).toBe(`a=fsv&id=${ID}`);
    expect(remembered[0]?.kind).toBe("video");
  });

  it("a video kept elsewhere is left alone", async () => {
    const { deps, reply } = setup();
    await handleEvent(video("external"), deps);
    expect(said(reply)).toBe(FILE_VIDEO_ELSEWHERE_TEXT);
    expect(remembered).toEqual([]);
  });

  it("voice still records money", async () => {
    const { deps } = setup();
    await handleEvent(
      { ...base, type: "message", message: { type: "audio", id: "a1", duration: 100 } },
      deps,
    );
    expect(handleVoiceMessage).toHaveBeenCalledOnce();
    expect(remembered).toEqual([]);
  });
});

describe("saying to keep it", () => {
  it('"เก็บไว้" keeps everything waiting', async () => {
    recent = [media("a"), media("b"), media("c")];
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไว้ให้หน่อย"), deps);
    expect(saves.map((s) => s.media.messageId)).toEqual(["a", "b", "c"]);
    expect(JSON.stringify(sent(reply))).toContain("เก็บแล้ว 3 ไฟล์");
    expect(route).not.toHaveBeenCalled();
  });

  it("a name is numbered across several files", async () => {
    recent = [media("a"), media("b")];
    const { deps } = setup();
    await handleEvent(say("เก็บไฟล์ บัตร"), deps);
    expect(saves.map((s) => s.name)).toEqual(["บัตร 1", "บัตร 2"]);
  });

  it("nothing waiting opens the 5 minute wait", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไฟล์ สัญญา"), deps);
    expect(waits).toEqual(["สัญญา"]);
    expect(said(reply)).toBe(FILE_SEND_NOW_TEXT);
  });

  it("a second tap saves nothing", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap(`a=fsv&id=${ID}`), deps);
    expect(said(reply)).toBe(FILE_EXPIRED_TEXT);
    expect(saves).toEqual([]);
  });

  it("a full space says so, with the plan's space", async () => {
    recent = [media("a")];
    failure = "full";
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไว้"), deps);
    expect(said(reply)).toBe(fileFullText("500 MB"));
  });

  it("the content is gone: asks to send it again, and waits", async () => {
    recent = [media("a")];
    failure = "gone";
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไว้"), deps);
    expect(said(reply)).toBe(FILE_GONE_TEXT);
    expect(waits).toEqual([null]);
  });

  it("a sorted message saves too", async () => {
    const decision: IntentDecision = {
      intent: "file_save",
      confidence: 0.9,
      reminderText: null,
      reminderQuery: null,
      whenText: null,
      searchTerm: null,
      fileName: "บัตร",
    };
    route.mockResolvedValue(decision);
    recent = [media("a")];
    const { deps } = setup();
    await handleEvent(say("ฝากรูปบัตรนี้ด้วยนะ"), deps);
    expect(saves[0]?.name).toBe("บัตร");
  });

  it("the file words reach the router", () => {
    const t = "เก็บรูปบัตร 2 ใบ";
    expect(needsRouter(t, parseMessage(t, new Date(), { currencies: true }))).toBe(true);
  });
});

describe("asking for a new name", () => {
  type Reply = {
    quickReply?: {
      items: { action: { label?: string; inputOption?: string; fillInText?: string } }[];
    };
  };
  const nameButton = (reply: ReturnType<typeof setup>["reply"]) =>
    (sent(reply) as Reply[]).at(-1)?.quickReply?.items[0]?.action;

  it("a kept picture offers a button that starts the command in the keyboard", async () => {
    recent = [media("a")];
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไว้"), deps);
    expect(nameButton(reply)).toMatchObject({
      type: "postback",
      label: "✏️ ตั้งชื่อใหม่",
      inputOption: "openKeyboard",
      fillInText: "ชื่อไฟล์ ",
    });
    expect(JSON.stringify(sent(reply))).toContain(JSON.stringify(FILE_NAME_ASK_TEXT).slice(1, -1));
  });

  it("a kept document is asked too, though it has a name", async () => {
    byId = { id: ID, messageId: "f1", kind: "file", fileName: "scan001.pdf", fileSize: 100 };
    const { deps, reply } = setup();
    await handleEvent(tap(`a=fsv&id=${ID}`), deps);
    expect(nameButton(reply)?.fillInText).toBe("ชื่อไฟล์ ");
  });

  it("a name already given is not asked for again", async () => {
    recent = [media("a")];
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไฟล์ บัตร"), deps);
    expect(nameButton(reply)).toBeUndefined();
  });

  it("several files point to the files page, since the command names one", async () => {
    recent = [media("a"), media("b")];
    const { deps, reply } = setup();
    await handleEvent(say("เก็บไว้"), deps);
    expect(nameButton(reply)).toBeUndefined();
    expect(JSON.stringify(sent(reply))).toContain(FILE_NAME_MANY_TEXT);
  });

  it("the button itself sends no reply", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap("a=compose-go"), deps);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("naming", () => {
  it("renames the latest file", async () => {
    latest = {
      id: ID,
      name: "รูปบัตร",
      mimeType: "image/png",
      sizeBytes: 1,
      createdAt: "2026-11-01T05:00:00Z",
    };
    const { deps, reply } = setup();
    await handleEvent(say("ชื่อไฟล์ รูปบัตร"), deps);
    expect(renames).toEqual(["รูปบัตร"]);
    expect(said(reply)).toContain("รูปบัตร");
  });

  it("says so when there is nothing to name", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ชื่อไฟล์ รูปบัตร"), deps);
    expect(said(reply)).toBe(FILE_NOT_FOUND_TEXT);
  });
});

describe("finding files", () => {
  const file = (n: number): FileDto => ({
    id: ID,
    name: `สัญญา ${n}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 10,
    createdAt: "2026-11-01T05:00:00Z",
  });
  const note = {
    id: "n1",
    body: "สัญญาเช่าหมดเดือนมีนา",
    createdAt: "2026-11-01T05:00:00Z",
    updatedAt: "2026-11-01T05:00:00Z",
  };
  const sortedSearch = (term: string): IntentDecision => ({
    intent: "search",
    confidence: 0.9,
    reminderText: null,
    reminderQuery: null,
    whenText: null,
    searchTerm: term,
    fileName: null,
  });
  const bubbles = (reply: ReturnType<typeof setup>["reply"]) => {
    const flex = sent(reply).find((m) => "contents" in m) as
      { contents: { type: string; contents: unknown[] } } | undefined;
    return flex?.contents.contents.length ?? 0;
  };

  it("หาไฟล์ finds by name and shows at most 5 cards", async () => {
    found = [1, 2, 3, 4, 5, 6].map(file);
    const { deps, reply } = setup();
    await handleEvent(say("หาไฟล์ สัญญา"), deps);
    expect(fileQueries).toEqual(["สัญญา"]);
    expect(noteQueries).toEqual([]);
    expect(bubbles(reply)).toBe(5);
    expect(JSON.stringify(sent(reply))).toContain(`/files?open=${ID}`);
  });

  it("kept-search answers with notes and files together", async () => {
    found = [file(1)];
    notes = [note];
    route.mockResolvedValue(sortedSearch("สัญญา"));
    const { deps, reply } = setup();
    await handleEvent(say("เรื่องสัญญาเช่าจดไว้ไหม"), deps);
    expect(fileQueries).toEqual(["สัญญา"]);
    expect(noteQueries).toEqual(["สัญญา"]);
    expect(said(reply)).toContain("สัญญาเช่าหมดเดือนมีนา");
    expect(bubbles(reply)).toBe(1);
  });

  it("kept-search with notes only stays the note answer", async () => {
    notes = [note];
    route.mockResolvedValue(sortedSearch("สัญญา"));
    const { deps, reply } = setup();
    await handleEvent(say("เรื่องสัญญาเช่าจดไว้ไหม"), deps);
    expect(sent(reply)).toHaveLength(1);
    expect(said(reply)).toContain("สัญญาเช่าหมดเดือนมีนา");
  });

  it("says so when nothing is found", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("หาไฟล์ สัญญา"), deps);
    expect(said(reply)).toBe(fileNotFoundText("สัญญา"));
  });

  it("ไฟล์ของฉัน shows the latest with the space used", async () => {
    found = [file(1)];
    const { deps, reply } = setup();
    await handleEvent(say("ไฟล์ของฉัน"), deps);
    expect(said(reply)).toContain("ใช้ไป 12 MB จาก 500 MB");
    expect(bubbles(reply)).toBe(1);
  });

  it("ไฟล์ของฉัน with nothing kept says so", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ไฟล์ของฉัน"), deps);
    expect(said(reply)).toBe(FILE_NOT_FOUND_TEXT);
  });
});
