import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, newDb, newUser, one, rows } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await newDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("run cleanly a second time (idempotent)", async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  }, 60_000);

  it("seed exactly the 19 system categories, even after re-running", async () => {
    const r = await one<{ n: number }>(
      db,
      "select count(*)::int as n from categories where user_id is null",
    );
    expect(r.n).toBe(19);
    const kinds = await rows<{ type: string; n: number }>(
      db,
      "select type::text as type, count(*)::int as n from categories where user_id is null group by 1 order by 1",
    );
    expect(kinds).toEqual([
      { type: "expense", n: 12 },
      { type: "income", n: 7 },
    ]);
  });

  it("create the bucket row as private", async () => {
    const b = await one<{ public: boolean }>(
      db,
      "select public from storage.buckets where id = 'slips'",
    );
    expect(b.public).toBe(false);
  });

  it("give every new user a unique 8-character referral code", async () => {
    const a = await newUser(db, "code-a");
    const b = await newUser(db, "code-b");
    const codes = await rows<{ referral_code: string }>(
      db,
      "select referral_code from users where id in ($1, $2)",
      [a, b],
    );
    expect(new Set(codes.map((c) => c.referral_code)).size).toBe(2);
    for (const c of codes) expect(c.referral_code).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("constraints", () => {
  it("reject non-positive amounts and bad budget start days", async () => {
    const u = await newUser(db, "constraints");
    await expect(
      db.query(
        "insert into transactions (user_id, type, amount, title) values ($1,'expense',0,'x')",
        [u],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("update user_settings set cycle_start_day = 31 where user_id = $1", [u]),
    ).rejects.toThrow();
    await expect(
      db.query("update user_settings set budget_mode = 'weird' where user_id = $1", [u]),
    ).rejects.toThrow();
  });

  it("allow one overall budget and one budget per category only", async () => {
    const u = await newUser(db, "budgets");
    const cat = await one<{ id: string }>(db, "select id from categories where name = 'อาหาร'");
    await db.query("insert into budgets (user_id, amount) values ($1, 100)", [u]);
    await expect(
      db.query("insert into budgets (user_id, amount) values ($1, 200)", [u]),
    ).rejects.toThrow();
    await db.query("insert into budgets (user_id, category_id, amount) values ($1,$2,50)", [
      u,
      cat.id,
    ]);
    await expect(
      db.query("insert into budgets (user_id, category_id, amount) values ($1,$2,60)", [u, cat.id]),
    ).rejects.toThrow();
  });

  it("slips: the same image hash or reference cannot be stored twice per user", async () => {
    const u = await newUser(db, "slips");
    const v = await newUser(db, "slips-other");
    const ins = (user: string, hash: string, ref: string | null) =>
      db.query(
        "insert into slips (user_id, storage_path, image_sha256, slip_ref) values ($1,'p',$2,$3)",
        [user, hash, ref],
      );
    await ins(u, "h1", "R1");
    await expect(ins(u, "h1", "R2")).rejects.toThrow(); // same image
    await expect(ins(u, "h2", "R1")).rejects.toThrow(); // same reference
    await ins(v, "h1", "R1"); // another user may have the same values
    await ins(u, "h3", null);
    await ins(u, "h4", null); // missing references never collide
  });
});

describe("transaction tags (0014)", () => {
  it("default to an empty list and can be searched by one tag", async () => {
    const u = await newUser(db, "tags");
    await db.query(
      "insert into transactions (user_id,type,amount,title,tags) values ($1,'expense',10,'a','{ปาร์ตี้,trip}'), ($1,'expense',20,'b','{trip}'), ($1,'expense',30,'c', default)",
      [u],
    );
    const plain = await one<{ tags: string[] }>(
      db,
      "select tags from transactions where user_id = $1 and title = 'c'",
      [u],
    );
    expect(plain.tags).toEqual([]);
    const found = await rows<{ title: string }>(
      db,
      "select title from transactions where user_id = $1 and tags @> array['trip'] order by title",
      [u],
    );
    expect(found.map((r) => r.title)).toEqual(["a", "b"]);
  });
});

describe("entry photos (0015)", () => {
  it("an entry has no photo by default and the wait row follows the entry and the user", async () => {
    const u = await newUser(db, "photos");
    const tx = await one<{ id: string; photo_path: string | null; photo_at: string | null }>(
      db,
      "insert into transactions (user_id,type,amount,title) values ($1,'expense',10,'a') returning id, photo_path, photo_at",
      [u],
    );
    expect(tx.photo_path).toBeNull();
    expect(tx.photo_at).toBeNull();

    await db.query(
      "insert into photo_waits (user_id,tx_id,expires_at) values ($1,$2, now() + interval '10 minutes')",
      [u, tx.id],
    );
    // one waiting entry per user: a second tap replaces it (primary key on user_id)
    await expect(
      db.query(
        "insert into photo_waits (user_id,tx_id,expires_at) values ($1,$2, now() + interval '10 minutes')",
        [u, tx.id],
      ),
    ).rejects.toThrow();

    await db.query("delete from transactions where id = $1", [tx.id]);
    const left = await one<{ n: number }>(
      db,
      "select count(*)::int as n from photo_waits where user_id = $1",
      [u],
    );
    expect(left.n).toBe(0);
  });
});

describe("wallets (0019)", () => {
  async function seed() {
    const u = await newUser(db, `w-${Math.random()}`);
    const other = await newUser(db, `w-other-${Math.random()}`);
    const wallet = async (
      user: string,
      name: string,
      kind: string,
      isDefault = false,
      opening = 0,
    ) =>
      (
        await one<{ id: string }>(
          db,
          "insert into accounts (user_id,name,kind,is_default,opening_balance) values ($1,$2,$3::account_kind,$4,$5) returning id",
          [user, name, kind, isDefault, opening],
        )
      ).id;
    const main = await wallet(u, "เงินสด", "cash", true, 1000);
    const bank = await wallet(u, "กสิกร", "bank", false, 5000);
    const card = await wallet(u, "บัตร", "card", false, -2000);
    const theirs = await wallet(other, "ของคนอื่น", "cash", true);
    const ins = (
      user: string,
      account: string | null,
      type: string,
      amount: number,
      status = "confirmed",
    ) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,account_id,status) values ($1,$2,$3,'x',$4,$5)",
        [user, type, amount, account, status],
      );
    await ins(u, null, "expense", 100); // no wallet -> the main wallet
    await ins(u, main, "income", 300);
    await ins(u, bank, "expense", 1200);
    await ins(u, bank, "income", 20_000);
    await ins(u, card, "expense", 800);
    await ins(u, bank, "expense", 999, "deleted");
    await ins(u, bank, "expense", 888, "pending_confirm");
    await ins(other, theirs, "expense", 5000);
    return { u, main, bank, card };
  }
  const balances = (u: string) =>
    rows<{
      name: string;
      kind: string;
      is_default: boolean;
      opening_balance: string;
      income: string;
      expense: string;
      tx_count: number;
    }>(
      db,
      "select name, kind, is_default, opening_balance::text, income::text, expense::text, tx_count::int from wallet_balances($1)",
      [u],
    );

  it("adds up each wallet; entries with no wallet belong to the main one", async () => {
    const { u } = await seed();
    expect(await balances(u)).toEqual([
      {
        name: "เงินสด",
        kind: "cash",
        is_default: true,
        opening_balance: "1000.00",
        income: "300.00",
        expense: "100.00",
        tx_count: 2,
      },
      {
        name: "กสิกร",
        kind: "bank",
        is_default: false,
        opening_balance: "5000.00",
        income: "20000.00",
        expense: "1200.00",
        tx_count: 2,
      },
      {
        name: "บัตร",
        kind: "card",
        is_default: false,
        opening_balance: "-2000.00",
        income: "0",
        expense: "800.00",
        tx_count: 1,
      },
    ]);
  });

  it("the main wallet comes first, and another person's wallet never shows up", async () => {
    const { u } = await seed();
    const names = (await balances(u)).map((b) => b.name);
    expect(names[0]).toBe("เงินสด");
    expect(names).not.toContain("ของคนอื่น");
  });

  it("a person with no wallet has no rows (the app creates the main one on first use)", async () => {
    const u = await newUser(db, `w-none-${Math.random()}`);
    expect(await balances(u)).toEqual([]);
  });

  it("a name is used once per person, ignoring case, but another person may use it", async () => {
    const { u } = await seed();
    await expect(
      db.query("insert into accounts (user_id,name) values ($1,'กสิกร')", [u]),
    ).rejects.toThrow();
    await db.query("insert into accounts (user_id,name) values ($1,'Wallet')", [u]);
    await expect(
      db.query("insert into accounts (user_id,name) values ($1,'wALLET')", [u]),
    ).rejects.toThrow();
    const v = await newUser(db, `w-v-${Math.random()}`);
    await db.query("insert into accounts (user_id,name) values ($1,'Wallet')", [v]);
  });

  it("only one wallet can be the main one", async () => {
    const { u } = await seed();
    await expect(
      db.query("insert into accounts (user_id,name,is_default) values ($1,'อีกใบ',true)", [u]),
    ).rejects.toThrow();
  });

  it("savings is a kind of wallet", async () => {
    const u = await newUser(db, `w-sav-${Math.random()}`);
    await db.query("insert into accounts (user_id,name,kind) values ($1,'เงินเก็บ','savings')", [
      u,
    ]);
    expect((await balances(u))[0]?.kind).toBe("savings");
  });

  it("deleting a wallet keeps its entries (they fall back to the main wallet)", async () => {
    const { u, bank } = await seed();
    const before = (await balances(u))[0]!;
    expect(before.tx_count).toBe(2);
    await db.query("delete from accounts where id = $1", [bank]);
    const left = await one<{ n: number }>(
      db,
      "select count(*)::int as n from transactions where user_id = $1 and account_id is null",
      [u],
    );
    expect(left.n).toBe(5); // the one that never had a wallet + the four that were in the bank wallet
    const main = (await balances(u))[0]!;
    expect(main.tx_count).toBe(4); // 2 + the 2 confirmed ones that came back (deleted/pending never count)
    expect(main.income).toBe("20300.00");
    expect(main.expense).toBe("1300.00");
  });
});

describe("data reset (0030)", () => {
  async function seed() {
    const me = await newUser(db, `dr-${Math.random()}`);
    const other = await newUser(db, `dr-other-${Math.random()}`);
    const wallet = async (
      user: string,
      name: string,
      over: { shared?: boolean; isDefault?: boolean; opening?: number } = {},
    ) =>
      (
        await one<{ id: string }>(
          db,
          "insert into accounts (user_id,name,kind,is_default,is_shared,opening_balance) values ($1,$2,'cash'::account_kind,$3,$4,$5) returning id",
          [user, name, over.isDefault ?? false, over.shared ?? false, over.opening ?? 0],
        )
      ).id;
    const main = await wallet(me, "เงินสด", { isDefault: true, opening: 1000 });
    const bank = await wallet(me, "ธนาคาร", { opening: 5000 });
    const shared = await wallet(me, "กองกลาง", { shared: true, opening: 100 });
    const theirs = await wallet(other, "ของเขา", { isDefault: true, opening: 50 });
    const tx = async (
      user: string,
      account: string | null,
      amount: number,
      at: string,
      type = "expense",
      extra: { slip?: string | null; photo?: string | null } = {},
    ) =>
      one<{ id: string }>(
        db,
        "insert into transactions (user_id,type,amount,title,account_id,occurred_at,slip_id,photo_path) values ($1,$2,$3,'x',$4,$5,$6,$7) returning id",
        [user, type, amount, account, at, extra.slip ?? null, extra.photo ?? null],
      );
    const slip = async (user: string, hash: string, path: string) =>
      (
        await one<{ id: string }>(
          db,
          "insert into slips (user_id,storage_path,image_sha256,slip_ref,amount,payee) values ($1,$2,$3,$4,120,'ร้านนี้') returning id",
          [user, path, hash, `ref-${hash}`],
        )
      ).id;
    return { me, other, main, bank, shared, theirs, tx, slip };
  }
  const OCT = ["2026-09-30T17:00:00Z", "2026-11-01T17:00:00Z"]; // October in Bangkok
  const count = async (sql: string, params: unknown[]) =>
    Number((await one<{ n: string }>(db, `select count(*)::text as n from ${sql}`, params)).n);
  const balances = (u: string) =>
    rows<{ name: string; opening: string; expense: string }>(
      db,
      "select name, opening_balance::text as opening, expense::text from wallet_balances($1) where not is_shared order by name",
      [u],
    );

  it("a reset removes the person's own history and nothing of anybody else's", async () => {
    const { me, other, main, bank, theirs, tx } = await seed();
    await tx(me, main, 100, "2026-10-05T05:00:00Z");
    await tx(me, bank, 200, "2026-09-05T05:00:00Z");
    await tx(me, null, 5, "2026-08-05T05:00:00Z");
    await tx(other, theirs, 999, "2026-10-05T05:00:00Z");
    await db.query(
      "insert into transfers (user_id,from_account,to_account,amount) values ($1,$2,$3,50)",
      [me, main, bank],
    );
    await db.query(
      "insert into debts (user_id,direction,person,amount) values ($1,'lent','ก',10)",
      [me],
    );
    await db.query(
      "insert into debts (user_id,direction,person,amount) values ($1,'lent','ข',10)",
      [other],
    );
    const goal = (
      await one<{ id: string }>(
        db,
        "insert into savings_goals (user_id,name,target_amount) values ($1,'g',100) returning id",
        [me],
      )
    ).id;
    await db.query("insert into savings_deposits (user_id,goal_id,amount) values ($1,$2,30)", [
      me,
      goal,
    ]);

    const r = await one<{
      entries: string;
      transfers: string;
      debts: string;
      goal_deposits: string;
    }>(
      db,
      "select entries::text, transfers::text, debts::text, goal_deposits::text from data_erase($1, null, null, true, false)",
      [me],
    );
    expect(r).toEqual({ entries: "3", transfers: "1", debts: "1", goal_deposits: "1" });

    expect(await count("transactions where user_id = $1", [me])).toBe(0);
    expect(await count("transactions where user_id = $1", [other])).toBe(1);
    expect(await count("debts where user_id = $1", [other])).toBe(1);
    // the account, its wallets, the goal itself and everything set up stay
    expect(await count("users where id = $1", [me])).toBe(1);
    expect(await count("accounts where user_id = $1", [me])).toBe(3);
    expect(await count("savings_goals where user_id = $1", [me])).toBe(1);
  });

  it("without keeping the balance a wallet goes back to its opening balance", async () => {
    const { me, main, tx } = await seed();
    await tx(me, main, 300, "2026-10-05T05:00:00Z");
    await tx(me, main, 500, "2026-10-06T05:00:00Z", "income");
    await db.query("select * from data_erase($1, null, null, true, false)", [me]);
    expect(await balances(me)).toEqual([
      { name: "ธนาคาร", opening: "5000.00", expense: "0" },
      { name: "เงินสด", opening: "1000.00", expense: "0" },
    ]);
  });

  it("keeping the balance makes each private wallet's current money its new opening balance", async () => {
    const { me, main, bank, tx } = await seed();
    await tx(me, main, 300, "2026-10-05T05:00:00Z"); // 1000 - 300
    await tx(me, main, 500, "2026-10-06T05:00:00Z", "income"); // + 500 = 1200
    await tx(me, null, 20, "2026-10-07T05:00:00Z"); // no wallet = main: 1180
    await db.query(
      "insert into transfers (user_id,from_account,to_account,amount) values ($1,$2,$3,200)",
      [me, main, bank],
    ); // main 980, bank 5200
    await db.query(
      "insert into debts (user_id,direction,person,amount,account_id) values ($1,'lent','ก',80,$2)",
      [me, main],
    ); // main 900
    await db.query("select * from data_erase($1, null, null, true, true)", [me]);
    expect(await balances(me)).toEqual([
      { name: "ธนาคาร", opening: "5200.00", expense: "0" },
      { name: "เงินสด", opening: "900.00", expense: "0" },
    ]);
  });

  it("entries in a shared wallet are never erased (the other people see them) and the shared wallet is untouched", async () => {
    const { me, main, shared, tx } = await seed();
    await tx(me, shared, 400, "2026-10-05T05:00:00Z");
    await tx(me, main, 100, "2026-10-05T05:00:00Z");
    const preview = await one<{ entries: string; kept_shared: string }>(
      db,
      "select entries::text, kept_shared::text from data_erase_preview($1, null, null, true)",
      [me],
    );
    expect(preview).toEqual({ entries: "1", kept_shared: "1" });
    await db.query("select * from data_erase($1, null, null, true, true)", [me]);
    expect(await count("transactions where account_id = $1", [shared])).toBe(1);
    const w = await one<{ opening: string; expense: string }>(
      db,
      "select opening_balance::text as opening, expense::text from wallet_balances($1) where is_shared",
      [me],
    );
    expect(w).toEqual({ opening: "100.00", expense: "400.00" });
  });

  it("a month removes only that Bangkok month's entries and transfers, nothing else", async () => {
    const { me, main, bank, tx } = await seed();
    await tx(me, main, 1, "2026-09-30T16:59:59Z"); // 30 Sep 23:59:59 Bangkok: September
    await tx(me, main, 2, "2026-09-30T17:00:00Z"); // 1 Oct 00:00 Bangkok: October
    await tx(me, main, 3, "2026-11-01T16:59:59Z"); // 31 Oct 23:59:59: October
    await tx(me, main, 4, "2026-11-01T17:00:00Z"); // 1 Nov: November
    await db.query(
      "insert into transfers (user_id,from_account,to_account,amount,occurred_at) values ($1,$2,$3,9,'2026-10-15T05:00:00Z')",
      [me, main, bank],
    );
    await db.query(
      "insert into transfers (user_id,from_account,to_account,amount,occurred_at) values ($1,$2,$3,9,'2026-09-15T05:00:00Z')",
      [me, main, bank],
    );
    await db.query(
      "insert into debts (user_id,direction,person,amount) values ($1,'lent','ก',10)",
      [me],
    );

    const r = await one<{ entries: string; transfers: string; debts: string }>(
      db,
      "select entries::text, transfers::text, debts::text from data_erase($1, $2, $3, false, false)",
      [me, OCT[0], OCT[1]],
    );
    expect(r).toEqual({ entries: "2", transfers: "1", debts: "0" });
    const left = await rows<{ amount: string }>(
      db,
      "select amount::text from transactions where user_id = $1 order by amount",
      [me],
    );
    expect(left.map((x) => x.amount)).toEqual(["1.00", "4.00"]);
    expect(await count("transfers where user_id = $1", [me])).toBe(1);
    expect(await count("debts where user_id = $1", [me])).toBe(1);
    // a month delete never touches the opening balances
    expect((await balances(me)).map((b) => b.opening)).toEqual(["5000.00", "1000.00"]);
  });

  it("the preview says exactly what the erase then does", async () => {
    const { me, main, tx } = await seed();
    await tx(me, main, 1, "2026-10-05T05:00:00Z");
    await tx(me, main, 2, "2026-10-06T05:00:00Z");
    const p = await one<{ entries: string }>(
      db,
      "select entries::text from data_erase_preview($1,$2,$3,false)",
      [me, OCT[0], OCT[1]],
    );
    const e = await one<{ entries: string }>(
      db,
      "select entries::text from data_erase($1,$2,$3,false,false)",
      [me, OCT[0], OCT[1]],
    );
    expect(p.entries).toBe(e.entries);
  });

  it("slips of erased entries are scrubbed so they can be read again, but still count for the monthly quota; photos and images are listed for removal", async () => {
    const { me, main, tx, slip } = await seed();
    const s1 = await slip(me, "h1", `${me}/slip-1.jpg`);
    const s2 = await slip(me, "h2", `${me}/slip-2.jpg`);
    await tx(me, main, 100, "2026-10-05T05:00:00Z", "expense", {
      slip: s1,
      photo: `${me}/photo-a.jpg`,
    });
    await tx(me, main, 100, "2026-09-05T05:00:00Z", "expense", { slip: s2 }); // another month
    const paths = await rows<{ path: string }>(
      db,
      "select path from data_erase_paths($1,$2,$3,false) order by path",
      [me, OCT[0], OCT[1]],
    );
    expect(paths.map((p) => p.path)).toEqual([`${me}/photo-a.jpg`, `${me}/slip-1.jpg`]);

    await db.query("select * from data_erase($1,$2,$3,false,false)", [me, OCT[0], OCT[1]]);
    const scrubbed = await one<{
      storage_path: string;
      image_sha256: string;
      slip_ref: string | null;
      amount: string | null;
      payee: string | null;
    }>(
      db,
      "select storage_path, image_sha256, slip_ref, amount::text, payee from slips where id = $1",
      [s1],
    );
    expect(scrubbed).toEqual({
      storage_path: "",
      image_sha256: `erased:${s1}`,
      slip_ref: null,
      amount: null,
      payee: null,
    });
    expect(await count("slips where user_id = $1", [me])).toBe(2); // the quota still sees both
    const untouched = await one<{ image_sha256: string }>(
      db,
      "select image_sha256 from slips where id = $1",
      [s2],
    );
    expect(untouched.image_sha256).toBe("h2");
    // the same slip can be recorded again
    await db.query(
      "insert into slips (user_id,storage_path,image_sha256,slip_ref) values ($1,'p','h1','ref-h1')",
      [me],
    );
  });

  it("a full reset also scrubs slips no kept entry uses; one a shared-wallet entry uses is kept", async () => {
    const { me, shared, tx, slip } = await seed();
    const orphan = await slip(me, "h-orphan", `${me}/orphan.jpg`);
    const used = await slip(me, "h-shared", `${me}/shared.jpg`);
    await tx(me, shared, 50, "2026-10-05T05:00:00Z", "expense", { slip: used });
    const paths = await rows<{ path: string }>(
      db,
      "select path from data_erase_paths($1,null,null,true)",
      [me],
    );
    expect(paths.map((p) => p.path)).toEqual([`${me}/orphan.jpg`]);
    await db.query("select * from data_erase($1,null,null,true,false)", [me]);
    expect(
      (
        await one<{ image_sha256: string }>(db, "select image_sha256 from slips where id = $1", [
          orphan,
        ])
      ).image_sha256,
    ).toBe(`erased:${orphan}`);
    expect(
      (
        await one<{ image_sha256: string }>(db, "select image_sha256 from slips where id = $1", [
          used,
        ])
      ).image_sha256,
    ).toBe("h-shared");
  });

  it("months_with_data lists Bangkok months, newest first, with entries and transfers", async () => {
    const { me, main, bank, shared, tx } = await seed();
    await tx(me, main, 1, "2026-09-30T16:59:59Z"); // September
    await tx(me, main, 2, "2026-09-30T17:00:00Z"); // October
    await tx(me, main, 3, "2026-10-10T05:00:00Z"); // October
    await tx(me, shared, 4, "2026-10-10T05:00:00Z"); // shared: not listed
    await db.query(
      "insert into transfers (user_id,from_account,to_account,amount,occurred_at) values ($1,$2,$3,9,'2026-11-15T05:00:00Z')",
      [me, main, bank],
    );
    const list = await rows<{ month: string; entries: string; transfers: string }>(
      db,
      "select month, entries::text, transfers::text from months_with_data($1)",
      [me],
    );
    expect(list).toEqual([
      { month: "2026-11", entries: "0", transfers: "1" },
      { month: "2026-10", entries: "2", transfers: "0" },
      { month: "2026-09", entries: "1", transfers: "0" },
    ]);
  });
});

describe("shared wallets (0029)", () => {
  async function seed() {
    const ann = await newUser(db, `sw-a-${Math.random()}`);
    const bob = await newUser(db, `sw-b-${Math.random()}`);
    const carl = await newUser(db, `sw-c-${Math.random()}`); // not on the wallet
    const wallet = async (
      user: string,
      name: string,
      over: { shared?: boolean; isDefault?: boolean; kind?: string } = {},
    ) =>
      (
        await one<{ id: string }>(
          db,
          "insert into accounts (user_id,name,kind,is_default,is_shared,opening_balance) values ($1,$2,$3::account_kind,$4,$5,1000) returning id",
          [user, name, over.kind ?? "cash", over.isDefault ?? false, over.shared ?? false],
        )
      ).id;
    const member = (walletId: string, user: string, role = "member") =>
      db.query("insert into wallet_members (wallet_id,user_id,role) values ($1,$2,$3)", [
        walletId,
        user,
        role,
      ]);
    const spend = (user: string, account: string | null, amount: number, type = "expense") =>
      db.query(
        "insert into transactions (user_id,type,amount,title,account_id) values ($1,$2,$3,'x',$4)",
        [user, type, amount, account],
      );
    const annMain = await wallet(ann, "เงินสดแอน", { isDefault: true });
    const bobMain = await wallet(bob, "เงินสดบ๊อบ", { isDefault: true });
    const shared = await wallet(ann, "กองกลาง", { shared: true });
    await member(shared, ann, "owner");
    await member(shared, bob);
    return { ann, bob, carl, annMain, bobMain, shared, member, spend, wallet };
  }
  const balances = (u: string) =>
    rows<{
      name: string;
      income: string;
      expense: string;
      tx_count: number;
      is_shared: boolean;
      member_count: number;
    }>(
      db,
      "select name, income::text, expense::text, tx_count::int, is_shared, member_count::int from wallet_balances($1)",
      [u],
    );

  it("both members see the shared wallet with the entries of both added up, and the member count", async () => {
    const { ann, bob, shared, spend } = await seed();
    await spend(ann, shared, 300);
    await spend(bob, shared, 120);
    await spend(bob, shared, 5000, "income");
    for (const u of [ann, bob]) {
      const w = (await balances(u)).find((x) => x.name === "กองกลาง");
      expect(w).toEqual({
        name: "กองกลาง",
        income: "5000.00",
        expense: "420.00",
        tx_count: 3,
        is_shared: true,
        member_count: 2,
      });
    }
  });

  it("each person's private wallets stay private: the other never sees them or their entries", async () => {
    const { ann, bob, annMain, bobMain, spend } = await seed();
    await spend(ann, annMain, 111);
    await spend(bob, bobMain, 222);
    const forAnn = await balances(ann);
    const forBob = await balances(bob);
    expect(forAnn.map((w) => w.name).sort()).toEqual(["กองกลาง", "เงินสดแอน"].sort());
    expect(forBob.map((w) => w.name).sort()).toEqual(["กองกลาง", "เงินสดบ๊อบ"].sort());
    expect(forAnn.find((w) => w.name === "เงินสดแอน")?.expense).toBe("111.00");
    expect(forBob.find((w) => w.name === "เงินสดบ๊อบ")?.expense).toBe("222.00");
    // the shared wallet shows neither private entry
    expect(forAnn.find((w) => w.name === "กองกลาง")?.expense).toBe("0");
  });

  it("someone who is not on the wallet sees nothing of it", async () => {
    const { carl, ann, shared, spend } = await seed();
    await spend(ann, shared, 300);
    expect(await balances(carl)).toEqual([]);
  });

  it("an entry with no wallet is still the writer's own main wallet, never the shared one", async () => {
    const { ann, bob, spend } = await seed();
    await spend(bob, null, 77);
    const forBob = await balances(bob);
    expect(forBob.find((w) => w.name === "เงินสดบ๊อบ")?.expense).toBe("77.00");
    expect((await balances(ann)).find((w) => w.name === "กองกลาง")?.expense).toBe("0");
  });

  it("a member who left no longer sees it, and what they wrote stays in it", async () => {
    const { ann, bob, shared, spend } = await seed();
    await spend(bob, shared, 50);
    await db.query("delete from wallet_members where wallet_id = $1 and user_id = $2", [
      shared,
      bob,
    ]);
    expect((await balances(bob)).map((w) => w.name)).toEqual(["เงินสดบ๊อบ"]);
    const w = (await balances(ann)).find((x) => x.name === "กองกลาง");
    expect(w).toMatchObject({ expense: "50.00", member_count: 1 });
  });

  it("the person's own wallets come first", async () => {
    const { bob } = await seed();
    expect((await balances(bob))[0]?.name).toBe("เงินสดบ๊อบ");
  });

  it("a shared wallet cannot be the main wallet or a card", async () => {
    const { ann, wallet } = await seed();
    await expect(wallet(ann, "x1", { shared: true, isDefault: true })).rejects.toThrow();
    await expect(wallet(ann, "x2", { shared: true, kind: "card" })).rejects.toThrow();
  });

  it("members: once per wallet, only owner / member roles; deleting the wallet clears them and the invites", async () => {
    const { bob, carl, shared, member } = await seed();
    await expect(member(shared, bob)).rejects.toThrow();
    await expect(member(shared, carl, "boss")).rejects.toThrow();
    await db.query(
      "insert into wallet_invites (code,wallet_id,created_by,expires_at) select '482913', $1, user_id, now() + interval '1 day' from accounts where id = $1",
      [shared],
    );
    await expect(
      db.query(
        "insert into wallet_invites (code,wallet_id,created_by,expires_at) select '482913', $1, user_id, now() from accounts where id = $1",
        [shared],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "insert into wallet_invites (code,wallet_id,created_by,expires_at) select '12345', $1, user_id, now() from accounts where id = $1",
        [shared],
      ),
    ).rejects.toThrow();
    await db.query("delete from accounts where id = $1", [shared]);
    const left = await one<{ n: string }>(
      db,
      "select ((select count(*) from wallet_members where wallet_id=$1) + (select count(*) from wallet_invites where wallet_id=$1))::text as n",
      [shared],
    );
    expect(left.n).toBe("0");
  });

  it("deleting a shared wallet keeps everybody's entries, unpointed", async () => {
    const { ann, bob, shared, spend } = await seed();
    await spend(ann, shared, 1);
    await spend(bob, shared, 2);
    await db.query("delete from accounts where id = $1", [shared]);
    const left = await one<{ n: string; a: string | null }>(
      db,
      "select count(*)::text as n, max(account_id::text) as a from transactions where user_id in ($1,$2)",
      [ann, bob],
    );
    expect(left).toEqual({ n: "2", a: null });
  });
});

describe("group trips (0028)", () => {
  async function seed() {
    const owner = await newUser(db, `gt-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const trip = async (name: string, status = "open", g = group) =>
      (
        await one<{ id: string }>(
          db,
          "insert into group_trips (group_id,name,started_by,status) values ($1,$2,'Uanna',$3) returning id",
          [g, name, status],
        )
      ).id;
    return { group, trip };
  }

  it("a group has one open trip at a time, but any number of closed ones", async () => {
    const { group, trip } = await seed();
    await trip("เชียงใหม่");
    await expect(trip("ภูเก็ต")).rejects.toThrow();
    await trip("เก่า 1", "closed");
    await trip("เก่า 2", "closed");
    const open = await one<{ n: string }>(
      db,
      "select count(*)::text as n from group_trips where group_id = $1 and status = 'open'",
      [group],
    );
    expect(open.n).toBe("1");
  });

  it("another group can have its own open trip", async () => {
    const a = await seed();
    const b = await seed();
    await a.trip("ทริป");
    await b.trip("ทริป");
  });

  it("a member joins a trip once", async () => {
    const { trip } = await seed();
    const t = await trip("x");
    await db.query("insert into group_trip_members (trip_id,line_user_id) values ($1,'Uanna')", [
      t,
    ]);
    await expect(
      db.query("insert into group_trip_members (trip_id,line_user_id) values ($1,'Uanna')", [t]),
    ).rejects.toThrow();
  });

  it("entries keep their trip, the people it was split between and the original currency", async () => {
    const { group, trip } = await seed();
    const t = await trip("ญี่ปุ่น");
    const e = await one<{
      split_mode: string;
      split_users: string[];
      orig_currency: string;
      orig_amount: string;
    }>(
      db,
      "insert into group_entries (group_id,payer_line_user_id,title,amount,trip_id,split_mode,split_users,orig_currency,orig_amount,fx_rate) values ($1,'Uanna','ราเมน',350.25,$2,'only','{Uanna,Ubob}','JPY',1500,0.2335) returning split_mode, split_users, orig_currency, orig_amount::text",
      [group, t],
    );
    expect(e).toEqual({
      split_mode: "only",
      split_users: ["Uanna", "Ubob"],
      orig_currency: "JPY",
      orig_amount: "1500.00",
    });
  });

  it("a plain entry is split 'all' with nobody listed, and has no trip", async () => {
    const { group } = await seed();
    const e = await one<{ split_mode: string; split_users: string[]; trip_id: string | null }>(
      db,
      "insert into group_entries (group_id,payer_line_user_id,title,amount) values ($1,'Uanna','x',5) returning split_mode, split_users, trip_id",
      [group],
    );
    expect(e).toEqual({ split_mode: "all", split_users: [], trip_id: null });
  });

  it("refuses an unknown split mode; deleting a trip keeps its entries (without the trip)", async () => {
    const { group, trip } = await seed();
    await expect(
      db.query(
        "insert into group_entries (group_id,payer_line_user_id,title,amount,split_mode) values ($1,'U','x',5,'half')",
        [group],
      ),
    ).rejects.toThrow();
    const t = await trip("x");
    await db.query(
      "insert into group_entries (group_id,payer_line_user_id,title,amount,trip_id) values ($1,'U','x',5,$2)",
      [group, t],
    );
    await db.query("delete from group_trips where id = $1", [t]);
    const left = await one<{ n: string; t: string | null }>(
      db,
      "select count(*)::text as n, max(trip_id::text) as t from group_entries where group_id = $1",
      [group],
    );
    expect(left).toEqual({ n: "1", t: null });
  });
});

describe("group ledger (0027)", () => {
  async function seed() {
    const owner = await newUser(db, `gl-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const entry = (
      payer: string,
      amount: number,
      at = "2026-10-10T05:00:00Z",
      status = "confirmed",
      g = group,
    ) =>
      db.query(
        "insert into group_entries (group_id,payer_line_user_id,title,amount,occurred_at,status) values ($1,$2,'x',$3,$4,$5)",
        [g, payer, amount, at, status],
      );
    return { owner, group, entry };
  }
  const totals = (g: string, from = "2026-10-01T00:00:00Z", to = "2026-11-01T00:00:00Z") =>
    rows<{ payer_line_user_id: string; total: string; entries: number }>(
      db,
      "select payer_line_user_id, total::text, entries::int from group_payer_totals($1,$2,$3)",
      [g, from, to],
    );

  it("adds up what each member paid, biggest first, ignoring deleted entries and other periods", async () => {
    const { group, entry } = await seed();
    await entry("Uanna", 300);
    await entry("Ubob", 1200.5);
    await entry("Uanna", 50);
    await entry("Ubob", 999, "2026-10-11T05:00:00Z", "deleted");
    await entry("Uanna", 777, "2026-09-01T05:00:00Z"); // another month
    expect(await totals(group)).toEqual([
      { payer_line_user_id: "Ubob", total: "1200.50", entries: 1 },
      { payer_line_user_id: "Uanna", total: "350.00", entries: 2 },
    ]);
  });

  it("one row per LINE group; a member is listed once per group", async () => {
    const { owner, group } = await seed();
    const line = await one<{ line_group_id: string }>(
      db,
      "select line_group_id from bot_groups where id = $1",
      [group],
    );
    await expect(
      db.query("insert into bot_groups (line_group_id, owner_user_id) values ($1,$2)", [
        line.line_group_id,
        owner,
      ]),
    ).rejects.toThrow();
    await db.query(
      "insert into group_members (group_id,line_user_id,display_name) values ($1,'Uanna','แอน')",
      [group],
    );
    await expect(
      db.query(
        "insert into group_members (group_id,line_user_id,display_name) values ($1,'Uanna','แอนใหม่')",
        [group],
      ),
    ).rejects.toThrow();
  });

  it("refuses a zero amount, a long title and an unknown status", async () => {
    const { group, entry } = await seed();
    await expect(entry("Uanna", 0)).rejects.toThrow();
    await expect(entry("Uanna", 10, "2026-10-10T05:00:00Z", "weird")).rejects.toThrow();
    await expect(
      db.query(
        "insert into group_entries (group_id,payer_line_user_id,title,amount) values ($1,'U',$2,5)",
        [group, "x".repeat(61)],
      ),
    ).rejects.toThrow();
  });

  it("deleting the group deletes its members and entries; another group's totals stay apart", async () => {
    const { group, entry } = await seed();
    const other = await seed();
    await entry("Uanna", 100);
    await other.entry("Uanna", 5);
    await db.query(
      "insert into group_members (group_id,line_user_id,display_name) values ($1,'Uanna','แอน')",
      [group],
    );
    expect((await totals(other.group))[0]?.total).toBe("5.00");
    await db.query("delete from bot_groups where id = $1", [group]);
    const left = await one<{ n: string }>(
      db,
      "select ((select count(*) from group_entries where group_id=$1) + (select count(*) from group_members where group_id=$1))::text as n",
      [group],
    );
    expect(left.n).toBe("0");
  });
});

describe("bills (0026)", () => {
  async function seed() {
    const u = await newUser(db, `b-${Math.random()}`);
    const bill = (
      name: string,
      over: {
        cadence?: string;
        day?: number;
        month?: number | null;
        hour?: number;
        amount?: number | null;
      } = {},
    ) =>
      db.query(
        "insert into bills (user_id,name,amount,cadence,day_of_month,month_of_year,next_due_on,remind_hour) values ($1,$2,$3,$4,$5,$6,'2026-11-15',$7)",
        [
          u,
          name,
          over.amount ?? null,
          over.cadence ?? "monthly",
          over.day ?? 15,
          over.month ?? null,
          over.hour ?? 9,
        ],
      );
    return { u, bill };
  }

  it("keeps a bill with the defaults: remind 1 day before at 09:00", async () => {
    const { u, bill } = await seed();
    await bill("ค่าไฟ", { amount: 1250 });
    const b = await one<{
      remind_days: number[];
      remind_hour: number;
      is_active: boolean;
      amount: string;
    }>(db, "select remind_days, remind_hour, is_active, amount::text from bills where user_id=$1", [
      u,
    ]);
    expect(b).toEqual({ remind_days: [1], remind_hour: 9, is_active: true, amount: "1250.00" });
  });

  it("a name is used once among live bills (ignoring case), and may be reused once switched off", async () => {
    const { u, bill } = await seed();
    await bill("Rent");
    await expect(bill("rent")).rejects.toThrow();
    await db.query("update bills set is_active = false where user_id = $1", [u]);
    await bill("Rent");
  });

  it.each([
    ["a day of 0 or 32", { day: 32 }],
    ["an hour of 24", { hour: 24 }],
    ["a month of 13", { month: 13, cadence: "yearly" }],
    ["a zero amount", { amount: 0 }],
    ["an unknown cadence", { cadence: "weekly" }],
  ])("refuses %s", async (_name, over) => {
    const { bill } = await seed();
    await expect(bill("x", over)).rejects.toThrow();
  });

  it("remembers which reminders were sent: the same key only once", async () => {
    const { u } = await seed();
    const key = "b1:2026-11-15:1";
    await db.query("insert into bill_reminders (user_id,key) values ($1,$2)", [u, key]);
    await expect(
      db.query("insert into bill_reminders (user_id,key) values ($1,$2)", [u, key]),
    ).rejects.toThrow();
    await db.query("insert into bill_reminders (user_id,key) values ($1,$2)", [
      u,
      "b1:2026-11-15:0",
    ]);
  });
});

describe("savings goals (0025)", () => {
  async function seed() {
    const u = await newUser(db, `g-${Math.random()}`);
    const other = await newUser(db, `g-other-${Math.random()}`);
    const goal = async (user: string, name: string, target = 30000) =>
      (
        await one<{ id: string }>(
          db,
          "insert into savings_goals (user_id,name,target_amount) values ($1,$2,$3) returning id",
          [user, name, target],
        )
      ).id;
    const deposit = (user: string, goalId: string, amount: number) =>
      db.query("insert into savings_deposits (user_id,goal_id,amount) values ($1,$2,$3)", [
        user,
        goalId,
        amount,
      ]);
    return { u, other, goal, deposit };
  }
  const balances = (u: string) =>
    rows<{ name: string; saved: string; target_amount: string; archived: boolean }>(
      db,
      "select name, saved::text, target_amount::text, (archived_at is not null) as archived from goal_balances($1)",
      [u],
    );

  it("adds deposits and withdrawals into what is saved", async () => {
    const { u, goal, deposit } = await seed();
    const g = await goal(u, "เที่ยวญี่ปุ่น");
    await deposit(u, g, 2000);
    await deposit(u, g, 500);
    await deposit(u, g, -300);
    expect(await balances(u)).toEqual([
      { name: "เที่ยวญี่ปุ่น", saved: "2200.00", target_amount: "30000.00", archived: false },
    ]);
  });

  it("a goal with no deposits has saved nothing; archived goals come last", async () => {
    const { u, goal } = await seed();
    const old = await goal(u, "เก่า");
    await goal(u, "ใหม่");
    await db.query("update savings_goals set archived_at = now() where id = $1", [old]);
    const list = await balances(u);
    expect(list.map((b) => [b.name, b.saved, b.archived])).toEqual([
      ["ใหม่", "0", false],
      ["เก่า", "0", true],
    ]);
  });

  it("a name is used once per person among live goals (ignoring case), but can be reused once archived", async () => {
    const { u, other, goal } = await seed();
    const a = await goal(u, "Japan");
    await expect(goal(u, "japan")).rejects.toThrow();
    await goal(other, "Japan"); // somebody else may use it
    await db.query("update savings_goals set archived_at = now() where id = $1", [a]);
    await goal(u, "Japan");
  });

  it("deleting a goal deletes its deposits; zero deposits and zero targets are refused", async () => {
    const { u, goal, deposit } = await seed();
    const g = await goal(u, "x");
    await deposit(u, g, 100);
    await expect(deposit(u, g, 0)).rejects.toThrow();
    await expect(goal(u, "y", 0)).rejects.toThrow();
    await db.query("delete from savings_goals where id = $1", [g]);
    const left = await one<{ n: string }>(
      db,
      "select count(*)::text as n from savings_deposits where goal_id = $1",
      [g],
    );
    expect(left.n).toBe("0");
  });

  it("another person's goals never show up", async () => {
    const { u, other, goal, deposit } = await seed();
    const g = await goal(other, "ของคนอื่น");
    await deposit(other, g, 999);
    expect(await balances(u)).toEqual([]);
  });
});

describe("daily budget (0024)", () => {
  it("is empty until set, then holds a positive amount", async () => {
    const u = await newUser(db, `db-${Math.random()}`);
    expect(
      (
        await one<{ daily_budget: string | null }>(
          db,
          "select daily_budget::text from user_settings where user_id=$1",
          [u],
        )
      ).daily_budget,
    ).toBeNull();
    await db.query("update user_settings set daily_budget = 500 where user_id = $1", [u]);
    expect(
      (
        await one<{ daily_budget: string }>(
          db,
          "select daily_budget::text from user_settings where user_id=$1",
          [u],
        )
      ).daily_budget,
    ).toBe("500.00");
    await db.query("update user_settings set daily_budget = null where user_id = $1", [u]);
  });

  it("refuses zero and negative amounts", async () => {
    const u = await newUser(db, `db0-${Math.random()}`);
    await expect(
      db.query("update user_settings set daily_budget = 0 where user_id = $1", [u]),
    ).rejects.toThrow();
    await expect(
      db.query("update user_settings set daily_budget = -5 where user_id = $1", [u]),
    ).rejects.toThrow();
  });
});

describe("foreign currency (0023)", () => {
  it("keeps the original amount, currency and rate next to the baht amount", async () => {
    const u = await newUser(db, `fx-${Math.random()}`);
    const t = await one<{
      amount: string;
      orig_currency: string;
      orig_amount: string;
      fx_rate: string;
    }>(
      db,
      "insert into transactions (user_id,type,amount,title,orig_currency,orig_amount,fx_rate) values ($1,'expense',350.25,'ราเมน','JPY',1500,0.23350000) returning amount::text, orig_currency, orig_amount::text, fx_rate::text",
      [u],
    );
    expect(t).toEqual({
      amount: "350.25",
      orig_currency: "JPY",
      orig_amount: "1500.00",
      fx_rate: "0.23350000",
    });
    // and the baht amount is what the summaries add up
    const s = await one<{ expense: string }>(
      db,
      "select expense::text from summary_by_period($1, now() - interval '1 day', now() + interval '1 day')",
      [u],
    );
    expect(s.expense).toBe("350.25");
  });

  it("plain entries have no original currency", async () => {
    const u = await newUser(db, `fx-plain-${Math.random()}`);
    const t = await one<{ orig_currency: string | null }>(
      db,
      "insert into transactions (user_id,type,amount,title) values ($1,'expense',10,'x') returning orig_currency",
      [u],
    );
    expect(t.orig_currency).toBeNull();
  });

  it("refuses a lower-case or too long currency code and a zero rate", async () => {
    const u = await newUser(db, `fx-bad-${Math.random()}`);
    const ins = (cur: string, rate: number) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,orig_currency,orig_amount,fx_rate) values ($1,'expense',1,'x',$2,10,$3)",
        [u, cur, rate],
      );
    await expect(ins("jpy", 1)).rejects.toThrow();
    await expect(ins("JPYX", 1)).rejects.toThrow();
    await expect(ins("JPY", 0)).rejects.toThrow();
  });

  it("caches one rate per day and currency", async () => {
    await db.query(
      "insert into fx_rates (day,currency,rate,source_day) values ('2026-10-17','JPY',0.2335,'2026-10-16')",
    );
    await expect(
      db.query(
        "insert into fx_rates (day,currency,rate,source_day) values ('2026-10-17','JPY',0.24,'2026-10-16')",
      ),
    ).rejects.toThrow();
    const r = await one<{ rate: string }>(
      db,
      "select rate::text from fx_rates where day='2026-10-17' and currency='JPY'",
    );
    expect(r.rate).toBe("0.23350000");
  });
});

describe("debts (0022)", () => {
  async function seed() {
    const u = await newUser(db, `d-${Math.random()}`);
    const other = await newUser(db, `d-other-${Math.random()}`);
    const wallet = async (user: string, name: string, isDefault: boolean, opening: number) =>
      (
        await one<{ id: string }>(
          db,
          "insert into accounts (user_id,name,kind,is_default,opening_balance) values ($1,$2,'cash'::account_kind,$3,$4) returning id",
          [user, name, isDefault, opening],
        )
      ).id;
    const main = await wallet(u, "เงินสด", true, 10_000);
    const bank = await wallet(u, "กสิกร", false, 0);
    return { u, other, main, bank };
  }
  const debt = async (
    u: string,
    direction: string,
    person: string,
    amount: number,
    account: string | null,
  ) =>
    (
      await one<{ id: string }>(
        db,
        "insert into debts (user_id,direction,person,amount,account_id) values ($1,$2,$3,$4,$5) returning id",
        [u, direction, person, amount, account],
      )
    ).id;
  const pay = (u: string, debtId: string, amount: number, account: string | null) =>
    db.query("insert into debt_payments (user_id,debt_id,amount,account_id) values ($1,$2,$3,$4)", [
      u,
      debtId,
      amount,
      account,
    ]);
  const balances = (u: string) =>
    rows<{ name: string; income: string; expense: string; debt_in: string; debt_out: string }>(
      db,
      "select name, income::text, expense::text, debt_in::text, debt_out::text from wallet_balances($1)",
      [u],
    );

  it("lending takes money out of the wallet and a repayment puts it back, in any wallet", async () => {
    const { u, main, bank } = await seed();
    const d = await debt(u, "lent", "สมชาย", 500, main);
    await pay(u, d, 200, main);
    await pay(u, d, 100, bank); // paid back into another wallet
    expect(await balances(u)).toEqual([
      { name: "เงินสด", income: "0", expense: "0", debt_in: "200.00", debt_out: "500.00" },
      { name: "กสิกร", income: "0", expense: "0", debt_in: "100.00", debt_out: "0" },
    ]);
  });

  it("borrowing brings money in and paying it back sends it out", async () => {
    const { u, bank } = await seed();
    const d = await debt(u, "borrowed", "แม่", 2000, bank);
    await pay(u, d, 800, bank);
    const b = (await balances(u)).find((x) => x.name === "กสิกร");
    expect(b).toMatchObject({ debt_in: "2000.00", debt_out: "800.00" });
  });

  it("a debt with no wallet belongs to the main wallet and is never income or expense", async () => {
    const { u } = await seed();
    await debt(u, "lent", "ก", 300, null);
    const main = (await balances(u))[0];
    expect(main).toMatchObject({ name: "เงินสด", income: "0", expense: "0", debt_out: "300.00" });
  });

  it("debt_balances shows what is paid and left, open debts first", async () => {
    const { u, main } = await seed();
    const a = await debt(u, "lent", "เก่า", 100, main);
    await pay(u, a, 100, main); // settled
    const b = await debt(u, "lent", "ใหม่", 400, main);
    await pay(u, b, 150, main);
    const list = await rows<{ person: string; paid: string; remaining: string }>(
      db,
      "select person, paid::text, remaining::text from debt_balances($1)",
      [u],
    );
    expect(list).toEqual([
      { person: "ใหม่", paid: "150.00", remaining: "250.00" },
      { person: "เก่า", paid: "100.00", remaining: "0.00" },
    ]);
  });

  it("deleting a debt takes its payments with it and restores the wallet", async () => {
    const { u, main } = await seed();
    const d = await debt(u, "lent", "ก", 500, main);
    await pay(u, d, 100, main);
    await db.query("delete from debts where id = $1", [d]);
    expect((await balances(u))[0]).toMatchObject({ debt_in: "0", debt_out: "0" });
  });

  it("a deleted wallet's debts fall back to the main wallet", async () => {
    const { u, bank } = await seed();
    await debt(u, "lent", "ก", 500, bank);
    await db.query("delete from accounts where id = $1", [bank]);
    expect((await balances(u))[0]).toMatchObject({ name: "เงินสด", debt_out: "500.00" });
  });

  it("refuses a zero amount, a bad direction and an empty name", async () => {
    const { u } = await seed();
    await expect(debt(u, "lent", "ก", 0, null)).rejects.toThrow();
    await expect(debt(u, "gift", "ก", 10, null)).rejects.toThrow();
    await expect(debt(u, "lent", "", 10, null)).rejects.toThrow();
  });

  it("another person's debts never show up", async () => {
    const { u, other } = await seed();
    await debt(other, "lent", "คนอื่น", 999, null);
    const list = await rows(db, "select * from debt_balances($1)", [u]);
    expect(list).toHaveLength(0);
  });
});

describe("credit cards (0021)", () => {
  async function seed() {
    const u = await newUser(db, `cc-${Math.random()}`);
    const main = (
      await one<{ id: string }>(
        db,
        "insert into accounts (user_id,name,kind,is_default) values ($1,'เงินสด','cash'::account_kind,true) returning id",
        [u],
      )
    ).id;
    const card = (
      await one<{ id: string }>(
        db,
        "insert into accounts (user_id,name,kind,credit_limit,statement_day,due_day) values ($1,'KTC','card'::account_kind,50000,25,10) returning id",
        [u],
      )
    ).id;
    const spend = (account: string | null, amount: number, at: string, status = "confirmed") =>
      db.query(
        "insert into transactions (user_id,type,amount,title,account_id,status,occurred_at) values ($1,'expense',$2,'x',$3,$4,$5)",
        [u, amount, account, status, at],
      );
    await spend(card, 1000, "2026-09-26T05:00:00Z"); // previous statement cycle
    await spend(card, 300, "2026-10-05T05:00:00Z");
    await spend(card, 200, "2026-10-06T05:00:00Z");
    await spend(card, 999, "2026-10-07T05:00:00Z", "deleted"); // ignored
    await spend(main, 70, "2026-10-06T05:00:00Z"); // another wallet
    await spend(null, 5, "2026-10-06T05:00:00Z"); // main wallet
    return { u, main, card };
  }
  const between = (u: string, account: string, from: string, to: string) =>
    one<{ v: string }>(db, "select wallet_expense_between($1,$2,$3,$4)::text as v", [
      u,
      account,
      from,
      to,
    ]).then((r) => r.v);

  it("the limit and the two days come back with the balances", async () => {
    const { u } = await seed();
    const card = (
      await rows<{
        name: string;
        credit_limit: string | null;
        statement_day: number | null;
        due_day: number | null;
      }>(
        db,
        "select name, credit_limit::text, statement_day::int, due_day::int from wallet_balances($1) where name = 'KTC'",
        [u],
      )
    )[0];
    expect(card).toEqual({ name: "KTC", credit_limit: "50000.00", statement_day: 25, due_day: 10 });
  });

  it("adds up the spending of one wallet inside a statement cycle", async () => {
    const { u, card, main } = await seed();
    expect(await between(u, card, "2026-09-25T00:00:00Z", "2026-10-25T00:00:00Z")).toBe("1500.00");
    expect(await between(u, card, "2026-10-01T00:00:00Z", "2026-10-25T00:00:00Z")).toBe("500.00");
    // the main wallet also owns entries that never got a wallet
    expect(await between(u, main, "2026-10-01T00:00:00Z", "2026-10-25T00:00:00Z")).toBe("75.00");
  });

  it("another person's wallet gives nothing", async () => {
    const { card } = await seed();
    const stranger = await newUser(db, `cc-x-${Math.random()}`);
    expect(await between(stranger, card, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toBe("0");
  });

  it("refuses a limit of zero and a statement day outside 1-28", async () => {
    const { u } = await seed();
    await expect(
      db.query(
        "insert into accounts (user_id,name,kind,credit_limit) values ($1,'A','card'::account_kind,0)",
        [u],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "insert into accounts (user_id,name,kind,statement_day) values ($1,'B','card'::account_kind,31)",
        [u],
      ),
    ).rejects.toThrow();
  });
});

describe("transfers (0020)", () => {
  async function seed() {
    const u = await newUser(db, `tr-${Math.random()}`);
    const other = await newUser(db, `tr-other-${Math.random()}`);
    const wallet = async (user: string, name: string, isDefault: boolean, opening: number) =>
      (
        await one<{ id: string }>(
          db,
          "insert into accounts (user_id,name,kind,is_default,opening_balance) values ($1,$2,'cash'::account_kind,$3,$4) returning id",
          [user, name, isDefault, opening],
        )
      ).id;
    const main = await wallet(u, "เงินสด", true, 1000);
    const bank = await wallet(u, "กสิกร", false, 0);
    const theirs = await wallet(other, "ของคนอื่น", true, 0);
    return { u, other, main, bank, theirs };
  }
  const transfer = (user: string, from: string | null, to: string | null, amount: number) =>
    db.query(
      "insert into transfers (user_id,from_account,to_account,amount) values ($1,$2,$3,$4)",
      [user, from, to, amount],
    );
  const balances = (u: string) =>
    rows<{
      name: string;
      income: string;
      expense: string;
      transfer_in: string;
      transfer_out: string;
    }>(
      db,
      "select name, income::text, expense::text, transfer_in::text, transfer_out::text from wallet_balances($1)",
      [u],
    );

  it("moves money between wallets and is not income or expense", async () => {
    const { u, main, bank } = await seed();
    await transfer(u, main, bank, 400);
    await transfer(u, bank, main, 50);
    expect(await balances(u)).toEqual([
      { name: "เงินสด", income: "0", expense: "0", transfer_in: "50.00", transfer_out: "400.00" },
      { name: "กสิกร", income: "0", expense: "0", transfer_in: "400.00", transfer_out: "50.00" },
    ]);
    const totals = await one<{ income: string; expense: string }>(
      db,
      "select coalesce(sum(amount) filter (where type='income'),0)::text as income, coalesce(sum(amount) filter (where type='expense'),0)::text as expense from transactions where user_id=$1",
      [u],
    );
    expect(totals).toEqual({ income: "0", expense: "0" });
  });

  it("refuses a zero amount and a transfer to the same wallet", async () => {
    const { u, main, bank } = await seed();
    await expect(transfer(u, main, bank, 0)).rejects.toThrow();
    await expect(transfer(u, main, main, 10)).rejects.toThrow();
  });

  it("a deleted wallet's transfers fall back to the main wallet", async () => {
    const { u, main, bank } = await seed();
    await transfer(u, main, bank, 400);
    await db.query("delete from accounts where id = $1", [bank]);
    // the money left the main wallet and went to "no wallet" = the main wallet: net zero
    expect(await balances(u)).toEqual([
      { name: "เงินสด", income: "0", expense: "0", transfer_in: "400.00", transfer_out: "400.00" },
    ]);
  });

  it("another person's transfers never show up", async () => {
    const { u, other, main, bank, theirs } = await seed();
    await transfer(u, main, bank, 10);
    const second = await one<{ id: string }>(
      db,
      "insert into accounts (user_id,name,kind) values ($1,'อีกใบ','bank'::account_kind) returning id",
      [other],
    );
    await transfer(other, theirs, second.id, 999);
    const mine = await balances(u);
    expect(mine.map((b) => b.name)).toEqual(["เงินสด", "กสิกร"]);
    expect(mine[0]?.transfer_out).toBe("10.00");
  });
});

describe("top_titles (0018)", () => {
  async function seed() {
    const u = await newUser(db, `tt-${Math.random()}`);
    const other = await newUser(db, `tt-other-${Math.random()}`);
    const ins = (
      user: string,
      type: string,
      amount: number,
      title: string,
      status = "confirmed",
      at = "2026-10-10T05:00:00Z",
    ) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,status,occurred_at) values ($1,$2,$3,$4,$5,$6)",
        [user, type, amount, title, status, at],
      );
    await ins(u, "expense", 70, "ชานม");
    await ins(u, "expense", 70, " ชานม ");
    await ins(u, "expense", 80, "ชา  นม"); // a different name once the inner spaces are tidied
    await ins(u, "expense", 100, "Grab");
    await ins(u, "expense", 50, "grab");
    await ins(u, "expense", 500, "ข้าว", "deleted");
    await ins(u, "expense", 400, "ข้าว", "pending_confirm");
    await ins(u, "expense", 999, "นอกช่วง", "confirmed", "2026-09-01T05:00:00Z");
    await ins(u, "income", 300, "ขายของ");
    await ins(other, "expense", 5000, "ของคนอื่น");
    return u;
  }
  const titles = (u: string, type = "expense", limit = 10) =>
    rows<{ title: string; total: string; tx_count: number }>(
      db,
      "select title, total::text, tx_count::int from top_titles($1,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',$2::tx_type,$3)",
      [u, type, limit],
    );

  it("adds up entries with the same name, biggest first, only this user's confirmed ones", async () => {
    const u = await seed();
    expect(await titles(u)).toEqual([
      { title: "grab", total: "150.00", tx_count: 2 },
      { title: "ชานม", total: "140.00", tx_count: 2 },
      { title: "ชา นม", total: "80.00", tx_count: 1 },
    ]);
  });

  it("follows the type", async () => {
    const u = await seed();
    expect(await titles(u, "income")).toEqual([{ title: "ขายของ", total: "300.00", tx_count: 1 }]);
  });

  it("honours the limit, and never returns more than fifty", async () => {
    const u = await seed();
    expect(await titles(u, "expense", 1)).toHaveLength(1);
    expect(await titles(u, "expense", 0)).toHaveLength(1); // at least one
    expect(await titles(u, "expense", 9999)).toHaveLength(3);
  });

  it("is empty for a period with nothing", async () => {
    const u = await newUser(db, `tt-empty-${Math.random()}`);
    expect(await titles(u)).toEqual([]);
  });
});

describe("period_totals_by_source (0017)", () => {
  it("splits a period into recurring and other, counting confirmed entries of that user only", async () => {
    const u = await newUser(db, `pt-${Math.random()}`);
    const other = await newUser(db, `pt-other-${Math.random()}`);
    const ins = (
      user: string,
      type: string,
      amount: number,
      source: string,
      status = "confirmed",
      at = "2026-10-10T05:00:00Z",
    ) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,source,status,occurred_at) values ($1,$2,$3,'x',$4,$5,$6)",
        [user, type, amount, source, status, at],
      );
    await ins(u, "expense", 100, "text");
    await ins(u, "expense", 5000, "recurring"); // rent
    await ins(u, "income", 25_000, "recurring"); // salary
    await ins(u, "income", 300, "manual");
    await ins(u, "expense", 999, "text", "deleted");
    await ins(u, "expense", 888, "text", "pending_confirm");
    await ins(u, "expense", 777, "text", "confirmed", "2026-09-01T05:00:00Z"); // another period
    await ins(other, "expense", 1000, "text");
    const r = await one<{
      income: string;
      expense: string;
      recurring_income: string;
      recurring_expense: string;
      tx_count: number;
    }>(
      db,
      "select income::text, expense::text, recurring_income::text, recurring_expense::text, tx_count::int from period_totals_by_source($1,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')",
      [u],
    );
    expect(r).toEqual({
      income: "25300.00",
      expense: "5100.00",
      recurring_income: "25000.00",
      recurring_expense: "5000.00",
      tx_count: 4,
    });
  });

  it("is all zero for an empty period", async () => {
    const u = await newUser(db, `pt-empty-${Math.random()}`);
    const r = await one<{ tx_count: number; expense: string }>(
      db,
      "select expense::text, tx_count::int from period_totals_by_source($1,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z')",
      [u],
    );
    expect(r).toEqual({ expense: "0", tx_count: 0 });
  });
});

describe("search_totals (0016)", () => {
  async function seed() {
    const u = await newUser(db, `search-${Math.random()}`);
    const other = await newUser(db, `search-other-${Math.random()}`);
    const ins = (
      user: string,
      type: string,
      amount: number,
      title: string,
      tags = "{}",
      status = "confirmed",
      at = "2026-10-10T05:00:00Z",
    ) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,tags,status,occurred_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [user, type, amount, title, tags, status, at],
      );
    await ins(u, "expense", 60, "กาแฟเย็น");
    await ins(u, "expense", 45.5, "กาแฟร้อน", "{ปาร์ตี้}");
    await ins(u, "income", 100, "ขายกาแฟ", "{ปาร์ตี้,trip}", "confirmed", "2026-09-01T05:00:00Z");
    await ins(u, "expense", 500, "ข้าวมันไก่", "{trip}");
    await ins(u, "expense", 999, "กาแฟลบแล้ว", "{}", "deleted");
    await ins(u, "expense", 888, "กาแฟรอยืนยัน", "{}", "pending_confirm");
    await ins(u, "expense", 77, "50% off_sale");
    await ins(other, "expense", 1000, "กาแฟของคนอื่น");
    return u;
  }
  const totals = async (
    u: string,
    q: string | null,
    tag: string | null = null,
    from: string | null = null,
    to: string | null = null,
  ) =>
    one<{ income: string; expense: string; tx_count: number }>(
      db,
      "select income::text, expense::text, tx_count::int from search_totals($1,$2,$3,$4,$5)",
      [u, q, tag, from, to],
    );

  it("adds up what a word finds, only for that user and only confirmed entries", async () => {
    const u = await seed();
    expect(await totals(u, "กาแฟ")).toEqual({ income: "100.00", expense: "105.50", tx_count: 3 });
  });

  it("finds by tag, lower-case, and by tag and word together", async () => {
    const u = await seed();
    expect(await totals(u, null, "trip")).toEqual({
      income: "100.00",
      expense: "500.00",
      tx_count: 2,
    });
    expect(await totals(u, null, "TRIP")).toMatchObject({ tx_count: 2 });
    expect(await totals(u, "กาแฟ", "ปาร์ตี้")).toEqual({
      income: "100.00",
      expense: "45.50",
      tx_count: 2,
    });
  });

  it("can be limited to a period", async () => {
    const u = await seed();
    expect(await totals(u, "กาแฟ", null, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")).toEqual({
      income: "0",
      expense: "105.50",
      tx_count: 2,
    });
  });

  it("matches text literally: % and _ are not wildcards", async () => {
    const u = await seed();
    expect(await totals(u, "50%")).toMatchObject({ tx_count: 1 });
    expect(await totals(u, "%")).toMatchObject({ tx_count: 1 });
    expect(await totals(u, "_")).toMatchObject({ tx_count: 1 });
    expect(await totals(u, "ไม่มีคำนี้")).toEqual({ income: "0", expense: "0", tx_count: 0 });
  });

  it("with no filter at all it is every confirmed entry of that user", async () => {
    const u = await seed();
    expect(await totals(u, null)).toMatchObject({ tx_count: 5 });
  });
});

describe("summary and analytics functions", () => {
  it("add up confirmed entries only, in satang-exact numeric", async () => {
    const u = await newUser(db, "sums");
    const food = await one<{ id: string }>(
      db,
      "select id from categories where name = 'อาหาร' and user_id is null",
    );
    const add = (
      type: string,
      amount: string,
      at: string,
      status = "confirmed",
      cat: string | null = food.id,
    ) =>
      db.query(
        "insert into transactions (user_id,type,amount,title,category_id,occurred_at,status) values ($1,$2,$3,'t',$4,$5,$6)",
        [u, type, amount, cat, at, status],
      );
    await add("income", "1000.00", "2026-10-10T05:00:00Z");
    await add("expense", "250.50", "2026-10-11T05:00:00Z");
    await add("expense", "0.10", "2026-10-12T05:00:00Z");
    await add("expense", "999.00", "2026-10-12T05:00:00Z", "deleted"); // ignored
    await add("expense", "999.00", "2026-10-12T05:00:00Z", "pending_confirm"); // ignored
    await add("expense", "5.00", "2026-09-01T05:00:00Z"); // outside the range

    const s = await one<{ income: string; expense: string; balance: string; tx_count: string }>(
      db,
      "select * from summary_by_period($1, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')",
      [u],
    );
    expect(Number(s.income)).toBe(1000);
    expect(Number(s.expense)).toBe(250.6);
    expect(Number(s.balance)).toBe(749.4);
    expect(Number(s.tx_count)).toBe(3);

    const cats = await rows<{ name: string; total: string }>(
      db,
      "select name, total from spend_by_category($1, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')",
      [u],
    );
    expect(cats).toHaveLength(1);
    expect(cats[0]?.name).toBe("อาหาร");
    expect(Number(cats[0]?.total)).toBe(250.6);
  });

  it("analytics_series buckets by Bangkok month and week", async () => {
    const u = await newUser(db, "series");
    // 2026-09-30 18:00 UTC is already 1 Oct in Bangkok
    await db.query(
      "insert into transactions (user_id,type,amount,title,occurred_at) values ($1,'expense',10,'a','2026-09-30T18:00:00Z'), ($1,'expense',20,'b','2026-10-15T05:00:00Z'), ($1,'income',500,'c','2026-10-20T05:00:00Z')",
      [u],
    );
    const months = await rows<{ bucket_start: Date; income: string; expense: string }>(
      db,
      "select * from analytics_series($1,'2026-09-01T00:00:00Z','2026-11-30T00:00:00Z','month')",
      [u],
    );
    expect(months).toHaveLength(1);
    expect(new Date(months[0]?.bucket_start as Date).toISOString()).toBe(
      "2026-09-30T17:00:00.000Z",
    );
    expect(Number(months[0]?.expense)).toBe(30);
    expect(Number(months[0]?.income)).toBe(500);

    const weeks = await rows(
      db,
      "select * from analytics_series($1,'2026-09-01T00:00:00Z','2026-11-30T00:00:00Z','week')",
      [u],
    );
    expect(weeks.length).toBeGreaterThan(1);

    const bad = await rows(
      db,
      "select * from analytics_series($1,'2026-09-01T00:00:00Z','2026-11-30T00:00:00Z','year')",
      [u],
    );
    expect(bad).toEqual([]); // an unknown bucket returns nothing instead of arbitrary SQL
  });
});

describe("points, redeem and referral", () => {
  it("award_points is idempotent per (user, reason, ref)", async () => {
    const u = await newUser(db, "award");
    const first = await one<{ award_points: boolean }>(
      db,
      "select award_points($1, 1, 'daily', '2026-10-16')",
      [u],
    );
    const again = await one<{ award_points: boolean }>(
      db,
      "select award_points($1, 1, 'daily', '2026-10-16')",
      [u],
    );
    const nextDay = await one<{ award_points: boolean }>(
      db,
      "select award_points($1, 1, 'daily', '2026-10-17')",
      [u],
    );
    expect([first.award_points, again.award_points, nextDay.award_points]).toEqual([
      true,
      false,
      true,
    ]);
    const p = await one<{ points: number }>(db, "select points from users where id = $1", [u]);
    expect(p.points).toBe(2);
  });

  it("redeem_points buys whole days, extends from the current expiry, refuses overdraw", async () => {
    const u = await newUser(db, "redeem");
    await db.query("update users set points = 25 where id = $1", [u]);
    const r = await one<{ redeem_points: Date }>(db, "select redeem_points($1, 20, 2)", [u]);
    const days = (new Date(r.redeem_points).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThan(2.1);
    expect(
      (await one<{ points: number }>(db, "select points from users where id=$1", [u])).points,
    ).toBe(5);

    // stacking: a second redeem extends the existing expiry
    await db.query("update users set points = 10 where id = $1", [u]);
    const r2 = await one<{ redeem_points: Date }>(db, "select redeem_points($1, 10, 1)", [u]);
    expect(new Date(r2.redeem_points).getTime() - new Date(r.redeem_points).getTime()).toBeCloseTo(
      86_400_000,
      -3,
    );

    await expect(db.query("select redeem_points($1, 10, 1)", [u])).rejects.toThrow(
      /not_enough_points/,
    );
    expect(
      (await one<{ points: number }>(db, "select points from users where id=$1", [u])).points,
    ).toBe(0);
    const ledger = await rows<{ delta: number }>(
      db,
      "select delta from point_ledger where user_id=$1 and reason='redeem'",
      [u],
    );
    expect(ledger.map((l) => l.delta)).toEqual([-20, -10]);
  });

  it("apply_referral validates the code, the owner and the time window", async () => {
    const referrer = await newUser(db, "ref-owner");
    const code = (
      await one<{ referral_code: string }>(db, "select referral_code from users where id=$1", [
        referrer,
      ])
    ).referral_code;
    const friend = await newUser(db, "ref-friend");
    const apply = async (user: string, c: string) =>
      (await one<{ apply_referral: string }>(db, "select apply_referral($1,$2,14)", [user, c]))
        .apply_referral;

    expect(await apply(friend, "NOPE0000")).toBe("invalid");
    expect(await apply(referrer, code)).toBe("self");
    expect(await apply(friend, code.toLowerCase())).toBe("ok"); // case-insensitive
    expect(await apply(friend, code)).toBe("already");

    const old = await newUser(db, "ref-old");
    await db.query("update users set created_at = now() - interval '30 days' where id=$1", [old]);
    expect(await apply(old, code)).toBe("expired");
  });

  it("grant_referral_bonus pays both sides exactly once", async () => {
    const referrer = await newUser(db, "bonus-owner");
    const code = (
      await one<{ referral_code: string }>(db, "select referral_code from users where id=$1", [
        referrer,
      ])
    ).referral_code;
    const friend = await newUser(db, "bonus-friend");
    const loner = await newUser(db, "bonus-none");
    await db.query("select apply_referral($1,$2,14)", [friend, code]);

    const grant = async (u: string) =>
      (
        await one<{ grant_referral_bonus: boolean }>(db, "select grant_referral_bonus($1,10,7)", [
          u,
        ])
      ).grant_referral_bonus;
    expect(await grant(loner)).toBe(false); // nobody referred them
    expect(await grant(friend)).toBe(true);
    expect(await grant(friend)).toBe(false); // never twice

    const pts = async (u: string) =>
      (await one<{ points: number }>(db, "select points from users where id=$1", [u])).points;
    expect(await pts(referrer)).toBe(10);
    expect(await pts(friend)).toBe(7);
  });
});

describe("check_rate_limit", () => {
  it("counts hits per key and blocks over the limit", async () => {
    const hit = async (key: string) =>
      one<{ is_allowed: boolean; hits_in_window: number }>(
        db,
        "select * from check_rate_limit($1, 3, 3600)",
        [key],
      );
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit("k1"));
    expect(results.map((r) => r.is_allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.hits_in_window)).toEqual([1, 2, 3, 4, 5]);
    expect((await hit("k2")).hits_in_window).toBe(1); // other keys are independent
  });

  it("rejects nonsense parameters", async () => {
    await expect(db.query("select * from check_rate_limit('x', 0, 60)")).rejects.toThrow(
      /invalid_rate_limit/,
    );
    await expect(db.query("select * from check_rate_limit('x', 5, 0)")).rejects.toThrow(
      /invalid_rate_limit/,
    );
  });
});

describe("deleting a user (erase-my-data)", () => {
  it("cascades through every table that stores their data", async () => {
    const u = await newUser(db, "erase-me");
    const keeper = await newUser(db, "keeper");
    await db.query("update users set referred_by = $1 where id = $2", [keeper, u]);
    const cat = await one<{ id: string }>(
      db,
      "insert into categories (user_id,type,name) values ($1,'expense','mine') returning id",
      [u],
    );
    const slip = await one<{ id: string }>(
      db,
      "insert into slips (user_id,storage_path,image_sha256) values ($1,'p','erase-h') returning id",
      [u],
    );
    await db.query(
      "insert into transactions (user_id,type,amount,title,category_id,slip_id) values ($1,'expense',5,'x',$2,$3)",
      [u, cat.id, slip.id],
    );
    await db.query("insert into budgets (user_id,category_id,amount) values ($1,$2,10)", [
      u,
      cat.id,
    ]);
    await db.query("insert into accounts (user_id,name) values ($1,'cash')", [u]);
    await db.query(
      "insert into merchant_memory (user_id,match_text,category_id) values ($1,'shop',$2)",
      [u, cat.id],
    );
    await db.query(
      "insert into recurring_rules (user_id,type,amount,title,cadence,next_run_at) values ($1,'expense',1,'r','daily',now())",
      [u],
    );
    await db.query("insert into point_ledger (user_id,delta,reason) values ($1,1,'daily')", [u]);
    await db.query(
      "insert into photo_waits (user_id,tx_id,expires_at) values ($1,(select id from transactions where user_id = $1 limit 1), now() + interval '10 minutes')",
      [u],
    );
    await db.query(
      "insert into category_overrides (user_id,category_id,is_hidden) values ($1,(select id from categories where user_id is null limit 1),true)",
      [u],
    );

    await db.query("delete from users where id = $1", [u]);

    const tables = [
      "user_settings",
      "categories",
      "budgets",
      "accounts",
      "slips",
      "transactions",
      "merchant_memory",
      "recurring_rules",
      "point_ledger",
      "category_overrides",
      "photo_waits",
    ];
    for (const t of tables) {
      const r = await one<{ n: number }>(
        db,
        `select count(*)::int as n from ${t} where user_id = $1`,
        [u],
      );
      expect(r.n, `${t} still has rows for the deleted user`).toBe(0);
    }
    // other users and shared system data are untouched
    expect(
      (await one<{ n: number }>(db, "select count(*)::int as n from users where id=$1", [keeper]))
        .n,
    ).toBe(1);
    expect(
      (
        await one<{ n: number }>(
          db,
          "select count(*)::int as n from categories where user_id is null",
        )
      ).n,
    ).toBe(19);
  });
});

describe("row level security (supabase/tests/rls_check.sql)", () => {
  const script = () =>
    readFileSync(join(process.cwd(), "supabase", "tests", "rls_check.sql"), "utf8");
  const leftovers = async (d: PGlite) =>
    (
      await one<{ n: number }>(
        d,
        "select count(*)::int as n from users where line_user_id like 'rls-test-%'",
      )
    ).n;

  it("passes: users are isolated, plan/points are server-only, server tables are hidden", async () => {
    const rlsDb = await newDb();
    try {
      const results = await rlsDb.exec(script());
      // the last statement is the visible result the SQL Editor shows
      expect(results.at(-1)?.rows[0]).toEqual({ result: "RLS checks passed" });
      expect(await leftovers(rlsDb)).toBe(0); // nothing is kept
    } finally {
      await rlsDb.close();
    }
  }, 60_000);

  it("works as separate statements too (the SQL Editor may run them one by one)", async () => {
    const rlsDb = await newDb();
    try {
      // run the single DO block first, then the final SELECT, as two separate statements
      const full = script();
      const at = full.indexOf("select 'RLS checks passed'");
      await rlsDb.exec(full.slice(0, at));
      expect(await leftovers(rlsDb)).toBe(0);
      const r = await rlsDb.query(full.slice(at));
      expect(r.rows[0]).toEqual({ result: "RLS checks passed" });
    } finally {
      await rlsDb.close();
    }
  }, 60_000);

  it("detects a leak: if a table loses RLS the script fails", async () => {
    const broken = await newDb();
    try {
      await broken.exec("alter table transactions disable row level security");
      await expect(broken.exec(script())).rejects.toThrow(
        /RLS is DISABLED on public\.transactions/,
      );
      expect(await leftovers(broken)).toBe(0);
    } finally {
      await broken.close();
    }
  }, 60_000);

  it("detects a leak: a permissive policy on transactions is caught and leaves no data behind", async () => {
    const broken = await newDb();
    try {
      await broken.exec("create policy leak on transactions for select using (true)");
      await expect(broken.exec(script())).rejects.toThrow(/can READ another user|leaks/);
      expect(await leftovers(broken)).toBe(0);
    } finally {
      await broken.close();
    }
  }, 60_000);

  it("detects a user being able to upgrade their own plan", async () => {
    const broken = await newDb();
    try {
      await broken.exec("create policy self_update on users for update using (id = auth.uid())");
      await expect(broken.exec(script())).rejects.toThrow(/can UPDATE their own users row/);
    } finally {
      await broken.close();
    }
  }, 60_000);
});

describe("card theme and bot manner (0032)", () => {
  it("existing and new users start with the mint theme and the polite manner", async () => {
    const u = await newUser(db, `per-${Math.random()}`);
    const r = await one<{ card_theme: string; bot_persona: string }>(
      db,
      "select card_theme, bot_persona from user_settings where user_id = $1",
      [u],
    );
    expect(r).toEqual({ card_theme: "mint", bot_persona: "polite" });
  });

  it("refuses a theme or manner that does not exist, accepts the real ones", async () => {
    const u = await newUser(db, `per-${Math.random()}`);
    await expect(
      db.query("update user_settings set card_theme = 'neon' where user_id = $1", [u]),
    ).rejects.toThrow();
    await expect(
      db.query("update user_settings set bot_persona = 'rude' where user_id = $1", [u]),
    ).rejects.toThrow();
    await db.query(
      "update user_settings set card_theme = 'night', bot_persona = 'strict' where user_id = $1",
      [u],
    );
  });
});

describe("upsell helpers (0033)", () => {
  it("a free slip read can be taken only up to the limit, and given back", async () => {
    const u = await newUser(db, `ups-${Math.random()}`);
    const take = async () =>
      (await one<{ ok: boolean }>(db, "select take_teaser_slip($1, 1) as ok", [u])).ok;
    expect(await take()).toBe(true);
    expect(await take()).toBe(false);
    await db.query("select refund_teaser_slip($1)", [u]);
    expect(await take()).toBe(true);
    await db.query("select refund_teaser_slip($1)", [u]);
    await db.query("select refund_teaser_slip($1)", [u]); // never below zero
    const left = await one<{ n: number }>(
      db,
      "select teaser_slips_used as n from upsell_state where user_id = $1",
      [u],
    );
    expect(left.n).toBe(0);
  });

  it("an upgrade card is claimed once per feature per day", async () => {
    const u = await newUser(db, `ups-${Math.random()}`);
    const claim = async (f: string, day: string) =>
      (
        await one<{ ok: boolean }>(db, "select claim_upsell_card($1, $2, $3::date) as ok", [
          u,
          f,
          day,
        ])
      ).ok;
    expect(await claim("backdate", "2026-10-18")).toBe(true);
    expect(await claim("backdate", "2026-10-18")).toBe(false);
    expect(await claim("slip", "2026-10-18")).toBe(true);
    expect(await claim("backdate", "2026-10-19")).toBe(true);
  });
});

describe("usage counters (0034)", () => {
  it("takes up to the limit per month, a new month starts again, refunds never go below zero", async () => {
    const u = await newUser(db, `use-${Math.random()}`);
    const take = async (month: string, limit = 2) =>
      (
        await one<{ ok: boolean }>(db, "select take_usage($1, 'voice', $2::date, $3) as ok", [
          u,
          month,
          limit,
        ])
      ).ok;
    expect(await take("2026-10-01")).toBe(true);
    expect(await take("2026-10-01")).toBe(true);
    expect(await take("2026-10-01")).toBe(false);
    expect(await take("2026-11-01")).toBe(true);
    await db.query("select refund_usage($1, 'voice', '2026-10-01'::date)", [u]);
    expect(await take("2026-10-01")).toBe(true);
    for (let i = 0; i < 4; i++)
      await db.query("select refund_usage($1, 'voice', '2026-12-01'::date)", [u]);
    const row = await one<{ n: number }>(
      db,
      "select coalesce(sum(used), 0)::int as n from usage_counters where user_id = $1 and month = '2026-12-01'",
      [u],
    );
    expect(row.n).toBe(0);
  });

  it("different kinds count separately, and the lifetime bucket never rolls over", async () => {
    const u = await newUser(db, `use-${Math.random()}`);
    const take = async (kind: string, month: string) =>
      (
        await one<{ ok: boolean }>(db, "select take_usage($1, $2, $3::date, 1) as ok", [
          u,
          kind,
          month,
        ])
      ).ok;
    expect(await take("voice", "2026-10-01")).toBe(true);
    expect(await take("smart_parse", "2026-10-01")).toBe(true);
    expect(await take("teaser_voice", "2000-01-01")).toBe(true);
    expect(await take("teaser_voice", "2000-01-01")).toBe(false);
  });
});

describe("split bills (0035)", () => {
  async function seedBill(amount = 90_000) {
    const owner = await newUser(db, `sb-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const bill = (
      await one<{ id: string }>(
        db,
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang) values ($1,'Uanna','หมูกระทะ',$2) returning id",
        [group, amount],
      )
    ).id;
    const join = async (user: string) =>
      (await one<{ r: string }>(db, "select split_bill_join($1,$2) as r", [bill, user])).r;
    const close = async (shares: { user: string; share: number }[]) =>
      (
        await one<{ r: boolean }>(db, "select split_bill_close($1,$2::jsonb) as r", [
          bill,
          JSON.stringify(shares),
        ])
      ).r;
    const paid = async (user: string) =>
      (await one<{ r: string }>(db, "select split_bill_mark_paid($1,$2) as r", [bill, user])).r;
    const status = async () =>
      (await one<{ s: string }>(db, "select status as s from split_bills where id = $1", [bill])).s;
    return { owner, group, bill, join, close, paid, status };
  }

  it("joining is idempotent, and only while the list is open", async () => {
    const { join, close, status } = await seedBill();
    expect(await join("Uanna")).toBe("ok");
    expect(await join("Ubob")).toBe("ok");
    expect(await join("Ubob")).toBe("ok");
    const n = await one<{ n: number }>(db, "select count(*)::int as n from split_bill_members");
    expect(n.n).toBeGreaterThanOrEqual(2);
    expect(
      await close([
        { user: "Uanna", share: 45_000 },
        { user: "Ubob", share: 45_000 },
      ]),
    ).toBe(true);
    expect(await join("Uchom")).toBe("closed");
    expect(await status()).toBe("collecting");
  });

  it("a list holds at most 30 people", async () => {
    const { join } = await seedBill();
    for (let i = 0; i < 30; i++) expect(await join(`U${i}`)).toBe("ok");
    expect(await join("U30")).toBe("full");
    expect(await join("U5")).toBe("ok"); // someone already in is still fine
  });

  it("closing needs shares that add up to the bill to the satang, and for every member", async () => {
    const { join, close, status } = await seedBill(10_000);
    await join("Uanna");
    await join("Ubob");
    await join("Uchom");
    await expect(
      close([
        { user: "Uanna", share: 3334 },
        { user: "Ubob", share: 3333 },
        { user: "Uchom", share: 3334 },
      ]),
    ).rejects.toThrow(/add up/);
    await expect(
      close([
        { user: "Uanna", share: 5000 },
        { user: "Ubob", share: 5000 },
      ]),
    ).rejects.toThrow(/no share/);
    expect(await status()).toBe("joining"); // nothing changed
    expect(
      await close([
        { user: "Uanna", share: 3334 },
        { user: "Ubob", share: 3333 },
        { user: "Uchom", share: 3333 },
      ]),
    ).toBe(true);
    expect(
      await close([
        { user: "Uanna", share: 3334 },
        { user: "Ubob", share: 3333 },
        { user: "Uchom", share: 3333 },
      ]),
    ).toBe(false); // a double tap
  });

  it("the payer's own share is paid at once, the others are not; the last payment settles the bill", async () => {
    const { bill, join, close, paid, status } = await seedBill(90_000);
    for (const u of ["Uanna", "Ubob", "Uchom"]) await join(u);
    await close([
      { user: "Uanna", share: 30_000 },
      { user: "Ubob", share: 30_000 },
      { user: "Uchom", share: 30_000 },
    ]);
    const flags = await rows<{ line_user_id: string; paid: boolean }>(
      db,
      "select line_user_id, paid from split_bill_members where bill_id = $1 order by line_user_id",
      [bill],
    );
    expect(flags.map((f) => [f.line_user_id, f.paid])).toEqual([
      ["Uanna", true],
      ["Ubob", false],
      ["Uchom", false],
    ]);
    expect(await paid("Ubob")).toBe("ok");
    expect(await paid("Ubob")).toBe("already");
    expect(await paid("Unobody")).toBe("none");
    expect(await status()).toBe("collecting");
    expect(await paid("Uchom")).toBe("ok");
    expect(await status()).toBe("settled");
    expect(await paid("Uchom")).toBe("none"); // a settled bill takes no more ticks
  });

  it("marking paid before the list is closed does nothing", async () => {
    const { join, paid } = await seedBill();
    await join("Uanna");
    await join("Ubob");
    expect(await paid("Ubob")).toBe("none");
  });

  it("if only the payer is on the bill it settles straight away", async () => {
    const { join, close, status } = await seedBill(5000);
    await join("Uanna");
    expect(await close([{ user: "Uanna", share: 5000 }])).toBe(true);
    expect(await status()).toBe("settled");
  });

  it("a bill needs a sensible title and amount, and a status from the list", async () => {
    const { group } = await seedBill();
    const insert = (title: string, amount: number, status = "joining") =>
      db.query(
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang, status) values ($1,'U',$2,$3,$4)",
        [group, title, amount, status],
      );
    await expect(insert("", 100)).rejects.toThrow();
    await expect(insert("x".repeat(41), 100)).rejects.toThrow();
    await expect(insert("ok", 0)).rejects.toThrow();
    await expect(insert("ok", 100_000_001)).rejects.toThrow();
    await expect(insert("ok", 100, "weird")).rejects.toThrow();
    await insert("ok", 100);
  });

  it("every share has its own unguessable QR token, and they are unique", async () => {
    const { bill, join } = await seedBill();
    for (const u of ["Uanna", "Ubob"]) await join(u);
    const tokens = await rows<{ qr_token: string }>(
      db,
      "select qr_token from split_bill_members where bill_id = $1",
      [bill],
    );
    expect(new Set(tokens.map((t) => t.qr_token)).size).toBe(2);
    for (const t of tokens) expect(t.qr_token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("payment accounts accept PromptPay of 10, 13 or 15 digits and a plain account number, nothing else", async () => {
    const u = await newUser(db, `pa-${Math.random()}`);
    const set = (col: string, value: string) =>
      db.query(
        `insert into payment_accounts (user_id, ${col}) values ($1,$2) on conflict (user_id) do update set ${col} = excluded.${col}`,
        [u, value],
      );
    for (const ok of ["0812345678", "1234567890123", "123456789012345"])
      await set("promptpay_id", ok);
    for (const bad of ["12345", "081-234-5678", "abcdefghij", "12345678901"]) {
      await expect(set("promptpay_id", bad), bad).rejects.toThrow();
    }
    await set("bank_account", "123-4-56789-0");
    await expect(set("bank_account", "12")).rejects.toThrow();
    await expect(set("bank_account", "abc-123456")).rejects.toThrow();
  });

  it("deleting the group (or the user) takes its bills and shares with it", async () => {
    const { group, bill, join } = await seedBill();
    await join("Uanna");
    await db.query("delete from bot_groups where id = $1", [group]);
    const left = await one<{ n: number }>(
      db,
      "select (select count(*) from split_bills where id = $1)::int + (select count(*) from split_bill_members where bill_id = $1)::int as n",
      [bill],
    );
    expect(left.n).toBe(0);
  });
});

describe("split bills round 2: claim, slips, unpay (0036)", () => {
  async function collecting(amount = 90_000) {
    const owner = await newUser(db, `sb2-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const bill = (
      await one<{ id: string }>(
        db,
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang) values ($1,'Uanna','หมูกระทะ',$2) returning id",
        [group, amount],
      )
    ).id;
    for (const u of ["Uanna", "Ubob", "Uchom"])
      await db.query("select split_bill_join($1,$2)", [bill, u]);
    const each = amount / 3;
    await db.query("select split_bill_close($1,$2::jsonb)", [
      bill,
      JSON.stringify([
        { user: "Uanna", share: each },
        { user: "Ubob", share: each },
        { user: "Uchom", share: each },
      ]),
    ]);
    // "@T" in a call stands for a tag that is unique to this test (the database is shared between tests,
    // and a slip can be used once, ever)
    const tag = Math.random().toString(16).slice(2);
    const call = async (sql: string, ...args: unknown[]) =>
      (await one<{ r: string }>(db, `select ${sql.replaceAll("@T", tag)} as r`, args)).r;
    const member = (user: string) =>
      one<{ paid: boolean; claimed_at: string | null; paid_via: string | null }>(
        db,
        "select paid, claimed_at::text, paid_via, claim_via from split_bill_members where bill_id = $1 and line_user_id = $2",
        [bill, user],
      );
    const status = async () =>
      (await one<{ s: string }>(db, "select status as s from split_bills where id = $1", [bill])).s;
    return { bill, call, member, status, group };
  }

  it("the payer's own share is 'paid by the payer' from the start", async () => {
    const { member } = await collecting();
    expect(await member("Uanna")).toMatchObject({ paid: true, paid_via: "payer" });
    expect(await member("Ubob")).toMatchObject({ paid: false, paid_via: null });
  });

  it("claim: ok once, then 'already'; not for strangers; and the payer's tick clears it", async () => {
    const { bill, call, member } = await collecting();
    expect(await call("split_bill_claim($1,'Ubob')", bill)).toBe("ok");
    expect(await call("split_bill_claim($1,'Ubob')", bill)).toBe("already");
    expect(await call("split_bill_claim($1,'Unobody')", bill)).toBe("none");
    expect((await member("Ubob")).claimed_at).not.toBeNull();
    expect(await call("split_bill_mark_paid($1,'Ubob')", bill)).toBe("ok");
    expect(await member("Ubob")).toMatchObject({ paid: true, claimed_at: null, paid_via: "payer" });
    expect(await call("split_bill_claim($1,'Ubob')", bill)).toBe("already"); // already paid
  });

  it("claim does nothing before the list is closed", async () => {
    const owner = await newUser(db, `sb2-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const bill = (
      await one<{ id: string }>(
        db,
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang) values ($1,'Uanna','x',100) returning id",
        [group],
      )
    ).id;
    await db.query("select split_bill_join($1,'Ubob')", [bill]);
    expect(
      (await one<{ r: string }>(db, "select split_bill_claim($1,'Ubob') as r", [bill])).r,
    ).toBe("none");
  });

  it("claim by slip: leaves the share waiting (never paid), records the slip; only the payer's mark_paid settles", async () => {
    const { bill, call, member, status } = await collecting();
    expect(
      await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-1','REF@T1',30000,true)", bill),
    ).toBe("ok");
    const waiting = await member("Ubob");
    expect(waiting).toMatchObject({ paid: false, claim_via: "slip" });
    expect(waiting.claimed_at).not.toBeNull();
    expect(
      await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-9','REF@T9',30000,true)", bill),
    ).toBe("already");
    expect(
      await call("split_bill_claim_by_slip($1,'Uchom','sha-@T-2','REF@T2',30000,false)", bill),
    ).toBe("ok");
    expect(await member("Uchom")).toMatchObject({ paid: false, claim_via: "slip_unverified" });
    expect(await status()).toBe("collecting"); // two waiting claims settle nothing
    expect(await call("split_bill_mark_paid($1,'Ubob')", bill)).toBe("ok");
    expect(await member("Ubob")).toMatchObject({
      paid: true,
      claimed_at: null,
      claim_via: null,
      paid_via: "payer",
    });
    expect(await call("split_bill_mark_paid($1,'Uchom')", bill)).toBe("ok");
    expect(await status()).toBe("settled");
  });

  it("unpay clears a confirmed share completely", async () => {
    const { bill, call, member } = await collecting();
    await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-1','REF@T1',30000,true)", bill);
    await call("split_bill_mark_paid($1,'Ubob')", bill);
    expect(await call("split_bill_unpay($1,'Ubob')", bill)).toBe("ok");
    expect(await member("Ubob")).toMatchObject({
      paid: false,
      claimed_at: null,
      claim_via: null,
      paid_via: null,
    });
  });

  it("one slip pays one share, ever: the same picture or the same reference is a duplicate", async () => {
    const { bill, call, member } = await collecting();
    expect(
      await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-1','REF@T1',30000,true)", bill),
    ).toBe("ok");
    expect(
      await call("split_bill_claim_by_slip($1,'Uchom','sha-@T-1','REF@T2',30000,true)", bill),
    ).toBe("duplicate");
    expect(
      await call("split_bill_claim_by_slip($1,'Uchom','sha-@T-3','REF@T1',30000,true)", bill),
    ).toBe("duplicate");
    expect((await member("Uchom")).paid).toBe(false); // the failed attempts left nothing behind
    expect(
      await call("split_bill_claim_by_slip($1,'Uchom','sha-@T-3','REF@T3',30000,true)", bill),
    ).toBe("ok");
  });

  it("a slip with no reference number still works, and two without one do not clash", async () => {
    const { bill } = await collecting();
    for (const u of ["Ubob", "Uchom"]) {
      const r = await one<{ r: string }>(
        db,
        "select split_bill_claim_by_slip($1,$2,$3,null,30000,true) as r",
        [bill, u, `sha-${bill}-${u}`],
      );
      expect(r.r).toBe("ok");
    }
  });

  it("slips cannot pay a share on a bill that is not collecting", async () => {
    const { bill, call } = await collecting();
    await db.query("update split_bills set status = 'cancelled' where id = $1", [bill]);
    expect(
      await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-1','REF@T1',30000,true)", bill),
    ).toBe("none");
  });

  it("unpay: the payer takes a tick back; never their own share; a settled bill goes back to collecting", async () => {
    const { bill, call, member, status } = await collecting();
    await call("split_bill_mark_paid($1,'Ubob')", bill);
    await call("split_bill_mark_paid($1,'Uchom')", bill);
    expect(await status()).toBe("settled");
    expect(await call("split_bill_unpay($1,'Uchom')", bill)).toBe("ok");
    expect(await member("Uchom")).toMatchObject({ paid: false, paid_via: null });
    expect(await status()).toBe("collecting");
    expect(await call("split_bill_unpay($1,'Uchom')", bill)).toBe("none"); // not paid any more
    expect(await call("split_bill_unpay($1,'Uanna')", bill)).toBe("none"); // the payer's own share
    expect((await member("Uanna")).paid).toBe(true);
  });

  it("deleting the group takes the slips with it", async () => {
    const { bill, call, group } = await collecting();
    await call("split_bill_claim_by_slip($1,'Ubob','sha-@T-1','REF@T1',30000,true)", bill);
    await db.query("delete from bot_groups where id = $1", [group]);
    const n = await one<{ n: number }>(
      db,
      "select count(*)::int as n from split_bill_slips where bill_id = $1",
      [bill],
    );
    expect(n.n).toBe(0);
  });
});

describe("split bills round 3: setup, confirm, reminder, QR key (0037)", () => {
  async function seed(status = "setup", amount = 90_000) {
    const owner = await newUser(db, `sb3-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const bill = (
      await one<{ id: string }>(
        db,
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang, status) values ($1,'Uanna','หมูกระทะ',$2,$3) returning id",
        [group, amount, status],
      )
    ).id;
    const confirm = async (shares: { user: string; share: number }[]) =>
      (
        await one<{ r: boolean }>(db, "select split_bill_confirm($1,$2::jsonb) as r", [
          bill,
          JSON.stringify(shares),
        ])
      ).r;
    const status_ = async () =>
      (await one<{ s: string }>(db, "select status as s from split_bills where id = $1", [bill])).s;
    const members = () =>
      rows<{ line_user_id: string; share_satang: string; paid: boolean; paid_via: string | null }>(
        db,
        "select line_user_id, share_satang::text, paid, paid_via from split_bill_members where bill_id = $1 order by line_user_id",
        [bill],
      );
    return { bill, group, confirm, status: status_, members };
  }

  it("a bill can wait in 'setup'; unknown statuses are still refused", async () => {
    const { group } = await seed();
    await expect(
      db.query(
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang, status) values ($1,'U','x',100,'weird')",
        [group],
      ),
    ).rejects.toThrow();
  });

  it("confirm: fixes every share, makes the payer's paid, and starts collecting - once", async () => {
    const { confirm, status, members } = await seed();
    const shares = [
      { user: "Uanna", share: 30_000 },
      { user: "Ubob", share: 30_000 },
      { user: "Uchom", share: 30_000 },
    ];
    expect(await confirm(shares)).toBe(true);
    expect(await status()).toBe("collecting");
    expect(
      (await members()).map((m) => [m.line_user_id, m.share_satang, m.paid, m.paid_via]),
    ).toEqual([
      ["Uanna", "30000", true, "payer"],
      ["Ubob", "30000", false, null],
      ["Uchom", "30000", false, null],
    ]);
    expect(await confirm(shares)).toBe(false); // a double tap
  });

  it("confirm refuses shares that do not add up, a list without the payer, and more than 30 people", async () => {
    const { confirm, status } = await seed();
    await expect(
      confirm([
        { user: "Uanna", share: 50_000 },
        { user: "Ubob", share: 30_000 },
      ]),
    ).rejects.toThrow(/add up/);
    await expect(
      confirm([
        { user: "Ubob", share: 45_000 },
        { user: "Uchom", share: 45_000 },
      ]),
    ).rejects.toThrow(/payer/);
    const crowd = Array.from({ length: 31 }, (_, i) => ({
      user: i === 0 ? "Uanna" : `U${i}`,
      share: 90_000 / 31,
    }));
    await expect(confirm(crowd)).rejects.toThrow(/too many/);
    expect(await status()).toBe("setup");
  });

  it("confirm on its own payer alone settles the bill straight away", async () => {
    const { confirm, status } = await seed("setup", 5000);
    expect(await confirm([{ user: "Uanna", share: 5000 }])).toBe(true);
    expect(await status()).toBe("settled");
  });

  it("confirm also finishes an older 'joining' bill, taking off people who are not on the list", async () => {
    const { bill, confirm, members } = await seed("joining");
    for (const u of ["Uanna", "Ubob", "Ustale"])
      await db.query("select split_bill_join($1,$2)", [bill, u]);
    expect(
      await confirm([
        { user: "Uanna", share: 45_000 },
        { user: "Ubob", share: 45_000 },
      ]),
    ).toBe(true);
    expect((await members()).map((m) => m.line_user_id)).toEqual(["Uanna", "Ubob"]);
  });

  it("confirm does nothing to a bill that is collecting, settled or cancelled", async () => {
    for (const st of ["collecting", "settled", "cancelled"]) {
      const { confirm } = await seed(st);
      expect(
        await confirm([
          { user: "Uanna", share: 45_000 },
          { user: "Ubob", share: 45_000 },
        ]),
      ).toBe(false);
    }
  });

  it("announced: true once, only for a bill that is collecting or settled", async () => {
    const setup = await seed("setup");
    const announce = async (bill: string) =>
      (await one<{ r: boolean }>(db, "select split_bill_mark_announced($1) as r", [bill])).r;
    expect(await announce(setup.bill)).toBe(false); // not chosen yet
    await setup.confirm([
      { user: "Uanna", share: 45_000 },
      { user: "Ubob", share: 45_000 },
    ]);
    expect(await announce(setup.bill)).toBe(true);
    expect(await announce(setup.bill)).toBe(false);
  });

  it("reminded: true once per day per bill, again the next day, never for a bill that is not collecting", async () => {
    const { bill, confirm } = await seed("setup");
    const remind = async (day: string) =>
      (
        await one<{ r: boolean }>(db, "select split_bill_mark_reminded($1,$2::date) as r", [
          bill,
          day,
        ])
      ).r;
    expect(await remind("2026-10-18")).toBe(false); // still in setup
    await confirm([
      { user: "Uanna", share: 45_000 },
      { user: "Ubob", share: 45_000 },
    ]);
    expect(await remind("2026-10-18")).toBe(true);
    expect(await remind("2026-10-18")).toBe(false);
    expect(await remind("2026-10-17")).toBe(false); // an earlier date never goes back
    expect(await remind("2026-10-19")).toBe(true);
    await db.query("update split_bills set status = 'settled' where id = $1", [bill]);
    expect(await remind("2026-10-20")).toBe(false);
  });

  it("the QR on a slip is a key of its own: the same QR cannot pay twice, even with another picture and reference", async () => {
    const { bill, confirm } = await seed("setup");
    await confirm([
      { user: "Uanna", share: 30_000 },
      { user: "Ubob", share: 30_000 },
      { user: "Uchom", share: 30_000 },
    ]);
    const tag = Math.random().toString(16).slice(2);
    const pay = async (user: string, sha: string, ref: string | null, qr: string | null) =>
      (
        await one<{ r: string }>(
          db,
          "select split_bill_claim_by_slip($1,$2,$3,$4,30000,true,$5) as r",
          [bill, user, `${sha}-${tag}`, ref ? `${ref}-${tag}` : null, qr ? `${qr}-${tag}` : null],
        )
      ).r;
    expect(await pay("Ubob", "s1", "r1", "q1")).toBe("ok");
    expect(await pay("Uchom", "s2", "r2", "q1")).toBe("duplicate"); // same QR
    expect(await pay("Uchom", "s2", "r2", "q2")).toBe("ok");
  });

  it("slips without a QR still work and do not clash with each other", async () => {
    const { bill, confirm } = await seed("setup");
    await confirm([
      { user: "Uanna", share: 30_000 },
      { user: "Ubob", share: 30_000 },
      { user: "Uchom", share: 30_000 },
    ]);
    const tag = Math.random().toString(16).slice(2);
    for (const [u, i] of [
      ["Ubob", 1],
      ["Uchom", 2],
    ] as const) {
      const r = await one<{ r: string }>(
        db,
        "select split_bill_claim_by_slip($1,$2,$3,$4,30000,false) as r",
        [bill, u, `plain-${tag}-${i}`, `ref-${tag}-${i}`],
      );
      expect(r.r).toBe("ok");
    }
  });
});

describe("friends joining a bill that is still being set up (0038)", () => {
  it("join works on 'setup' and 'joining' bills, not after the people were chosen", async () => {
    const owner = await newUser(db, `sb4-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const make = async (status: string) =>
      (
        await one<{ id: string }>(
          db,
          "insert into split_bills (group_id, payer_line_user_id, title, amount_satang, status) values ($1,'Uanna','x',90000,$2) returning id",
          [group, status],
        )
      ).id;
    const join = async (bill: string, user: string) =>
      (await one<{ r: string }>(db, "select split_bill_join($1,$2) as r", [bill, user])).r;

    const setup = await make("setup");
    expect(await join(setup, "Ubob")).toBe("ok");
    expect(await join(setup, "Ubob")).toBe("ok");
    expect(await join(await make("joining"), "Ubob")).toBe("ok");
    for (const closed of ["collecting", "settled", "cancelled"]) {
      expect(await join(await make(closed), "Ubob"), closed).toBe("closed");
    }

    // the payer's choice wins: Bob tapped, but the payer confirms without him
    await join(setup, "Uchom");
    const ok = await one<{ r: boolean }>(db, "select split_bill_confirm($1,$2::jsonb) as r", [
      setup,
      JSON.stringify([
        { user: "Uanna", share: 45_000 },
        { user: "Uchom", share: 45_000 },
      ]),
    ]);
    expect(ok.r).toBe(true);
    const left = await rows<{ line_user_id: string }>(
      db,
      "select line_user_id from split_bill_members where bill_id = $1 order by line_user_id",
      [setup],
    );
    expect(left.map((m) => m.line_user_id)).toEqual(["Uanna", "Uchom"]);
    expect(await join(setup, "Udan")).toBe("closed");
  });

  it("a bill holds at most 30 people, however they got on it", async () => {
    const owner = await newUser(db, `sb5-${Math.random()}`);
    const group = (
      await one<{ id: string }>(
        db,
        "insert into bot_groups (line_group_id, owner_user_id) values ($1,$2) returning id",
        [`C${Math.random().toString(16).slice(2)}`, owner],
      )
    ).id;
    const bill = (
      await one<{ id: string }>(
        db,
        "insert into split_bills (group_id, payer_line_user_id, title, amount_satang, status) values ($1,'Uanna','x',90000,'setup') returning id",
        [group],
      )
    ).id;
    for (let i = 0; i < 30; i++) {
      const r = await one<{ r: string }>(db, "select split_bill_join($1,$2) as r", [bill, `U${i}`]);
      expect(r.r).toBe("ok");
    }
    const full = await one<{ r: string }>(db, "select split_bill_join($1,'U30') as r", [bill]);
    expect(full.r).toBe("full");
  });
});

describe("the photo offer setting (0040)", () => {
  it("is on for everybody by default and can be switched off", async () => {
    const u = await newUser(db, `po-${Math.random()}`);
    const read = async () =>
      (
        await one<{ photo_prompt: boolean }>(
          db,
          "select photo_prompt from user_settings where user_id=$1",
          [u],
        )
      ).photo_prompt;
    expect(await read()).toBe(true);
    await db.query("update user_settings set photo_prompt = false where user_id = $1", [u]);
    expect(await read()).toBe(false);
  });
});

describe("PDF entries (0041)", () => {
  it("accepts the pdf source and remembers a file once per person", async () => {
    const u = await newUser(db, `pdf-${Math.random()}`);
    const hash = "a".repeat(64);
    await db.query(
      "insert into transactions (user_id, type, title, amount, source, status) values ($1, 'expense', 'x', 10, 'pdf', 'pending_confirm')",
      [u],
    );
    await db.query("insert into pdf_imports (user_id, sha256) values ($1, $2)", [u, hash]);
    await expect(
      db.query("insert into pdf_imports (user_id, sha256) values ($1, $2)", [u, hash]),
    ).rejects.toThrow();
    const other = await newUser(db, `pdf-${Math.random()}`);
    await db.query("insert into pdf_imports (user_id, sha256) values ($1, $2)", [other, hash]);
  });
});

describe("notes (0042)", () => {
  it("keeps a note per person, 1 to 2,000 characters, and goes with the person", async () => {
    const u = await newUser(db, `note-${Math.random()}`);
    await db.query("insert into notes (user_id, body) values ($1, 'ซื้อนม')", [u]);
    await expect(
      db.query("insert into notes (user_id, body) values ($1, '')", [u]),
    ).rejects.toThrow();
    await expect(
      db.query("insert into notes (user_id, body) values ($1, $2)", [u, "ก".repeat(2001)]),
    ).rejects.toThrow();
    await db.query("insert into notes (user_id, body) values ($1, $2)", [u, "ก".repeat(2000)]);
    expect(
      (await one<{ n: number }>(db, "select count(*)::int as n from notes where user_id = $1", [u]))
        .n,
    ).toBe(2);
    await db.query("delete from users where id = $1", [u]);
    expect(
      (await one<{ n: number }>(db, "select count(*)::int as n from notes where user_id = $1", [u]))
        .n,
    ).toBe(0);
  });
});

describe("user reminders (0043)", () => {
  const rows = (ru: string) =>
    db.query<{ status: string }>(
      "select status from user_reminders where user_id = $1 order by remind_at",
      [ru],
    );
  const claim = async (now: string, limit = 100) =>
    (await db.query("select * from claim_due_reminders($1::timestamptz, $2)", [now, limit]))
      .rows as {
      r_id: string;
      r_user: string;
      r_line: string;
      r_body: string;
      r_repeat: string | null;
    }[];
  const add = (u: string, body: string, at: string, repeat: string | null) =>
    db.query(
      "insert into user_reminders (user_id, body, remind_at, repeat) values ($1, $2, $3::timestamptz, $4)",
      [u, body, at, repeat],
    );

  it("takes a one-off once, when it is due, and marks it done", async () => {
    const u = await newUser(db, `rm-${Math.random()}`);
    await add(u, "จ่ายค่าไฟ", "2026-10-29T02:00:00Z", null);
    await add(u, "ยังไม่ถึง", "2026-10-30T02:00:00Z", null);
    expect(await claim("2026-10-29T01:59:00Z")).toHaveLength(0);
    const due = (await claim("2026-10-29T02:03:00Z")).filter((r) => r.r_user === u);
    expect(due.map((r) => r.r_body)).toEqual(["จ่ายค่าไฟ"]);
    expect(due[0]?.r_repeat).toBeNull();
    expect((await claim("2026-10-29T02:05:00Z")).filter((r) => r.r_user === u)).toHaveLength(0);
    expect((await rows(u)).rows.map((r) => r.status)).toEqual(["done", "active"]);
  });

  it("moves a repeating one to its next time after now, so a missed day is not sent twice", async () => {
    const u = await newUser(db, `rm-${Math.random()}`);
    // 09:00 Bangkok every day, last due 3 days ago
    await add(u, "กินยา", "2026-10-26T02:00:00Z", "daily");
    const due = (await claim("2026-10-29T03:00:00Z")).filter((r) => r.r_user === u);
    expect(due).toHaveLength(1);
    const next = await one<{ at: string }>(
      db,
      "select to_char(remind_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as at from user_reminders where user_id = $1",
      [u],
    );
    expect(next.at).toBe("2026-10-30 09:00");
    expect((await claim("2026-10-29T04:00:00Z")).filter((r) => r.r_user === u)).toHaveLength(0);
  });

  it.each([
    ["weekly", "2026-10-05T01:00:00Z", "2026-10-30T03:00:00Z", "2026-11-02 08:00"],
    ["monthly", "2026-09-05T01:00:00Z", "2026-10-30T03:00:00Z", "2026-11-05 08:00"],
  ])("%s steps in Bangkok local time", async (repeat, at, now, expected) => {
    const u = await newUser(db, `rm-${Math.random()}`);
    await add(u, "x", at, repeat);
    await claim(now);
    const next = await one<{ at: string }>(
      db,
      "select to_char(remind_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as at from user_reminders where user_id = $1",
      [u],
    );
    expect(next.at).toBe(expected);
  });

  it("respects the limit, and rejects bad rows", async () => {
    const u = await newUser(db, `rm-${Math.random()}`);
    for (let i = 0; i < 3; i++) await add(u, `r${i}`, "2026-10-29T02:00:00Z", null);
    expect((await claim("2026-10-29T03:00:00Z", 2)).filter((r) => r.r_user === u)).toHaveLength(2);
    expect((await claim("2026-10-29T03:00:00Z", 2)).filter((r) => r.r_user === u)).toHaveLength(1);
    await expect(add(u, "", "2026-10-29T02:00:00Z", null)).rejects.toThrow();
    await expect(add(u, "x", "2026-10-29T02:00:00Z", "yearly")).rejects.toThrow();
  });
});

describe("ask mode (0044)", () => {
  it("keeps one row per person and goes with the person", async () => {
    const u = await newUser(db, `ask-${Math.random()}`);
    await db.query(
      "insert into ask_waits (user_id, expires_at) values ($1, now() + interval '5 minutes')",
      [u],
    );
    await db.query(
      "insert into ask_waits (user_id, expires_at) values ($1, now() + interval '10 minutes') on conflict (user_id) do update set expires_at = excluded.expires_at",
      [u],
    );
    expect(
      (
        await one<{ n: number }>(
          db,
          "select count(*)::int as n from ask_waits where user_id = $1",
          [u],
        )
      ).n,
    ).toBe(1);
    await db.query("delete from users where id = $1", [u]);
    expect(
      (
        await one<{ n: number }>(
          db,
          "select count(*)::int as n from ask_waits where user_id = $1",
          [u],
        )
      ).n,
    ).toBe(0);
  });
});

describe("pending intents (0046)", () => {
  const add = (user: string, input: string) =>
    db.query(
      "insert into pending_intents (user_id, id, input, expires_at) values ($1, gen_random_uuid(), $2, now()) on conflict (user_id) do update set input = excluded.input",
      [user, input],
    );

  it("keep one row per person, with RLS on and no policies", async () => {
    const u = await newUser(db, "pending-one");
    await add(u, "a");
    await add(u, "b");
    const r = await rows<{ input: string }>(
      db,
      `select input from pending_intents where user_id = '${u}'`,
    );
    expect(r).toEqual([{ input: "b" }]);
    const rls = await one<{ on: boolean; n: number }>(
      db,
      "select c.relrowsecurity as on, (select count(*)::int from pg_policies p where p.tablename = 'pending_intents') as n from pg_class c where c.relname = 'pending_intents'",
    );
    expect(rls).toEqual({ on: true, n: 0 });
  });

  it("disappear with the user", async () => {
    const u = await newUser(db, "pending-gone");
    await add(u, "a");
    await db.query("delete from users where id = $1", [u]);
    const r = await one<{ n: number }>(
      db,
      `select count(*)::int as n from pending_intents where user_id = '${u}'`,
    );
    expect(r.n).toBe(0);
  });
});
