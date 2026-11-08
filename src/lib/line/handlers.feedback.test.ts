import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const saved: { userId: string; plan: string; body: string; source: string }[] = [];
let allowed = true;

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan: "plus", plan_expires_at: null }),
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: "สมชาย",
    plan: "plus",
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: "full",
    budget_cycle: "monthly",
    cycle_start_day: 1,
    daily_budget: null,
    card_theme: "mint",
    bot_persona: "plain",
  }),
}));
vi.mock("@/lib/feedback-repo", () => ({
  addFeedback: async (_db: unknown, input: (typeof saved)[number]) => void saved.push(input),
}));

const say = (
  t: string,
  source: LineEvent["source"] = { type: "user", userId: "U" + "a".repeat(32) },
) =>
  ({
    type: "message",
    replyToken: "rt",
    source,
    message: { type: "text", id: "1", text: t },
  }) as LineEvent;

function setup() {
  const reply = vi.fn<(token: string, messages: Record<string, unknown>[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply: reply as unknown as HandlerDeps["reply"],
    getProfile: async () => null,
    now: () => new Date("2026-10-18T05:00:00Z"),
    // only the feedback ceiling says no: the ordinary chat limit stays open
    limit: async (bucket) => ({ allowed: allowed || bucket !== "feedback_day", hits: 1, limit: 5 }),
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls[0]?.[1] ?? []);

beforeEach(() => {
  saved.length = 0;
  allowed = true;
});

describe("เสนอแนะ in the chat", () => {
  it("saves what was written, with the plan, and thanks them", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เสนอแนะ อยากให้มีโหมดมืด"), deps);
    expect(saved).toEqual([
      { userId: "u1", plan: "plus", body: "อยากให้มีโหมดมืด", source: "line" },
    ]);
    expect(said(reply)).toContain("ขอบคุณที่ช่วยพี่ฮูกพัฒนา 🦉");
  });

  it("ข้อเสนอแนะ works too, and keeps the line breaks", async () => {
    const { deps } = setup();
    await handleEvent(say("ข้อเสนอแนะ ข้อ 1\nข้อ 2"), deps);
    expect(saved[0]?.body).toBe("ข้อ 1\nข้อ 2");
  });

  it("with nothing after it, says how to use it and saves nothing", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เสนอแนะ"), deps);
    expect(saved).toEqual([]);
    expect(said(reply)).toContain("เสนอแนะ อยากให้มี");
  });

  it("too long: asked to shorten, nothing saved", async () => {
    const { deps, reply } = setup();
    await handleEvent(say(`เสนอแนะ ${"ก".repeat(1001)}`), deps);
    expect(saved).toEqual([]);
    expect(said(reply)).toContain("1,000");
  });

  it("past the daily limit: nothing saved, and told to try again later", async () => {
    allowed = false;
    const { deps, reply } = setup();
    await handleEvent(say("เสนอแนะ อีกข้อ"), deps);
    expect(saved).toEqual([]);
    expect(said(reply)).toContain("ส่งข้อเสนอแนะครบวันนี้แล้ว");
  });

  it("is not a command inside a group", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เสนอแนะ ในกลุ่ม", { type: "group", groupId: "C1", userId: "Ua" }), deps);
    expect(saved).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });
});
