import { expect, test, type Route } from "@playwright/test";
import { expectNoHorizontalScroll, mockApi, ME_PLUS, SETTINGS } from "./helpers";

const GID = "33333333-3333-4333-8333-333333333333";
const MANAGE = {
  isActive: true,
  summary: {
    totalSatang: 50_000,
    count: 2,
    payers: [{ lineUserId: "Uanna", name: "แอน", totalSatang: 50_000, percent: 100 }],
  },
  entries: [
    { id: "e1", title: "ข้าวเที่ยง", amountSatang: 30_000, occurredAt: "x", payerName: "แอน" },
  ],
  debts: [
    {
      id: "b1",
      title: "หมูกระทะ",
      amountSatang: 90_000,
      payerName: "แอน",
      unpaid: [
        { userId: "Ubob", name: "บ๊อบ", shareSatang: 30_000 },
        { userId: "Uchom", name: "ชมพู", shareSatang: 30_000 },
      ],
    },
  ],
  schedule: { everyDays: 1, window: "any" },
};

const entry = (n: number, at: string) => ({
  id: `e${n}`,
  title: `รายการ ${n}`,
  amountSatang: n * 100,
  occurredAt: at,
  payerName: "แอน",
});

test.describe("the entries of a long ledger (360px)", () => {
  const open = async (page: import("@playwright/test").Page, routes: Record<string, unknown>) => {
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [{ id: GID, name: "ทริปเชียงใหม่", isActive: true }] },
      ...routes,
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /จัดการกลุ่ม/ }).click();
    await page.getByRole("tab", { name: "รายการจด" }).click();
  };

  test("starts with a short page under day headings, and ดูเพิ่ม adds the next page until the end", async ({
    page,
  }) => {
    const asked: string[] = [];
    await open(page, {
      [`GET /api/groups/${GID}/manage`]: {
        ...MANAGE,
        entries: [
          entry(1, "2026-11-10T08:00:00+07:00"),
          entry(2, "2026-11-10T07:00:00+07:00"),
          entry(3, "2026-11-09T20:00:00+07:00"),
        ],
        nextCursor: "2026-11-09T13:00:00+00:00|cursor-1",
      },
      [`GET /api/groups/${GID}/entries`]: (route: Route) => {
        asked.push(new URL(route.request().url()).searchParams.get("cursor") ?? "");
        return {
          entries: [entry(4, "2026-11-08T10:00:00+07:00")],
          nextCursor: null,
        };
      },
    });
    const list = page.getByRole("region", { name: "รายการจดของกลุ่ม" });
    await expect(list.getByRole("heading", { level: 4 })).toHaveCount(2); // 10 พ.ย. and 9 พ.ย.
    await expect(list.getByText("รายการ 1", { exact: true })).toBeVisible();
    await expect(list.getByText("รายการ 4", { exact: true })).toHaveCount(0);

    await list.getByRole("button", { name: "ดูเพิ่ม" }).click();
    await expect(list.getByText("รายการ 4", { exact: true })).toBeVisible();
    await expect(list.getByText("รายการ 1", { exact: true })).toBeVisible(); // the first page stays
    expect(asked).toEqual(["2026-11-09T13:00:00+00:00|cursor-1"]);
    // that was the last page
    await expect(list.getByRole("button", { name: "ดูเพิ่ม" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("no ดูเพิ่ม when everything fits on the first page", async ({ page }) => {
    await open(page, { [`GET /api/groups/${GID}/manage`]: MANAGE });
    await expect(page.getByRole("button", { name: "ดูเพิ่ม" })).toHaveCount(0);
    await expect(page.getByText("ข้าวเที่ยง")).toBeVisible();
  });

  test("a failed ดูเพิ่ม says so and can be tried again", async ({ page }) => {
    let calls = 0;
    await open(page, {
      [`GET /api/groups/${GID}/manage`]: {
        ...MANAGE,
        entries: [entry(1, "2026-11-10T08:00:00+07:00")],
        nextCursor: "2026-11-09T13:00:00+00:00|c",
      },
      [`GET /api/groups/${GID}/entries`]: () => {
        calls += 1;
        return calls === 1
          ? { status: 500, body: { error: "โหลดไม่สำเร็จ" } }
          : { entries: [entry(2, "2026-11-09T10:00:00+07:00")], nextCursor: null };
      },
    });
    const more = page.getByRole("button", { name: "ดูเพิ่ม" });
    await more.click();
    await expect(page.getByRole("status").filter({ hasText: "โหลดไม่สำเร็จ" })).toBeVisible();
    await more.click();
    await expect(page.getByText("รายการ 2", { exact: true })).toBeVisible();
  });
});

test.describe("group management in settings (360px)", () => {
  test("the owner of a group sees the card; clearing and the schedule go to the server", async ({
    page,
  }) => {
    const sent: unknown[] = [];
    page.on("dialog", (d) => void d.accept());
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [{ id: GID, name: "ทริปเชียงใหม่", isActive: true }] },
      [`GET /api/groups/${GID}/manage`]: MANAGE,
      [`POST /api/groups/${GID}/debts`]: (route: Route) => {
        sent.push(route.request().postDataJSON());
        return { cleared: 1 };
      },
      [`PUT /api/groups/${GID}/schedule`]: (route: Route) => {
        sent.push(route.request().postDataJSON());
        return { everyDays: 3, window: "any" };
      },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /จัดการกลุ่ม/ }).click();

    await expect(page.getByText("฿500", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: "ค้างจ่าย" }).click();
    await expect(page.getByText("หมูกระทะ")).toBeVisible();
    await page.getByRole("button", { name: "จ่ายแล้ว" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "เคลียร์แล้ว 1" })).toBeVisible();
    await page.getByRole("button", { name: "เคลียร์ยอดค้างทั้งกลุ่ม" }).click();

    await page.getByRole("tab", { name: "ทวงตัง" }).click();
    await page.getByRole("radio", { name: "ทุก 3 วัน" }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent).toEqual([
      { kind: "member", billId: "b1", userId: "Ubob" },
      { kind: "all" },
      { everyDays: 3, window: "any" },
    ]);
    await expectNoHorizontalScroll(page);
  });

  test("someone who owns no group does not get the card", async ({ page }) => {
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [] },
    });
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "เปิดทั้งหมด" })).toBeVisible();
    await expect(page.getByRole("button", { name: /จัดการกลุ่ม/ })).toHaveCount(0);
  });

  test("switching group never leaves the first group's bills on screen", async ({ page }) => {
    const G2 = "44444444-4444-4444-8444-444444444444";
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": {
        items: [
          { id: GID, name: "ทริปเชียงใหม่", isActive: true },
          { id: G2, name: "บ้านเช่า", isActive: true },
        ],
      },
      [`GET /api/groups/${GID}/manage`]: MANAGE,
      // the second group answers slowly: the first one's bills must not show meanwhile
      [`GET /api/groups/${G2}/manage`]: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return { ...MANAGE, debts: [{ ...MANAGE.debts[0], title: "ค่าไฟ" }] };
      },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /จัดการกลุ่ม/ }).click();
    await page.getByRole("tab", { name: "ค้างจ่าย" }).click();
    await expect(page.getByText("หมูกระทะ")).toBeVisible();
    await page.getByLabel("เลือกกลุ่ม").selectOption(G2);
    await expect(page.getByText("หมูกระทะ")).toHaveCount(0);
    await expect(page.getByText("ค่าไฟ")).toBeVisible();
  });

  test("a group the bot was taken out of says when its data is deleted", async ({ page }) => {
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [{ id: GID, name: "กลุ่มเก่า", isActive: false }] },
      [`GET /api/groups/${GID}/manage`]: {
        ...MANAGE,
        isActive: false,
        purgeAt: "2026-12-08T05:00:00.000Z",
      },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /จัดการกลุ่ม/ }).click();
    await expect(page.getByText(/ข้อมูลจะถูกลบถาวรวันที่ 8 ธ\.ค\. 2569/)).toBeVisible();
    await expect(page.getByText(/ปิดอยู่ ดูได้อย่างเดียว/)).toHaveCount(0);
  });
});
