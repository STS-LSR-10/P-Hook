import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let live: { txId: string } | null = null;
const answer = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => [
  { type: "text", text: "answered" },
]);

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "plus",
    plan_expires_at: null,
  }),
  getTransaction: async () => ({ id: "t1", status: "confirmed" }),
}));
vi.mock("@/lib/slip-ask-repo", () => ({ getLiveSlipAsk: async () => live }));
vi.mock("@/lib/slip-ask", async (original) => ({
  ...(await original<typeof import("@/lib/slip-ask")>()),
  answerSlipAsk: (...a: unknown[]) => answer(...a),
}));

const source = { type: "user", userId: "U" + "a".repeat(32) };
const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source,
  message: { type: "text", id: "m1", text: t },
});
const tap = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source,
  postback: { data },
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
const answered = (n: number) => (answer.mock.calls[n] as unknown[])[3];

beforeEach(() => {
  live = null;
  answer.mockClear();
});

describe("what was this transfer for?", () => {
  it("the next words typed answer it", async () => {
    live = { txId: "t1" };
    const { deps, reply } = setup();
    await handleEvent(say("ค่าข้าว"), deps);
    expect((answer.mock.calls[0] as unknown[])[2]).toBe("t1");
    expect(answered(0)).toEqual({ typed: "ค่าข้าว" });
    expect((reply.mock.calls[0]?.[1][0] as { text: string }).text).toBe("answered");
  });

  it("ข้าม leaves it as it is", async () => {
    live = { txId: "t1" };
    await handleEvent(say("ข้าม"), setup().deps);
    expect(answered(0)).toEqual({ skip: true });
  });

  it("an amount or nothing waiting means the message is an ordinary one", async () => {
    live = { txId: "t1" };
    await handleEvent(say("กาแฟ 50"), setup().deps).catch(() => undefined);
    live = null;
    await handleEvent(say("ค่าข้าว"), setup().deps).catch(() => undefined);
    expect(answer).not.toHaveBeenCalled();
  });

  it("a tap on a category, or on ข้าม, answers it too", async () => {
    await handleEvent(tap("a=sq&id=t1&c=c-food"), setup().deps);
    expect(answered(0)).toEqual({ categoryId: "c-food" });
    await handleEvent(tap("a=sqx&id=t1"), setup().deps);
    expect(answered(1)).toEqual({ skip: true });
  });
});
