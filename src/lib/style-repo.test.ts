import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { emptyHabits } from "@/lib/ai/style-profile";
import {
  clearStyle,
  learnStyle,
  loadStyleHints,
  setStyleEnabled,
  styleSummary,
} from "./style-repo";

/** A one-table fake: select().eq().maybeSingle(), upsert(), update().eq(). */
function fake(row: Record<string, unknown> | null, opts: { selectError?: boolean } = {}) {
  const upsert = vi.fn(async () => ({ error: null }));
  const insert = vi.fn(async () => ({ error: null }));
  const u: { eq: () => typeof u; then: (r: (v: { error: null }) => void) => void } = {
    eq: () => u,
    then: (r) => r({ error: null }),
  };
  const update = vi.fn(() => u);
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts.selectError
              ? { data: null, error: { message: "boom" } }
              : { data: row, error: null },
        }),
      }),
      upsert,
      insert,
      update,
    }),
  } as unknown as SupabaseClient;
  return { db, upsert, update, insert };
}

const seen = (n: number, first: number) => ({
  ...emptyHabits(),
  n,
  amountFirst: first,
  amountLast: n - first,
});

describe("learnStyle never undoes the person's choice", () => {
  it("writes only the counts, never the on/off, and only while it is on", async () => {
    const calls: { op: string; arg: unknown; eqs: [string, unknown][] }[] = [];
    const chain = (op: string, arg: unknown) => {
      const eqs: [string, unknown][] = [];
      const c = {
        eq: (k: string, v: unknown) => (eqs.push([k, v]), c),
        then: (r: (v: { error: null }) => void) => (
          calls.push({ op, arg, eqs }),
          r({ error: null })
        ),
      };
      return c;
    };
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { habits: seen(2, 2), enabled: true }, error: null }),
          }),
        }),
        update: (arg: unknown) => chain("update", arg),
        insert: (arg: unknown) => {
          calls.push({ op: "insert", arg, eqs: [] });
          return Promise.resolve({ error: null });
        },
        upsert: (arg: unknown) => {
          calls.push({ op: "upsert", arg, eqs: [] });
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;
    await learnStyle(db, "u1", "50 กาแฟ");
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
    const upd = calls.find((c) => c.op === "update");
    expect(upd).toBeDefined();
    expect(JSON.stringify(upd?.arg)).not.toContain("enabled");
    expect(upd?.eqs).toContainEqual(["enabled", true]);
  });

  it("makes the first row when the person has none, without touching an existing one", async () => {
    const inserts: unknown[] = [];
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: (arg: unknown) => {
          inserts.push(arg);
          return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
        },
      }),
    } as unknown as SupabaseClient;
    await expect(learnStyle(db, "u1", "50 กาแฟ")).resolves.toBeUndefined();
    expect(inserts).toHaveLength(1);
  });

  it("learns nothing from a secret", async () => {
    const { db, upsert, update } = fake({ habits: seen(2, 2), enabled: true });
    await learnStyle(db, "u1", "รหัสไวไฟ 12345678");
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("learnStyle", () => {
  it("adds one message to the counts", async () => {
    const { db, update } = fake({ habits: seen(2, 2), enabled: true });
    await learnStyle(db, "u1", "50 กาแฟ");
    const saved = (update.mock.calls[0] as unknown as [{ habits: { n: number } }])[0];
    expect(saved.habits.n).toBe(3);
  });

  it("keeps nothing of what was written", async () => {
    const { db, insert } = fake(null);
    await learnStyle(db, "u1", "50 กาแฟร้านลับ");
    expect(insert).toHaveBeenCalledOnce();
    expect(JSON.stringify(insert.mock.calls)).not.toContain("ร้านลับ");
  });

  it("learns nothing when the person switched it off", async () => {
    const { db, upsert, update, insert } = fake({ habits: seen(2, 2), enabled: false });
    await learnStyle(db, "u1", "50 กาแฟ");
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("never throws, even when the table is not there yet", async () => {
    const { db } = fake(null, { selectError: true });
    await expect(learnStyle(db, "u1", "50 กาแฟ")).resolves.toBeUndefined();
  });
});

describe("loadStyleHints", () => {
  it("gives hints once the habit is clear", async () => {
    const { db } = fake({ habits: seen(10, 10), enabled: true });
    expect((await loadStyleHints(db, "u1")).join(" ")).toMatch(/amount before/i);
  });
  it("gives none when it is off, or when the read fails", async () => {
    expect(await loadStyleHints(fake({ habits: seen(10, 10), enabled: false }).db, "u1")).toEqual(
      [],
    );
    expect(await loadStyleHints(fake(null, { selectError: true }).db, "u1")).toEqual([]);
  });
});

describe("the person's controls", () => {
  it("summarises without any text", async () => {
    const { db } = fake({ habits: seen(10, 10), enabled: true });
    expect(await styleSummary(db, "u1")).toEqual({
      enabled: true,
      seen: 10,
      habits: ["amount_first"],
    });
  });
  it("switching off forgets what was learned", async () => {
    const { db, upsert } = fake({ habits: seen(10, 10), enabled: true });
    await setStyleEnabled(db, "u1", false);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, habits: emptyHabits() }),
    );
  });
  it("clearing empties the counts and keeps the choice", async () => {
    const { db, update } = fake({ habits: seen(10, 10), enabled: false });
    await clearStyle(db, "u1");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ habits: emptyHabits() }));
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: expect.anything() }),
    );
  });
});
