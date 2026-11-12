import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "free";
let persona = "warm";

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
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
    confirm_style: "full",
    budget_cycle: "monthly",
    cycle_start_day: 1,
    card_theme: "mint",
    bot_persona: persona,
  }),
}));

const source = { type: "user" as const, userId: "U" + "a".repeat(32) };
const tap = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source,
  postback: { data },
});
const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source,
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
    now: () => new Date("2026-10-18T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const first = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? [])[0] as {
    type: string;
    contents?: { type: string };
    text?: string;
    quickReply?: unknown;
  };

beforeEach(() => {
  plan = "free";
  persona = "warm";
});

describe("the help flow in the chat", () => {
  it.each(["วิธีใช้งาน", "ช่วยเหลือ", "เมนู", "help", "?"])(
    "%s asks what they want to know",
    async (word) => {
      const { deps, reply } = setup();
      await handleEvent(say(word), deps);
      const m = first(reply);
      expect(m.type).toBe("text");
      expect(m.text).not.toContain("สงสัยตรงไหน");
      const chips = JSON.stringify(m.quickReply);
      expect(chips).toContain("a=help&t=record");
      expect(chips).toContain("a=help&t=shortcuts");
    },
  );

  it("the question follows the bot's manner when the person has set one (Pro)", async () => {
    plan = "plus";
    persona = "bestie";
    const { deps, reply } = setup();
    await handleEvent(say("วิธีใช้งาน"), deps);
    expect(first(reply).text).toContain("แก!");
    plan = "free";
    const free = setup();
    await handleEvent(say("วิธีใช้งาน"), free.deps);
    expect(first(free.reply).text).toContain("ครับ"); // Free always gets the polite default
  });

  it("choosing a topic shows its card, with the chips still under it", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap("a=help&t=summary"), deps);
    const m = first(reply);
    expect(m.type).toBe("flex");
    expect(JSON.stringify(m)).toContain("สรุปวันนี้");
    expect(JSON.stringify(m.quickReply)).toContain("a=help&t=wallet");
  });

  it("the card follows the plan, and an unknown topic just asks again", async () => {
    plan = "ultimate";
    const { deps, reply } = setup();
    await handleEvent(tap("a=help&t=debt"), deps);
    // an Elite member can tap the Elite rows
    expect(JSON.stringify(first(reply))).toContain(
      '"action":{"type":"message","label":"หนี้","text":"หนี้"}',
    );
    const again = setup();
    await handleEvent(tap("a=help&t=whatever"), again.deps);
    expect(first(again.reply).type).toBe("text");
  });

  it("a new friend gets the welcome card", async () => {
    const { deps, reply } = setup();
    await handleEvent({ type: "follow", replyToken: "rt", source }, deps);
    const m = first(reply);
    expect(m.type).toBe("flex");
    expect(JSON.stringify(m)).toContain("สวัสดี! เราคือพี่ฮูก");
  });

  it("a message the bot cannot read gets the short text plus a button to the guide", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("อะไรก็ไม่รู้"), deps);
    const m = first(reply);
    expect(m.type).toBe("text");
    expect(m.text).toContain("ยังไม่เข้าใจ");
    expect(JSON.stringify(m.quickReply)).toContain('"text":"วิธีใช้งาน"');
  });
});
