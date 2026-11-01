import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageError } from "./content";
import { handleVoiceMessage, type VoiceDeps } from "./voice";
import {
  VOICE_DAY_LIMIT_TEXT,
  VOICE_EMPTY_TEXT,
  VOICE_FAILED_TEXT,
  VOICE_TASTE_TEXT,
  VOICE_TOO_LONG_TEXT,
  voiceHeardText,
  voiceQuotaText,
} from "./messages";

const inserted: Record<string, unknown>[] = [];
// in-memory stand-in for the take_usage / refund_usage database functions
const counters = new Map<string, number>();
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const key = `${args.p_kind}|${args.p_month}`;
  if (fn === "take_usage") {
    const used = counters.get(key) ?? 0;
    if (used >= (args.p_limit as number)) return { data: false, error: null };
    counters.set(key, used + 1);
    return { data: true, error: null };
  }
  if (fn === "refund_usage") {
    counters.set(key, Math.max(0, (counters.get(key) ?? 0) - 1));
    return { data: null, error: null };
  }
  return { data: true, error: null }; // claim_upsell_card
};
const used = (kind: string, month = "2026-10-01") => counters.get(`${kind}|${month}`) ?? 0;

vi.mock("@/lib/repo", () => ({
  loadCategories: async () => [
    {
      id: "food",
      user_id: null,
      type: "expense",
      name: "อาหาร",
      keywords: ["กาแฟ", "ข้าว"],
      sort_order: 1,
      is_hidden: false,
      icon: null,
      color: null,
    },
    {
      id: "other",
      user_id: null,
      type: "expense",
      name: "อื่นๆ",
      keywords: [],
      sort_order: 9,
      is_hidden: false,
      icon: null,
      color: null,
    },
    {
      id: "salary",
      user_id: null,
      type: "income",
      name: "เงินเดือน",
      keywords: ["เงินเดือน"],
      sort_order: 1,
      is_hidden: false,
      icon: null,
      color: null,
    },
    {
      id: "inc-other",
      user_id: null,
      type: "income",
      name: "อื่นๆ",
      keywords: [],
      sort_order: 9,
      is_hidden: false,
      icon: null,
      color: null,
    },
  ],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => {
    inserted.push(input);
    return { id: `tx-${inserted.length}`, ...input };
  },
}));

const NOW = new Date("2026-10-17T08:00:00Z");
const ULTIMATE_USER = {
  id: "u1",
  line_user_id: "U1",
  display_name: null,
  plan: "ultimate",
  plan_expires_at: null,
} as const;
const FREE_USER = { ...ULTIMATE_USER, plan: "free" } as const;
const PROFESSIONAL_USER = { ...ULTIMATE_USER, plan: "plus" } as const;

function deps(over: Partial<VoiceDeps> & { heard?: string | Error } = {}): VoiceDeps & {
  fetchAudio: ReturnType<typeof vi.fn>;
} {
  const heard = over.heard ?? "กาแฟ 30 บาท";
  const fetchAudio = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/x-m4a" }));
  return {
    db: { rpc } as unknown as SupabaseClient,
    now: () => NOW,
    fetchAudio: over.fetchAudio ?? fetchAudio,
    transcriber: {
      name: "fake",
      transcribe: async () => {
        if (heard instanceof Error) throw heard;
        return heard;
      },
    },
    limit: over.limit,
    structurer: over.structurer,
  } as unknown as VoiceDeps & { fetchAudio: ReturnType<typeof vi.fn> };
}

const run = (
  d: VoiceDeps,
  user = ULTIMATE_USER,
  message: { id: string; duration?: number } = { id: "m1", duration: 4000 },
) => handleVoiceMessage(d, user as never, message, "U1");

const textOf = (m: unknown) => (m as { text?: string }).text;

beforeEach(() => {
  inserted.length = 0;
  counters.clear();
});

describe("handleVoiceMessage", () => {
  it("a Pro user can use voice, counted against the 20 a month", async () => {
    const d = deps();
    const out = await run(d, PROFESSIONAL_USER as never);
    expect(textOf(out[0])).toBe('ได้ยินว่า: "กาแฟ 30 บาท"');
    expect(used("voice")).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it("a Pro user past 20 a month is told so, and nothing is downloaded", async () => {
    counters.set("voice|2026-10-01", 20);
    const d = deps();
    const out = await run(d, PROFESSIONAL_USER as never);
    expect(textOf(out[0])).toBe(voiceQuotaText("plus", 20));
    expect(textOf(out[0])).toContain("Elite");
    expect(d.fetchAudio).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("Elite stops at the fair-use ceiling with its own wording", async () => {
    counters.set("voice|2026-10-01", 200);
    const d = deps();
    const out = await run(d, ULTIMATE_USER);
    expect(textOf(out[0])).toBe(voiceQuotaText("ultimate", 200));
    expect(textOf(out[0])).toContain("ต้นเดือนหน้า");
    expect(d.fetchAudio).not.toHaveBeenCalled();
  });

  it("a new month starts the count again", async () => {
    counters.set("voice|2026-10-01", 20);
    const d = deps();
    d.now = () => new Date("2026-11-02T08:00:00Z");
    const out = await run(d, PROFESSIONAL_USER as never);
    expect(textOf(out[0])).toBe('ได้ยินว่า: "กาแฟ 30 บาท"');
  });

  it("a Free user gets one free taste for life, then the upgrade card", async () => {
    const first = await run(deps(), FREE_USER as never);
    expect(textOf(first[0])).toBe('ได้ยินว่า: "กาแฟ 30 บาท"');
    expect(textOf(first[first.length - 1])).toBe(VOICE_TASTE_TEXT);
    expect(used("teaser_voice", "2000-01-01")).toBe(1);

    const d = deps();
    const second = await run(d, FREE_USER as never);
    expect(JSON.stringify(second)).toContain("จดด้วยเสียงสำหรับสมาชิก Pro");
    expect(d.fetchAudio).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });

  it("a failed read gives the use back (the free taste too)", async () => {
    await run(deps({ heard: new Error("down") }), FREE_USER as never);
    expect(used("teaser_voice", "2000-01-01")).toBe(0);
    await run(deps({ heard: "" }), PROFESSIONAL_USER as never);
    expect(used("voice")).toBe(0);
    const broken = deps({
      fetchAudio: vi.fn(async () => {
        throw new ImageError("download_failed", "x");
      }),
    });
    await run(broken, PROFESSIONAL_USER as never);
    expect(used("voice")).toBe(0);
  });

  it("a Pro voice note never reaches the long-sentence AI (that stays Elite)", async () => {
    const structure = vi.fn(async () => ({ entries: [] }));
    await run(
      deps({
        heard: "วันนี้ไปกินข้าวกับแฟนมา จ่ายไป 850 บาท เอาออกจากกระเป๋าเงินสดนะ",
        structurer: { name: "t", structure },
      }),
      PROFESSIONAL_USER as never,
    );
    expect(structure).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1); // the rules still read it
  });

  it("a long voice note is refused before downloading it", async () => {
    const d = deps();
    const out = await run(d, ULTIMATE_USER, { id: "m1", duration: 31_000 });
    expect(textOf(out[0])).toBe(VOICE_TOO_LONG_TEXT);
    expect(d.fetchAudio).not.toHaveBeenCalled();
  });

  it("stops at the daily ceiling without touching the AI", async () => {
    const limit = vi.fn(async () => ({ allowed: false, hits: 61, limit: 60 }));
    const d = deps({ limit });
    const out = await run(d);
    expect(limit).toHaveBeenCalledWith("voice_day", "U1", expect.objectContaining({ limit: 60 }));
    expect(textOf(out[0])).toBe(VOICE_DAY_LIMIT_TEXT);
    expect(d.fetchAudio).not.toHaveBeenCalled();
  });

  it("saves the entry as PENDING (never confirmed), tagged voice, and asks the person to check it", async () => {
    const out = await run(deps({ heard: "กาแฟ 30 บาท" }));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      status: "pending_confirm",
      source: "voice",
      type: "expense",
      title: "กาแฟ",
      amountSatang: 3000,
      categoryId: "food",
      rawText: "กาแฟ 30 บาท",
    });
    expect(textOf(out[0])).toBe('ได้ยินว่า: "กาแฟ 30 บาท"');
    const card = JSON.stringify(out[1]);
    expect(card).toContain("a=sc&id=tx-1"); // จดเลย
    expect(card).toContain("a=se&id=tx-1"); // เปลี่ยนหมวด
    expect(card).toContain("a=vx&id=tx-1"); // ยกเลิก
    expect(card).toContain("฿30");
  });

  it("understands income too", async () => {
    await run(deps({ heard: "เงินเดือน 20000" }));
    expect(inserted[0]).toMatchObject({
      type: "income",
      amountSatang: 2_000_000,
      categoryId: "salary",
    });
  });

  it("several entries in one note become several cards (max 3)", async () => {
    const out = await run(deps({ heard: "กาแฟ 30, ข้าว 50, น้ำ 10, ขนม 20" }));
    expect(inserted).toHaveLength(3);
    expect(out).toHaveLength(4); // heard text + 3 cards
  });

  it("tells what it heard when there is no amount, and saves nothing", async () => {
    const out = await run(deps({ heard: "สวัสดีครับวันนี้อากาศดี" }));
    expect(textOf(out[0])).toContain('ได้ยินว่า "สวัสดีครับวันนี้อากาศดี" แต่ไม่เจอจำนวนเงิน');
    expect(inserted).toHaveLength(0);
  });

  it("an empty transcript means no speech was heard", async () => {
    expect(textOf((await run(deps({ heard: "" })))[0])).toBe(VOICE_EMPTY_TEXT);
  });

  it("a failing transcription or download gives a friendly message and saves nothing", async () => {
    expect(
      textOf((await run(deps({ heard: new Error("gemini-audio request failed: 500") })))[0]),
    ).toBe(VOICE_FAILED_TEXT);
    const broken = deps({
      fetchAudio: vi.fn(async () => {
        throw new ImageError("download_failed", "x");
      }),
    });
    expect(textOf((await run(broken))[0])).toBe(VOICE_FAILED_TEXT);
    const big = deps({
      fetchAudio: vi.fn(async () => {
        throw new ImageError("too_large", "x");
      }),
    });
    expect(textOf((await run(big))[0])).toBe(VOICE_TOO_LONG_TEXT);
    expect(inserted).toHaveLength(0);
  });
});

describe("long spoken sentences", () => {
  const LONG = "วันนี้ไปกินข้าวกับแฟนมา จ่ายไป 850 บาท เอาออกจากกระเป๋าเงินสดนะ";
  const reply = { entries: [{ type: "expense", title: "กินข้าวกับแฟน", amount: 850 }] };
  const structure = vi.fn<(r: unknown) => Promise<unknown>>(async () => reply);
  const structurer = { name: "t", structure };

  it("are read by the AI first and still wait for the person's tap", async () => {
    structure.mockClear();
    const out = await run(deps({ heard: LONG, structurer }));
    expect(structure).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      title: "กินข้าวกับแฟน",
      amountSatang: 85_000,
      status: "pending_confirm",
      source: "voice",
    });
    expect(JSON.stringify(out)).toContain("ตรวจรายการจากเสียง");
  });

  it("fall back to the rules when the AI fails", async () => {
    structure.mockClear();
    structure.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    await run(deps({ heard: LONG, structurer }));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ amountSatang: 85_000, status: "pending_confirm" });
  });

  it("a short transcript never reaches the AI", async () => {
    structure.mockClear();
    await run(deps({ heard: "กาแฟ 30 บาท", structurer }));
    expect(structure).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ amountSatang: 3000 });
  });
});

describe("a voice message that is not money", () => {
  const voiceDeps = (heard: string, route: VoiceDeps["route"]): VoiceDeps => ({
    db: { rpc } as unknown as SupabaseClient,
    now: () => new Date("2026-10-17T08:00:00Z"),
    fetchAudio: async () => ({ bytes: new Uint8Array(1), mimeType: "audio/mp4" }),
    transcriber: { name: "t", transcribe: async () => heard },
    route,
  });
  const elite = {
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "ultimate",
    plan_expires_at: null,
  } as Parameters<typeof handleVoiceMessage>[1];
  const send = (deps: VoiceDeps) => handleVoiceMessage(deps, elite, { id: "m1" }, "U1");

  beforeEach(() => {
    inserted.length = 0;
    counters.clear();
  });

  it("is sorted like a typed one, and no entry is made", async () => {
    const route = vi.fn(async (_heard: string) => [
      { type: "text" as const, text: "ตั้งเตือนแล้ว" },
    ]);
    const said = await send(voiceDeps("เล่นเกมตอน 19:13 น.", route));
    expect(route.mock.calls[0]?.[0]).toBe("เล่นเกมตอน 19:13 น.");
    expect(inserted).toEqual([]);
    expect(said.map((m) => (m as { text?: string }).text)).toEqual([
      voiceHeardText("เล่นเกมตอน 19:13 น."),
      "ตั้งเตือนแล้ว",
    ]);
  });

  it("still waits for a tap when the sorter says it is money", async () => {
    const route = vi.fn(async () => null);
    await send(voiceDeps("กาแฟตอนเช้าบ่าย 3 แก้วละ 60", route));
    expect(route).toHaveBeenCalledOnce();
    expect(inserted[0]?.status).toBe("pending_confirm");
  });

  it("clear money does not spend a sorter use", async () => {
    const route = vi.fn(async () => null);
    await send(voiceDeps("กาแฟ 50", route));
    expect(route).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });
});
