import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DueReminder } from "./user-reminder-repo";

let due: DueReminder[] = [];
vi.mock("./user-reminder-repo", () => ({ claimDueReminders: async () => due }));

import { runUserReminders } from "./user-reminder-run";

const NOW = new Date("2026-10-29T02:03:00Z");
const r = (over: Partial<DueReminder> = {}): DueReminder => ({
  id: "r1",
  userId: "u1",
  lineUserId: "U1",
  body: "จ่ายค่าไฟ",
  repeat: null,
  lineGroupId: null,
  groupOpen: false,
  ...over,
});
const sentText = (call: unknown[]) => ((call[1] as { text: string }[])[0] ?? { text: "" }).text;

beforeEach(() => {
  due = [];
});

describe("runUserReminders", () => {
  it("pushes each due reminder to its person", async () => {
    due = [r(), r({ id: "r2", lineUserId: "U2", body: "กินยา" })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    const out = await runUserReminders({} as SupabaseClient, push as never, NOW);
    expect(out).toEqual({ claimed: 2, sent: 2, errors: 0 });
    expect(push.mock.calls.map((c) => c[0])).toEqual(["U1", "U2"]);
    expect(sentText(push.mock.calls[0] ?? [])).toBe("⏰ เตือน: จ่ายค่าไฟ");
  });

  it("a repeating one says so, with where to cancel it", async () => {
    due = [r({ repeat: "daily" })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    await runUserReminders(
      {} as SupabaseClient,
      push as never,
      NOW,
      "https://liff.line.me/x/reminders",
    );
    expect(sentText(push.mock.calls[0] ?? [])).toBe(
      "⏰ เตือน: จ่ายค่าไฟ\n(ทุกวัน · ยกเลิกได้ที่ https://liff.line.me/x/reminders)",
    );
  });

  it("a group's reminder goes to the group, with no link to the owner's page", async () => {
    due = [r({ lineGroupId: "Cgroup", groupOpen: true, repeat: "weekly", body: "ประชุม" })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    const out = await runUserReminders({} as SupabaseClient, push as never, NOW, "https://x/r");
    expect(out.sent).toBe(1);
    expect(push.mock.calls[0]?.[0]).toBe("Cgroup");
    const sent = sentText(push.mock.calls[0] ?? []);
    expect(sent).toContain("⏰ เตือนกลุ่ม: ประชุม");
    expect(sent).not.toContain("https://");
  });

  it("a group the bot has left gets nothing", async () => {
    due = [r({ lineGroupId: "Cgone", groupOpen: false })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    const out = await runUserReminders({} as SupabaseClient, push as never, NOW);
    expect(push).not.toHaveBeenCalled();
    expect(out).toEqual({ claimed: 1, sent: 0, errors: 0 });
  });

  it("one failing push (a blocked account) does not stop the others, and is counted", async () => {
    due = [r(), r({ id: "r2", lineUserId: "U2" }), r({ id: "r3", lineUserId: "U3" })];
    const push = vi.fn(async (...args: unknown[]) => {
      if (args[0] === "U2") throw new Error("LINE push failed: 403");
    });
    const out = await runUserReminders({} as SupabaseClient, push as never, NOW);
    expect(out).toEqual({ claimed: 3, sent: 2, errors: 1 });
    expect(push).toHaveBeenCalledTimes(3);
  });

  it("does nothing when nothing is due", async () => {
    const push = vi.fn();
    expect(await runUserReminders({} as SupabaseClient, push as never, NOW)).toEqual({
      claimed: 0,
      sent: 0,
      errors: 0,
    });
    expect(push).not.toHaveBeenCalled();
  });
});
