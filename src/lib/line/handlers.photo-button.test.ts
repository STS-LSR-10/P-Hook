import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let style = "full";
let photoPrompt: boolean | undefined = true;
let plan = "plus";
const waits: unknown[][] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: style,
    budget_cycle: "monthly",
    cycle_start_day: 1,
    photo_prompt: photoPrompt,
  }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: `t-${String(input.title)}`,
    status: input.status,
    type: input.type,
    title: input.title,
    amount: "50.00",
    occurred_at: "2026-10-17T08:00:00Z",
    category_id: null,
    slip_id: null,
  }),
  categoryTotalSatang: async () => 5000,
}));
vi.mock("@/lib/photo-repo", async (original) => ({
  ...(await original<typeof import("@/lib/photo-repo")>()),
  countPhotosThisMonth: async () => 0,
  startPhotoWait: async (...a: unknown[]) => {
    waits.push(a);
  },
}));
vi.mock("@/lib/slip-repo", async (original) => ({
  ...(await original<typeof import("@/lib/slip-repo")>()),
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
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
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
type Sent = { type: string; text?: string; quickReply?: unknown };
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as Sent[];
const everything = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(sent(reply));

beforeEach(() => {
  style = "full";
  photoPrompt = true;
  plan = "plus";
  waits.length = 0;
});

describe("the แนบรูป button on the saved card (Pro and above)", () => {
  it("is a wide pill along the foot of the card and points at that entry", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50"), deps);
    const card = sent(reply)[0] as unknown as {
      contents: {
        footer: { contents: { type: string; action?: { data: string; displayText?: string } }[] };
      };
    };
    const pills = card.contents.footer.contents;
    const pill = pills[0];
    expect(pills).toHaveLength(1);
    expect(pill?.action?.data).toBe("a=ph&id=t-ข้าว");
    // the tap is silent: no "แนบรูป" message appears in the chat, only the camera / album buttons
    expect(pill?.action?.displayText).toBeUndefined();
    expect(everything(reply)).toContain("📎 แนบรูป");
  });

  it("nothing is asked after the save, and nothing waits for a photo until the button is tapped", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50"), deps);
    expect(sent(reply).some((m) => m.quickReply !== undefined)).toBe(false);
    expect(everything(reply)).not.toContain("อยากแนบรูป");
    expect(waits).toHaveLength(0);
  });

  it("a multi-entry message is one list card: edit and delete per row, no photo button", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 45\nข้าว 50"), deps);
    const json = everything(reply);
    expect(json).not.toContain("a=ph");
    expect(json).toContain("a=del&id=t-กาแฟ");
    expect(json).toContain("a=del&id=t-ข้าว");
  });

  it("is not on a Free card, nor when the person turned it off", async () => {
    plan = "free";
    const a = setup();
    await handleEvent(say("ข้าว 50"), a.deps);
    expect(everything(a.reply)).not.toContain("a=ph");
    plan = "plus";
    photoPrompt = false;
    const b = setup();
    await handleEvent(say("ข้าว 50"), b.deps);
    expect(everything(b.reply)).not.toContain("a=ph");
  });

  it("is not on the short card or when cards are off", async () => {
    style = "short";
    const a = setup();
    await handleEvent(say("ข้าว 50"), a.deps);
    expect(everything(a.reply)).not.toContain("a=ph");
    style = "off";
    const b = setup();
    await handleEvent(say("ข้าว 50"), b.deps);
    expect(everything(b.reply)).not.toContain("a=ph");
  });
});
