import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
} from "./helpers";

const ME_ULTIMATE = {
  ...ME_PLUS,
  plan: "ultimate",
  features: { ...ME_PLUS.features, debts: true },
};

const WALLETS = {
  items: [
    { id: "w1", name: "เงินสด", kind: "cash", isDefault: true },
    { id: "w2", name: "กสิกร", kind: "bank", isDefault: false },
  ],
};

const debt = (over: Record<string, unknown>) => ({
  id: "d1",
  direction: "lent",
  person: "สมชาย",
  amountSatang: 50_000,
  paidSatang: 10_000,
  remainingSatang: 40_000,
  accountId: "w1",
  accountName: "เงินสด",
  occurredAt: "2026-10-01T05:00:00Z",
  dueAt: "2026-10-10T05:00:00Z",
  note: null,
  ...over,
});

const LIST = {
  items: [
    debt({}),
    debt({
      id: "d2",
      direction: "borrowed",
      person: "แม่",
      amountSatang: 200_000,
      paidSatang: 0,
      remainingSatang: 200_000,
      dueAt: null,
    }),
    debt({ id: "d3", person: "ปิดแล้ว", paidSatang: 50_000, remainingSatang: 0, dueAt: null }),
  ],
  lentSatang: 40_000,
  borrowedSatang: 200_000,
};

test.describe("debts page (360px)", () => {
  test("shows who owes whom, an overdue date and the totals", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": LIST,
      "GET /api/wallets": WALLETS,
    });
    await page.goto("/debts");

    await expect(page.getByText("คนที่ติดเรา").first()).toBeVisible();
    await expect(page.getByText("เราติดใคร").first()).toBeVisible();
    await expect(page.getByText("เลยกำหนด")).toBeVisible();
    await expect(page.getByText("ปิดแล้ว (1)")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("empty state", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": { items: [], lentSatang: 0, borrowedSatang: 0 },
      "GET /api/wallets": WALLETS,
    });
    await page.goto("/debts");
    await expect(page.getByText("ยังไม่มีหนี้ค้าง")).toBeVisible();
  });

  test("Free: a note with an upgrade link and the add button is off", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/debts": LIST,
      "GET /api/wallets": WALLETS,
    });
    await page.goto("/debts");

    await expect(page.getByText("สำหรับแผน Starter")).toBeVisible();
    await expect(page.getByRole("button", { name: "เพิ่มหนี้" })).toBeDisabled();
  });

  test("adding sends the direction, person, amount and wallet", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": LIST,
      "GET /api/wallets": WALLETS,
      "POST /api/debts": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "new" };
      },
    });
    await page.goto("/debts");

    await page.getByRole("button", { name: "เพิ่มหนี้" }).click();
    await page.getByLabel("ชื่อคน").fill("น้อง");
    await page.getByLabel("จำนวนเงิน").fill("350");
    await page.getByLabel("กระเป๋า", { exact: true }).selectOption("w2");
    await page.getByRole("button", { name: "บันทึก" }).click();

    await expect(page.getByRole("status")).toContainText("เพิ่มหนี้แล้ว");
    expect(body).toMatchObject({
      direction: "lent",
      person: "น้อง",
      amount: "350",
      accountId: "w2",
    });
  });

  test("a bad amount is refused before anything is sent", async ({ page }) => {
    let posted = false;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": LIST,
      "GET /api/wallets": WALLETS,
      "POST /api/debts": () => {
        posted = true;
        return { id: "x" };
      },
    });
    await page.goto("/debts");

    await page.getByRole("button", { name: "เพิ่มหนี้" }).click();
    await page.getByLabel("ชื่อคน").fill("น้อง");
    await page.getByLabel("จำนวนเงิน").fill("abc");
    await page.getByRole("button", { name: "บันทึก" }).click();

    await expect(page.getByText("จำนวนเงินไม่ถูกต้อง (เช่น 500")).toBeVisible();
    expect(posted).toBe(false);
  });

  test("receiving a repayment prefills what is left and sends it", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": LIST,
      "GET /api/wallets": WALLETS,
      "GET /api/debts/d1/payments": { items: [] },
      "POST /api/debts/d1/payments": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "p1", settled: false };
      },
    });
    await page.goto("/debts");

    await page.getByRole("button", { name: "รับคืน สมชาย" }).click();
    await expect(page.getByLabel("จำนวนเงินที่ชำระ")).toHaveValue("400.00");
    await page.getByLabel("จำนวนเงินที่ชำระ").fill("150");
    await page.getByRole("button", { name: "บันทึกรับคืน" }).click();

    await expect(page.getByRole("status")).toContainText("บันทึกรับคืนแล้ว");
    expect(body).toMatchObject({ amount: "150", accountId: "w1" });
  });

  test("failing to load shows a retry", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/debts": { status: 500, body: { error: "เซิร์ฟเวอร์ขัดข้อง" } },
      "GET /api/wallets": WALLETS,
    });
    await page.goto("/debts");
    await expect(page.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
  });
});
