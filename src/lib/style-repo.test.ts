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
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
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
      update,
    }),
  } as unknown as SupabaseClient;
  return { db, upsert, update };
}

const seen = (n: number, first: number) => ({
  ...emptyHabits(),
  n,
  amountFirst: first,
  amountLast: n - first,
});

describe("learnStyle", () => {
  it("adds one message to the counts", async () => {
    const { db, upsert } = fake({ habits: seen(2, 2), enabled: true });
    await learnStyle(db, "u1", "50 กาแฟ");
    const saved = (upsert.mock.calls[0] as unknown as [{ habits: { n: number } }])[0];
    expect(saved.habits.n).toBe(3);
  });

  it("keeps nothing of what was written", async () => {
    const { db, upsert } = fake(null);
    await learnStyle(db, "u1", "50 กาแฟร้านลับ");
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("ร้านลับ");
  });

  it("learns nothing when the person switched it off", async () => {
    const { db, upsert } = fake({ habits: seen(2, 2), enabled: false });
    await learnStyle(db, "u1", "50 กาแฟ");
    expect(upsert).not.toHaveBeenCalled();
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
