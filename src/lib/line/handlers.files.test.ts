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
  FILE_NOT_FOUND_TEXT,
  FILE_SEND_NOW_TEXT,
  FILE_VIDEO_ELSEWHERE_TEXT,
  fileFullText,
} from "./messages";

const ID = "11111111-1111-4111-8111-111111111111";
let photoWait: { tx_id: string; expired: boolean } | null = null;
let fileWait: { name: string | null } | null = null;
let recent: RecentMedia[] = [];
let byId: RecentMedia | null = null;
let failure: SaveFailure | null = null;
let latest: FileDto | null = null;
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
  takeMediaById: async () => {
    const r = byId;
    byId = null;
    return r;
  },
  renameLatestFile: async (_db: unknown, _u: string, name: string) => {
    renames.push(name);
    return latest;
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
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
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
  failure = null;
  latest = null;
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

  it("reading a PDF from its button", async () => {
    byId = { id: ID, messageId: "f1", kind: "file", fileName: "งบ.pdf", fileSize: 100 };
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
