import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DueReminder } from "./user-reminder-repo";

let due: DueReminder[] = [];
vi.mock("./user-reminder-repo", () => ({ claimDueReminders: async () => due }));
let targets = new Map<string, { groupId: string | null; mentions: unknown[] }>();
const late: unknown[] = [];
let purged = 0;
let targetsFail = false;
let usageFail = false;
vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => ({
    id: "g-from-line",
    lineGroupId: "Cg",
    ownerUserId: "u1",
    isActive: true,
  }),
}));
vi.mock("./group-reminder-repo", () => ({
  reminderTargets: async () => {
    if (targetsFail) throw new Error("db down");
    return targets;
  },
  addLateReminder: async (_db: unknown, input: unknown) => {
    late.push(input);
  },
  purgeLateReminders: async () => {
    purged += 1;
  },
}));
let pushUsed = 0;
const refunds: number[] = [];
vi.mock("./usage", async (original) => ({
  ...(await original<typeof import("./usage")>()),
  takeUsageAmount: async (
    _db: unknown,
    _u: string,
    kind: string,
    amount: number,
    limit: number,
  ) => {
    if (usageFail) throw new Error("db down");
    if (kind !== "group_push" || pushUsed + amount > limit) return false;
    pushUsed += amount;
    return true;
  },
  refundUsageAmount: async (_db: unknown, _u: string, _k: string, amount: number) => {
    refunds.push(amount);
  },
}));

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
  targets = new Map();
  late.length = 0;
  purged = 0;
  pushUsed = 0;
  refunds.length = 0;
  targetsFail = false;
  usageFail = false;
});

describe("runUserReminders", () => {
  it("pushes each due reminder to its person", async () => {
    due = [r(), r({ id: "r2", lineUserId: "U2", body: "กินยา" })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    const out = await runUserReminders({} as SupabaseClient, { push } as never, NOW);
    expect(out).toEqual({ claimed: 2, sent: 2, errors: 0, late: 0 });
    expect(push.mock.calls.map((c) => c[0])).toEqual(["U1", "U2"]);
    expect(sentText(push.mock.calls[0] ?? [])).toBe("⏰ เตือน: จ่ายค่าไฟ");
  });

  it("a repeating one says so, with where to cancel it", async () => {
    due = [r({ repeat: "daily" })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    await runUserReminders(
      {} as SupabaseClient,
      { push } as never,
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
    const out = await runUserReminders(
      {} as SupabaseClient,
      { push, groupMemberCount: async () => 4 } as never,
      NOW,
      "https://x/r",
    );
    expect(out.sent).toBe(1);
    expect(push.mock.calls[0]?.[0]).toBe("Cgroup");
    const sent = sentText(push.mock.calls[0] ?? []);
    expect(sent).toContain("⏰ เตือนกลุ่ม: ประชุม");
    expect(sent).not.toContain("https://");
  });

  it("a group the bot has left gets nothing", async () => {
    due = [r({ lineGroupId: "Cgone", groupOpen: false })];
    const push = vi.fn(async (...args: unknown[]) => void args.length);
    const out = await runUserReminders({} as SupabaseClient, { push } as never, NOW);
    expect(push).not.toHaveBeenCalled();
    expect(out).toEqual({ claimed: 1, sent: 0, errors: 0, late: 0 });
  });

  it("one failing push (a blocked account) does not stop the others, and is counted", async () => {
    due = [r(), r({ id: "r2", lineUserId: "U2" }), r({ id: "r3", lineUserId: "U3" })];
    const push = vi.fn(async (...args: unknown[]) => {
      if (args[0] === "U2") throw new Error("LINE push failed: 403");
    });
    const out = await runUserReminders({} as SupabaseClient, { push } as never, NOW);
    expect(out).toEqual({ claimed: 3, sent: 2, errors: 1, late: 0 });
    expect(push).toHaveBeenCalledTimes(3);
  });

  it("does nothing when nothing is due", async () => {
    const push = vi.fn();
    expect(await runUserReminders({} as SupabaseClient, { push } as never, NOW)).toEqual({
      claimed: 0,
      sent: 0,
      errors: 0,
      late: 0,
    });
    expect(push).not.toHaveBeenCalled();
  });

  describe("a group's reminder no message in the group picked up", () => {
    const group = (over: Partial<DueReminder> = {}) =>
      r({ lineGroupId: "Cg", groupOpen: true, body: "บอกให้ @bot1 ส่งงานด้วย", ...over });
    const line = (friends: string[], members = 20) => {
      const push = vi.fn(async (...args: unknown[]) => void args.length);
      return {
        push,
        isFriend: async (id: string) => friends.includes(id),
        groupMemberCount: async () => members,
        groupName: async () => "ทีมงาน",
      };
    };

    it("goes to the people it tags, one by one, when they are friends of พี่ฮูก", async () => {
      due = [group()];
      targets = new Map([["r1", { groupId: "g1", mentions: [{ label: "@bot1", userId: "U9" }] }]]);
      const l = line(["U9"]);
      const out = await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push.mock.calls.map((c) => c[0])).toEqual(["U9"]);
      expect(sentText(l.push.mock.calls[0] ?? [])).toBe(
        "⏰ เตือนจากกลุ่ม “ทีมงาน”: บอกให้ @bot1 ส่งงานด้วย",
      );
      expect(pushUsed).toBe(1); // one message, to the one person
      expect(out.sent).toBe(1);
    });

    it("goes to the group, tagging those it could not reach, within the owner's 300 a month", async () => {
      due = [group()];
      targets = new Map([["r1", { groupId: "g1", mentions: [{ label: "@bot1", userId: "U9" }] }]]);
      const l = line([], 20);
      await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push.mock.calls.map((c) => c[0])).toEqual(["Cg"]);
      expect((l.push.mock.calls[0]?.[1] as { type: string }[])[0]?.type).toBe("textV2");
      expect(pushUsed).toBe(20);
    });

    it("goes to the group when it tags nobody, or everyone", async () => {
      due = [group({ body: "ประชุม" }), group({ id: "r2", body: "@All ประชุม" })];
      targets = new Map([
        ["r1", { groupId: "g1", mentions: [] }],
        ["r2", { groupId: "g1", mentions: [{ label: "@All", all: true }] }],
      ]);
      const l = line(["U9"], 10);
      await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push.mock.calls.map((c) => c[0])).toEqual(["Cg", "Cg"]);
      expect(pushUsed).toBe(20);
    });

    it("waits for the next message in the group when the month's 300 would be passed", async () => {
      pushUsed = 290;
      due = [group({ body: "ประชุม" })];
      targets = new Map([["r1", { groupId: "g1", mentions: [] }]]);
      const l = line([], 20);
      const out = await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push).not.toHaveBeenCalled();
      expect(late).toEqual([
        {
          groupId: "g1",
          body: "ประชุม",
          repeat: null,
          mentions: [],
          dueAt: new Date("2026-10-29T01:58:00Z"),
        },
      ]);
      expect(out).toMatchObject({ sent: 0, late: 1 });
    });

    it("gives the count back and waits when the push to the group fails", async () => {
      due = [group({ body: "ประชุม" })];
      targets = new Map([["r1", { groupId: "g1", mentions: [] }]]);
      const l = line([], 20);
      l.push.mockRejectedValue(new Error("LINE push failed: 500"));
      await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(refunds).toEqual([20]);
      expect(late).toHaveLength(1);
    });

    it("counts each person reached against the same 300 a month", async () => {
      pushUsed = 299;
      due = [group()];
      targets = new Map([
        [
          "r1",
          {
            groupId: "g1",
            mentions: [
              { label: "@bot1", userId: "U9" },
              { label: "@bot2", userId: "U8" },
            ],
          },
        ],
      ]);
      const l = line(["U9", "U8"], 20);
      await runUserReminders({} as SupabaseClient, l as never, NOW);
      // one more fits: the second person and the group are past the allowance, so it waits
      expect(l.push.mock.calls.map((c) => c[0])).toEqual(["U9"]);
      expect(pushUsed).toBe(300);
      expect(late).toHaveLength(1);
    });

    it("still sends the personal ones when the group details cannot be read", async () => {
      targetsFail = true;
      due = [r(), group({ id: "r2", body: "ประชุม" })];
      const l = line([], 5);
      const out = await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push.mock.calls.map((c) => c[0])).toEqual(["U1", "Cg"]);
      expect(out.sent).toBe(2);
    });

    it("waits instead of being lost when the allowance cannot be read", async () => {
      usageFail = true;
      due = [group({ body: "ประชุม" })];
      targets = new Map([["r1", { groupId: "g1", mentions: [] }]]);
      const l = line([], 20);
      const out = await runUserReminders({} as SupabaseClient, l as never, NOW);
      expect(l.push).not.toHaveBeenCalled();
      expect(late).toHaveLength(1);
      expect(out.late).toBe(1);
    });

    it("tries plain text only when LINE refused the tagged form", async () => {
      due = [group()];
      targets = new Map([["r1", { groupId: "g1", mentions: [{ label: "@All", all: true }] }]]);
      const refused = line([], 5);
      refused.push.mockRejectedValueOnce(new Error("LINE push failed: 400"));
      await runUserReminders({} as SupabaseClient, refused as never, NOW);
      expect(refused.push).toHaveBeenCalledTimes(2);

      due = [group()];
      const down = line([], 5);
      down.push.mockRejectedValueOnce(new Error("LINE push failed: 500"));
      await runUserReminders({} as SupabaseClient, down as never, NOW);
      expect(down.push).toHaveBeenCalledTimes(1);
    });

    it("forgets reminders whose 12 hours of waiting are over", async () => {
      await runUserReminders({} as SupabaseClient, line([]) as never, NOW);
      expect(purged).toBe(1);
    });
  });
});
