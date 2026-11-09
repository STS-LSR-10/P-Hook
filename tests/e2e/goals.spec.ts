import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
} from "./helpers";

const goal = (over: Record<string, unknown>) => ({
  id: "g1",
  name: "เที่ยวญี่ปุ่น",
  emoji: "🇯🇵",
  targetSatang: 3_000_000,
  savedSatang: 1_200_000,
  dueOn: "2027-01-16",
  archived: false,
  percent: 40,
  remainingSatang: 1_800_000,
  done: false,
  monthlyNeededSatang: 600_000,
  overdue: false,
  ...over,
});

const LIST = {
  items: [
    goal({}),
    goal({
      id: "g2",
      name: "รถ",
      emoji: null,
      savedSatang: 3_000_000,
      percent: 100,
      remainingSatang: 0,
      done: true,
      dueOn: null,
      monthlyNeededSatang: null,
    }),
    goal({ id: "g3", name: "บ้าน", dueOn: "2026-10-01", overdue: true, monthlyNeededSatang: null }),
  ],
  limit: 5,
  canAdd: true,
};

const DEPOSITS = {
  items: [
    { id: "d2", amountSatang: 200_000, occurredAt: "2026-10-10T05:00:00Z", note: null },
    { id: "d1", amountSatang: 1_000_000, occurredAt: "2026-10-01T05:00:00Z", note: "โบนัส" },
  ],
};

test.describe("goals page (360px)", () => {
  test("shows each goal with its bar, what is left, the monthly amount and an overdue date", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_PLUS, "GET /api/goals": LIST });
    await page.goto("/goals");

    await expect(
      page.getByRole("progressbar", { name: "ความคืบหน้า เที่ยวญี่ปุ่น" }),
    ).toHaveAttribute("aria-valuenow", "40");
    await expect(page.getByText("เก็บเดือนละ ฿6,000")).toBeVisible();
    await expect(page.getByText("ครบแล้ว 🎉")).toBeVisible();
    await expect(page.getByText(/เลยกำหนด/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("empty state", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_PLUS,
      "GET /api/goals": { items: [], limit: 5, canAdd: true },
    });
    await page.goto("/goals");
    await expect(page.getByText("ยังไม่มีเป้าหมายการออม")).toBeVisible();
  });

  test("Free: an upgrade note and no add button", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/goals": { items: [], limit: 0, canAdd: false },
    });
    await page.goto("/goals");
    await expect(page.getByText("สำหรับแผน Starter")).toBeVisible();
    await expect(page.getByRole("button", { name: "เพิ่มเป้าหมาย" })).toHaveCount(0);
  });

  test("adding sends the name, target, date and emoji", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_PLUS,
      "GET /api/goals": LIST,
      "POST /api/goals": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "new" };
      },
    });
    await page.goto("/goals");

    await page.getByRole("button", { name: "เพิ่มเป้าหมาย" }).click();
    await page.getByLabel("ชื่อเป้าหมาย").fill("ซื้อโน้ตบุ๊ก");
    await page.getByLabel("ยอดเป้าหมาย").fill("35000");
    await page.getByLabel("วันที่อยากได้").fill("2027-02-01");
    await page
      .getByRole("radio", { name: /^อีโมจิ / })
      .first()
      .click();
    await page.getByRole("button", { name: "บันทึก" }).click();

    await expect(page.getByRole("status")).toContainText("เพิ่มเป้าหมายแล้ว");
    expect(body).toMatchObject({ name: "ซื้อโน้ตบุ๊ก", target: "35000", dueOn: "2027-02-01" });
    expect((body as { emoji: string }).emoji).toBeTruthy();
  });

  test("a bad target is refused before sending", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_PLUS, "GET /api/goals": LIST });
    await page.goto("/goals");

    await page.getByRole("button", { name: "เพิ่มเป้าหมาย" }).click();
    await page.getByLabel("ชื่อเป้าหมาย").fill("x");
    await page.getByLabel("ยอดเป้าหมาย").fill("abc");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByText("ยอดเป้าหมายไม่ถูกต้อง")).toBeVisible();
  });

  test("putting money in sends the amount and direction; the history and chart show", async ({
    page,
  }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_PLUS,
      "GET /api/goals": LIST,
      "GET /api/goals/g1/deposits": DEPOSITS,
      "POST /api/goals/g1/deposits": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "d3", savedSatang: 1_400_000, reachedTarget: false };
      },
    });
    await page.goto("/goals");

    await page.getByRole("button", { name: "หยอดกระปุก เที่ยวญี่ปุ่น" }).click();
    await expect(page.getByText("โบนัส")).toBeVisible();
    await expect(page.getByRole("img", { name: "กราฟยอดออมสะสม" })).toBeVisible();
    await page.getByLabel("จำนวนเงิน").fill("2000");
    await page.getByRole("button", { name: "บันทึก" }).click();

    await expect(page.getByRole("status")).toContainText("หยอดกระปุกแล้ว");
    expect(body).toMatchObject({ amount: "2000", direction: "in" });
  });

  test("taking out sends direction out", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_PLUS,
      "GET /api/goals": LIST,
      "GET /api/goals/g1/deposits": DEPOSITS,
      "POST /api/goals/g1/deposits": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "d3", savedSatang: 1_000_000, reachedTarget: false };
      },
    });
    await page.goto("/goals");

    await page.getByRole("button", { name: "หยอดกระปุก เที่ยวญี่ปุ่น" }).click();
    await page.getByRole("radio", { name: "ถอนออก" }).click();
    await page.getByLabel("จำนวนเงิน").fill("100");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByRole("status")).toContainText("ถอนแล้ว");
    expect(body).toMatchObject({ amount: "100", direction: "out" });
  });

  test("a failed load shows a retry", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_PLUS,
      "GET /api/goals": { status: 500, body: { error: "เซิร์ฟเวอร์ขัดข้อง" } },
    });
    await page.goto("/goals");
    await expect(page.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
  });
});
