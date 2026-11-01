import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";
import { VOICE_CANCELLED_TEXT, VOICE_UNAVAILABLE_TEXT } from "./messages";

const updateTransaction = vi.fn(async () => ({ id: "t1" }));
const getTransaction = vi.fn(async () => ({
  id: "t1",
  type: "expense",
  title: "กาแฟ",
  amount: "30.00",
  category_id: null,
  occurred_at: "2026-10-17T08:00:00Z",
  status: "pending_confirm",
  slip_id: null,
}));

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "plus",
    plan_expires_at: null,
  }),
  getTransaction: (...args: unknown[]) =>
    (getTransaction as unknown as (...a: unknown[]) => unknown)(...args),
  updateTransaction: (...args: unknown[]) =>
    (updateTransaction as unknown as (...a: unknown[]) => unknown)(...args),
}));

const handleVoiceMessage = vi.fn(async () => [{ type: "text", text: "from voice handler" }]);
vi.mock("./voice", () => ({
  handleVoiceMessage: (...args: unknown[]) =>
    (handleVoiceMessage as unknown as (...a: unknown[]) => unknown)(...args),
}));

const USER_ID = "U" + "a".repeat(32);
const audio = (duration = 3000): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: USER_ID },
  message: { type: "audio", id: "m1", duration },
});

function setup(withVoice: boolean) {
  const reply = vi.fn(async () => undefined);
  const limiter = vi.fn(async (bucket: string) => ({ allowed: bucket !== "", hits: 1, limit: 5 }));
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: limiter,
    ...(withVoice
      ? {
          voice: {
            fetchAudio: async () => ({ bytes: new Uint8Array(1), mimeType: "audio/mp4" }),
            transcriber: { name: "t", transcribe: async () => "x" },
          },
        }
      : {}),
  };
  return { deps, reply, limiter };
}

const repliedText = (reply: ReturnType<typeof vi.fn>) =>
  ((reply.mock.calls[0] as unknown as [string, { text?: string }[]])[1][0] ?? {}).text;

beforeEach(() => {
  updateTransaction.mockClear();
  handleVoiceMessage.mockClear();
});

describe("voice messages in handleEvent", () => {
  it("are rate limited in their own bucket", async () => {
    const { deps, limiter } = setup(true);
    await handleEvent(audio(), deps);
    expect(limiter.mock.calls[0]?.[0]).toBe("chat_voice");
  });

  it("go to the voice handler with the message id and duration", async () => {
    const { deps, reply } = setup(true);
    await handleEvent(audio(4200), deps);
    expect(handleVoiceMessage).toHaveBeenCalledTimes(1);
    const args = handleVoiceMessage.mock.calls[0] as unknown as unknown[];
    expect(args[2]).toEqual({ id: "m1", duration: 4200 });
    expect(args[3]).toBe(USER_ID);
    expect(repliedText(reply)).toBe("from voice handler");
  });

  it("get a polite no when no AI that can hear is configured", async () => {
    const { deps, reply } = setup(false);
    await handleEvent(audio(), deps);
    expect(handleVoiceMessage).not.toHaveBeenCalled();
    expect(repliedText(reply)).toBe(VOICE_UNAVAILABLE_TEXT);
  });

  it("the cancel button deletes the pending entry and says so in voice wording", async () => {
    const { deps, reply } = setup(true);
    await handleEvent(
      {
        type: "postback",
        replyToken: "rt",
        source: { type: "user", userId: USER_ID },
        postback: { data: "a=vx&id=t1" },
      },
      deps,
    );
    expect(updateTransaction).toHaveBeenCalledWith(expect.anything(), "u1", "t1", {
      status: "deleted",
    });
    expect(repliedText(reply)).toBe(VOICE_CANCELLED_TEXT);
  });
});

describe("the sorter for voice messages", () => {
  const sorterOf = () =>
    ((handleVoiceMessage.mock.calls[0] as unknown[] | undefined)?.[0] as { route?: unknown })
      ?.route;

  it("is passed on when the AI is set up", async () => {
    const { deps } = setup(true);
    deps.router = { name: "t", route: async () => ({}) };
    await handleEvent(audio(), deps);
    expect(sorterOf()).toBeTypeOf("function");
  });

  it("is left out without it", async () => {
    await handleEvent(audio(), setup(true).deps);
    expect(sorterOf()).toBeUndefined();
  });
});
