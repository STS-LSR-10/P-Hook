import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { logActivity } from "./activity";

const db = (insert: (row: unknown) => Promise<{ error: { message: string } | null }>) =>
  ({ from: () => ({ insert }) }) as unknown as SupabaseClient;

describe("logActivity", () => {
  it("writes the kind and who", async () => {
    const rows: unknown[] = [];
    await logActivity(
      db(async (r) => (rows.push(r), { error: null })),
      "u1",
      "reminder_chat",
    );
    expect(rows).toEqual([{ kind: "reminder_chat", user_id: "u1" }]);
  });
  it("never throws, whether the database says no or the call breaks", async () => {
    await expect(
      logActivity(
        db(async () => ({ error: { message: "no table" } })),
        "u1",
        "calendar_google",
      ),
    ).resolves.toBeUndefined();
    await expect(
      logActivity(
        db(async () => Promise.reject(new Error("down"))),
        null,
        "calendar_device",
      ),
    ).resolves.toBeUndefined();
  });
});
