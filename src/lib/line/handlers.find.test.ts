import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let entryCount = 2;
let notes: { id: string; body: string; createdAt: string; updatedAt: string }[] = [];
let files: {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  hasThumb: boolean;
}[] = [];
let searchBroken = false;
let notesBroken = false;
const noteQueries: string[] = [];
const asked: string[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/search", async (original) => ({
  ...(await original<typeof import("@/lib/search")>()),
  loadSearchTotals: async () => {
    asked.push("entries");
    if (searchBroken) throw new Error("db down");
    return { incomeSatang: 0, expenseSatang: 12_000, count: entryCount };
  },
  loadSearchItems: async () =>
    entryCount === 0
      ? []
      : [
          {
            id: "t1",
            type: "expense",
            title: "ค่าเช่าห้อง",
            amountSatang: 6000,
            occurredAt: "2026-10-10T05:00:00Z",
          },
        ],
}));
vi.mock("@/lib/note-repo", async (original) => ({
  ...(await original<typeof import("@/lib/note-repo")>()),
  listNotes: async (_db: unknown, _u: string, o: { q?: string }) => {
    asked.push("notes");
    noteQueries.push(o.q ?? "");
    if (notesBroken) throw new Error("db down");
    return { items: notes, hasMore: false };
  },
}));
vi.mock("@/lib/file-repo", async (original) => ({
  ...(await original<typeof import("@/lib/file-repo")>()),
  listFiles: async () => {
    asked.push("files");
    return { items: files, hasMore: false };
  },
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-11-04T03:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
    files: {
      fetchFile: async () => {
        throw new Error("x");
      },
      fetchPreview: async () => {
        throw new Error("x");
      },
      store: {} as never,
    },
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as Record<string, unknown>[];

beforeEach(() => {
  plan = "plus";
  entryCount = 2;
  notes = [
    {
      id: "n1",
      body: "สัญญาเช่าห้อง หมดเดือนมีนา",
      createdAt: "2026-10-01T05:00:00Z",
      updatedAt: "2026-10-01T05:00:00Z",
    },
  ];
  files = [
    {
      id: "f1",
      name: "สัญญาเช่า.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      createdAt: "2026-10-01T05:00:00Z",
      hasThumb: false,
    },
  ];
  searchBroken = false;
  notesBroken = false;
  noteQueries.length = 0;
  asked.length = 0;
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("ค้นหา finds entries, notes and files in one go", () => {
  it("answers with the entries card, the notes card and the files, in that order", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    const out = sent(reply);
    expect(out).toHaveLength(3);
    expect(JSON.stringify(out[0])).toContain("ค่าเช่าห้อง");
    expect(JSON.stringify(out[1])).toContain("สัญญาเช่าห้อง");
    expect(JSON.stringify(out[2])).toContain("สัญญาเช่า.pdf");
  });

  it("only what was found is sent", async () => {
    entryCount = 0;
    files = [];
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(sent(reply)).toHaveLength(1);
    expect(JSON.stringify(sent(reply))).toContain("สัญญาเช่าห้อง");
  });

  it("nothing anywhere: says so in one line", async () => {
    entryCount = 0;
    notes = [];
    files = [];
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(sent(reply)).toHaveLength(1);
    expect(sent(reply)[0]?.text).toContain("ไม่พบรายการ โน้ต หรือไฟล์");
  });

  it("Free: notes and files as usual; the entries found are counted with a way to see them", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    const out = JSON.stringify(sent(reply));
    expect(out).toContain("พบ 2 รายการเงิน");
    expect(out).toContain("https://liff.line.me/1234-abcd/transactions");
    expect(out).toContain("สัญญาเช่าห้อง");
    expect(out).not.toContain('"ผลการค้นหา"');
  });

  it("entries that cannot be searched right now do not stop the notes and files", async () => {
    searchBroken = true;
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(JSON.stringify(sent(reply))).toContain("สัญญาเช่าห้อง");
  });

  it("a search that could not be done says so, never 'nothing found'", async () => {
    searchBroken = true;
    notesBroken = true;
    files = [];
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(sent(reply)[0]?.text).toContain("ค้นหาไม่ได้ตอนนี้");
    expect(sent(reply)[0]?.text).not.toContain("ไม่พบ");
  });

  it("Free is offered the Pro trial with the count", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(JSON.stringify(sent(reply)[0])).toContain("ทดลอง Pro ฟรี 7 วัน");
  });

  it("a #tag is looked for in the notes as written", async () => {
    const { deps } = setup();
    await handleEvent(say("ค้นหา #ปาร์ตี้"), deps);
    expect(noteQueries).toEqual(["#ปาร์ตี้"]);
  });

  it("without the file store, notes and entries still come", async () => {
    const { deps, reply } = setup();
    delete deps.files;
    await handleEvent(say("ค้นหา เช่า"), deps);
    expect(asked).not.toContain("files");
    expect(sent(reply)).toHaveLength(2);
  });
});
