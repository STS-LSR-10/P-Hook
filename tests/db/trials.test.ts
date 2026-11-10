import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb, newUser, one, rows } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await newDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

const trial = async (user: string, plan: string) =>
  (
    await one<{ start_plan_trial: string | null }>(
      db,
      "select start_plan_trial($1::uuid, $2::plan_tier, 7)::text",
      [user, plan],
    )
  ).start_plan_trial;

const state = (user: string) =>
  one<{ plan: string; days: number }>(
    db,
    "select plan::text, round(extract(epoch from (plan_expires_at - now())) / 86400)::int as days from users where id = $1",
    [user],
  );

describe("start_plan_trial", () => {
  it("gives the tier for exactly 7 days", async () => {
    const u = await newUser(db, "trial-a");
    expect(await trial(u, "plus")).not.toBeNull();
    expect(await state(u)).toEqual({ plan: "plus", days: 7 });
  });

  it("is once per tier: a second start of the same tier is refused, even a double tap", async () => {
    const u = await newUser(db, "trial-b");
    expect(await trial(u, "ultimate")).not.toBeNull();
    expect(await trial(u, "ultimate")).toBeNull();
    expect(await rows(db, "select 1 from plan_trials where user_id = $1", [u])).toHaveLength(1);
  });

  it("is refused while any plan is running (a trial cannot be stacked on a trial or a paid plan)", async () => {
    const u = await newUser(db, "trial-c");
    await trial(u, "plus");
    expect(await trial(u, "ultimate")).toBeNull();
    expect(await state(u)).toEqual({ plan: "plus", days: 7 });

    const paid = await newUser(db, "trial-d");
    await db.query(
      "update users set plan = 'plus', plan_expires_at = now() + interval '20 days' where id = $1",
      [paid],
    );
    expect(await trial(paid, "ultimate")).toBeNull();
  });

  it("is refused for a plan without an end date", async () => {
    const u = await newUser(db, "trial-e");
    await db.query("update users set plan = 'plus', plan_expires_at = null where id = $1", [u]);
    expect(await trial(u, "ultimate")).toBeNull();
  });

  it("no other tier can be tried after the first trial has ended (one per account)", async () => {
    const u = await newUser(db, "trial-f");
    await trial(u, "plus");
    await db.query("update users set plan_expires_at = now() - interval '1 day' where id = $1", [
      u,
    ]);
    expect(await trial(u, "ultimate")).toBeNull();
    expect(await trial(u, "starter")).toBeNull();
    expect(await trial(u, "plus")).toBeNull();
  });

  it("rejects the free tier and unknown users", async () => {
    const u = await newUser(db, "trial-g");
    await expect(trial(u, "free")).rejects.toThrow();
    await expect(trial("00000000-0000-0000-0000-000000000000", "plus")).rejects.toThrow();
  });

  it("browser roles cannot start trials, and a user sees only their own trials", async () => {
    const a = await newUser(db, "trial-h");
    const b = await newUser(db, "trial-i");
    await trial(a, "plus");
    await trial(b, "plus");
    await db.exec("set role authenticated");
    await expect(trial(a, "ultimate")).rejects.toThrow(/permission denied/i);
    await db.exec("reset role");

    await db.exec(
      "select set_config('request.jwt.claims', '{\"sub\":\"" +
        a +
        '","role":"authenticated"}\', false); set role authenticated',
    );
    const seen = await rows<{ user_id: string }>(db, "select user_id from plan_trials");
    await db.exec("reset role");
    expect(seen.map((r) => r.user_id)).toEqual([a]);
  });
});

describe("apply_prepaid_upgrade", () => {
  const prepaid = (user: string, plan: string, months: number, ref: string) =>
    db.query("select apply_prepaid_purchase($1::uuid, $2::plan_tier, $3, $4, 5900, 'promptpay')", [
      user,
      plan,
      months,
      ref,
    ]);
  const upgrade = async (user: string, plan: string, ref: string) =>
    (
      await one<{ apply_prepaid_upgrade: boolean }>(
        db,
        "select apply_prepaid_upgrade($1::uuid, $2::plan_tier, $3, 4000, 'promptpay')",
        [user, plan, ref],
      )
    ).apply_prepaid_upgrade;
  const expiry = async (user: string) =>
    (
      await one<{ e: string }>(db, "select plan_expires_at::text as e from users where id = $1", [
        user,
      ])
    ).e;

  it("raises the tier and keeps the end date exactly", async () => {
    const u = await newUser(db, "up-a");
    await prepaid(u, "plus", 1, "cs_up_a1");
    const before = await expiry(u);
    expect(await upgrade(u, "ultimate", "cs_up_a2")).toBe(true);
    expect((await state(u)).plan).toBe("ultimate");
    expect(await expiry(u)).toBe(before);
  });

  it("is idempotent per Stripe reference", async () => {
    const u = await newUser(db, "up-b");
    await prepaid(u, "plus", 1, "cs_up_b1");
    expect(await upgrade(u, "ultimate", "cs_up_b2")).toBe(true);
    expect(await upgrade(u, "ultimate", "cs_up_b2")).toBe(false);
    expect(
      await rows(db, "select 1 from payments where user_id = $1 and kind = 'upgrade'", [u]),
    ).toHaveLength(1);
  });

  it("does not change the plan when the prepaid time ended meanwhile, but keeps the payment", async () => {
    const u = await newUser(db, "up-c");
    await prepaid(u, "plus", 1, "cs_up_c1");
    await db.query("update users set plan_expires_at = now() - interval '1 hour' where id = $1", [
      u,
    ]);
    expect(await upgrade(u, "ultimate", "cs_up_c2")).toBe(false);
    expect(
      (await one<{ plan: string }>(db, "select plan::text from users where id = $1", [u])).plan,
    ).toBe("plus");
    expect(
      await rows(db, "select 1 from payments where user_id = $1 and kind = 'upgrade'", [u]),
    ).toHaveLength(1);
  });

  it("never lowers the tier", async () => {
    const u = await newUser(db, "up-d");
    await prepaid(u, "ultimate", 1, "cs_up_d1");
    expect(await upgrade(u, "plus", "cs_up_d2")).toBe(false);
    expect((await state(u)).plan).toBe("ultimate");
  });

  it("upgrade rows are not counted as the purchase that sets the rate", async () => {
    const u = await newUser(db, "up-e");
    await prepaid(u, "plus", 12, "cs_up_e1");
    await upgrade(u, "ultimate", "cs_up_e2");
    const latest = await rows<{ months: number }>(
      db,
      "select months from payments where user_id = $1 and kind = 'purchase' order by created_at desc limit 1",
      [u],
    );
    expect(latest[0]?.months).toBe(12);
  });
});

describe("Early Bird seats (0065)", () => {
  const claim = async (u: string, plan: string, period: string) =>
    (
      await one<{ ok: boolean }>(db, "select claim_early_bird($1::uuid, $2::plan_tier, $3) as ok", [
        u,
        plan,
        period,
      ])
    ).ok;

  it("seeds the offers with their seat counts", async () => {
    const r = await rows<{ plan: string; period: string; total: number | null }>(
      db,
      "select plan::text, period, total from early_bird_seats order by plan, period",
    );
    expect(r).toEqual([
      { plan: "plus", period: "monthly", total: 200 },
      { plan: "plus", period: "yearly", total: 100 },
      { plan: "starter", period: "monthly", total: null },
      { plan: "starter", period: "yearly", total: 500 },
      { plan: "ultimate", period: "monthly", total: 50 },
      { plan: "ultimate", period: "yearly", total: 30 },
    ]);
  });

  it("stops at the seat count, and a released seat can be taken again", async () => {
    await db.query(
      "update early_bird_seats set total = 2 where plan = 'ultimate' and period = 'yearly'",
    );
    const [a, b, c] = [
      await newUser(db, "eb-a"),
      await newUser(db, "eb-b"),
      await newUser(db, "eb-c"),
    ];
    expect(await claim(a, "ultimate", "yearly")).toBe(true);
    expect(await claim(b, "ultimate", "yearly")).toBe(true);
    expect(await claim(c, "ultimate", "yearly")).toBe(false);
    await db.query(
      "update early_bird_claims set reserved_at = now() - interval '2 hours' where user_id = $1",
      [a],
    );
    expect((await one<{ n: number }>(db, "select release_early_bird(30) as n")).n).toBe(1);
    expect(await claim(c, "ultimate", "yearly")).toBe(true);
    await db.query(
      "update early_bird_seats set total = 30 where plan = 'ultimate' and period = 'yearly'",
    );
  });

  it("is one seat per account: asking again keeps one, and a paid seat blocks another", async () => {
    const u = await newUser(db, "eb-d");
    expect(await claim(u, "plus", "yearly")).toBe(true);
    expect(await claim(u, "plus", "yearly")).toBe(true); // a double tap
    expect(await claim(u, "starter", "yearly")).toBe(true); // switching plan moves the reservation
    expect(await rows(db, "select 1 from early_bird_claims where user_id = $1", [u])).toHaveLength(
      1,
    );
    await db.query("select confirm_early_bird($1::uuid, 'starter', 'yearly')", [u]);
    expect(await claim(u, "plus", "yearly")).toBe(false);
    expect(await claim(u, "starter", "yearly")).toBe(false);
  });

  it("asking for a full offer keeps the seat already held elsewhere", async () => {
    await db.query(
      "update early_bird_seats set total = 0 where plan = 'ultimate' and period = 'monthly'",
    );
    const u = await newUser(db, "eb-g");
    expect(await claim(u, "plus", "monthly")).toBe(true);
    expect(await claim(u, "ultimate", "monthly")).toBe(false);
    const r = await one<{ plan: string }>(
      db,
      "select plan::text from early_bird_claims where user_id = $1",
      [u],
    );
    expect(r.plan).toBe("plus");
    await db.query(
      "update early_bird_seats set total = 50 where plan = 'ultimate' and period = 'monthly'",
    );
  });

  it("confirming twice, or for another plan, never moves a paid seat", async () => {
    const u = await newUser(db, "eb-f");
    await db.query("select confirm_early_bird($1::uuid, 'plus', 'yearly')", [u]);
    await db.query("select confirm_early_bird($1::uuid, 'ultimate', 'monthly')", [u]);
    const r = await one<{ plan: string; period: string }>(
      db,
      "select plan::text, period from early_bird_claims where user_id = $1",
      [u],
    );
    expect(r).toEqual({ plan: "plus", period: "yearly" });
  });

  it("an offer with no seat limit never fills", async () => {
    const u = await newUser(db, "eb-e");
    expect(await claim(u, "starter", "monthly")).toBe(true);
  });

  it("browser roles cannot call the seat functions", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("set local role authenticated");
        await tx.query("select release_early_bird(0)");
      }),
    ).rejects.toThrow();
  });
});

describe("add-ons (0066)", () => {
  const pack = (u: string, remaining: number, source: string) =>
    db.query(
      "insert into addons (user_id, kind, sku, units, remaining, source_ref) values ($1,'slips','slips_100',100,$2,$3)",
      [u, remaining, source],
    );
  const take = async (u: string) =>
    (await one<{ ok: boolean }>(db, "select take_slip_pack($1::uuid) as ok", [u])).ok;

  it("spends a slip pack one read at a time and says when it is empty", async () => {
    const u = await newUser(db, "ad-a");
    await pack(u, 2, "ref-a");
    expect(await take(u)).toBe(true);
    expect(await take(u)).toBe(true);
    expect(await take(u)).toBe(false);
  });

  it("uses the oldest pack first, and never goes below zero", async () => {
    const u = await newUser(db, "ad-b");
    await pack(u, 1, "ref-b1");
    await pack(u, 5, "ref-b2");
    expect(await take(u)).toBe(true);
    const r = await rows<{ remaining: number }>(
      db,
      "select remaining from addons where user_id = $1 order by created_at, remaining",
      [u],
    );
    expect(r.map((x) => x.remaining).sort()).toEqual([0, 5]);
  });

  it("one payment adds an add-on once", async () => {
    const u = await newUser(db, "ad-c");
    await pack(u, 100, "ref-c");
    await expect(pack(u, 100, "ref-c")).rejects.toThrow();
  });

  it("a kind it does not know is refused", async () => {
    const u = await newUser(db, "ad-d");
    await expect(
      db.query("insert into addons (user_id, kind, sku, units) values ($1,'coins','x',1)", [u]),
    ).rejects.toThrow();
  });
});
