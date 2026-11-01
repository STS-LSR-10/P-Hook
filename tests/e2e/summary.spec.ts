import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
  TX,
} from "./helpers";

const SUMMARY = {
  range: { from: "2026-09-30T17:00:00Z", to: "2026-10-31T17:00:00Z" },
  cycle: "monthly",
  incomeSatang: 2_000_000,
  expenseSatang: 750_000,
  balanceSatang: 1_250_000,
  accumulatedSatang: 3_456_700,
  count: 3,
  offset: 0,
  budgetSatang: null,
  categories: null,
  recent: [
    TX(),
    TX({
      id: "22222222-2222-2222-2222-222222222222",
      title: "เงินเดือน",
      type: "income",
      amountSatang: 2_000_000,
    }),
  ],
};

test.describe("summary page (360px)", () => {
  test("shows balance, totals and recent entries", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    await expect(page.getByRole("heading", { name: "สรุปภาพรวม" })).toBeVisible();
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible(); // balance
    await expect(page.getByText("฿7,500", { exact: true })).toBeVisible(); // expense
    await expect(page.getByText("กาแฟ", { exact: true })).toBeVisible();
    await expect(page.getByText("เงินเดือน")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("bottom navigation has six tabs and marks the current page", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    const nav = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(nav.getByRole("link")).toHaveCount(6);
    await expect(nav.getByRole("link", { name: "สรุป" })).toHaveAttribute("aria-current", "page");
  });

  test("empty state when there are no entries", async ({ page }) => {
    await mockApi(page, {
      "GET /api/summary": {
        ...SUMMARY,
        incomeSatang: 0,
        expenseSatang: 0,
        balanceSatang: 0,
        accumulatedSatang: 0,
        count: 0,
        recent: [],
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/summary");
    await expect(page.getByText("ยังไม่มีรายการเลย")).toBeVisible();
  });

  test("error state offers a retry that recovers", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/summary": () =>
        ++calls === 1 ? { status: 500, body: { error: "ขออภัย ระบบสะดุดชั่วคราว" } } : SUMMARY,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/summary");

    await expect(page.getByRole("alert").filter({ hasText: "ระบบสะดุดชั่วคราว" })).toBeVisible();
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible();
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByText("กาแฟ", { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("Free: profile with plan badge, budget not set, category chart locked", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    const profile = page.getByRole("region", { name: "โปรไฟล์" });
    await expect(profile.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("ยังไม่ตั้ง")).toBeVisible();
    await expect(page.getByRole("link", { name: "ตั้งงบ" })).toBeVisible();
    await expect(page.getByText("ใช้ได้ในแผน Pro ขึ้นไป")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("Pro: ring, budget status, category details and the goal bar", async ({ page }) => {
    await mockApi(page, {
      "GET /api/summary": {
        ...SUMMARY,
        budgetSatang: 800_000,
        categories: [
          { categoryId: "a", name: "อาหาร", color: "#0F766E", totalSatang: 500_000 },
          { categoryId: "b", name: "เดินทาง", color: "#0369A1", totalSatang: 250_000 },
        ],
      },
      "GET /api/me": { ...ME_PLUS, features: { ...ME_PLUS.features, savingsGoal: true } },
      "GET /api/goals": {
        items: [
          {
            id: "g1",
            name: "เที่ยวญี่ปุ่น",
            emoji: "✈️",
            percent: 40,
            targetSatang: 5_000_000,
            archived: false,
            done: false,
          },
        ],
      },
    });
    await page.goto("/summary");

    await expect(page.getByText("ใกล้เต็มงบ")).toBeVisible(); // 7,500 of 8,000
    await expect(page.getByText("+฿500", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: /เที่ยวญี่ปุ่น/ })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    await page.getByRole("button", { name: "ดูรายละเอียดหมวดหมู่" }).click();
    await expect(
      page
        .getByRole("region", { name: "สัดส่วนการใช้จ่ายและงบ" })
        .getByText("อาหาร", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("66.7%")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("the accumulate button swaps the balance for the all-time one", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByText("เหลือเก็บรอบนี้")).toBeVisible();
    await page.getByRole("button", { name: "สะสม" }).click();
    await expect(page.getByText("เหลือเก็บสะสม")).toBeVisible();
    await expect(page.getByText("฿34,567", { exact: true })).toBeVisible();
  });

  test("the arrows step back through the cycles, and never forward past this one", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByRole("button", { name: "รอบถัดไป" })).toBeDisabled();
    await page.getByRole("button", { name: "รอบก่อนหน้า" }).click();
    await expect.poll(() => seen.some((u) => u.includes("offset=-1"))).toBe(true);
    await expect(page.getByRole("button", { name: "รอบถัดไป" })).toBeEnabled();
  });

  test("while loading it shows the shape of the page, not an empty screen or dots", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/summary": async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return SUMMARY;
      },
      "GET /api/me": async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return ME_FREE;
      },
    });
    await page.goto("/summary");

    const skeleton = page.getByRole("status", { name: "กำลังโหลด" });
    await expect(skeleton).toBeVisible();
    await expect(page.getByText("…")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible();
  });
});
