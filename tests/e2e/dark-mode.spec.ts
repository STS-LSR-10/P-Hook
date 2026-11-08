import { expect, test } from "@playwright/test";
import {
  expectNoSeriousA11yViolations,
  mockApi,
  openSettings,
  ME_PLUS,
  SETTINGS,
  TX,
} from "./helpers";

const SUMMARY = {
  range: { from: "2026-09-30T17:00:00Z", to: "2026-10-31T17:00:00Z" },
  cycle: "monthly",
  incomeSatang: 2_000_000,
  expenseSatang: 750_000,
  balanceSatang: 1_250_000,
  accumulatedSatang: 3_456_700,
  count: 1,
  offset: 0,
  budgetSatang: 1_000_000,
  categories: [{ categoryId: "a", name: "อาหาร", color: null, totalSatang: 500_000 }],
  recent: [TX()],
};
const REMINDER = (
  n: number,
  body: string,
  remindAt: string,
  over: Record<string, unknown> = {},
) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  body,
  remindAt,
  repeat: null,
  status: "active",
  category: null,
  ...over,
});
const REMINDERS = {
  items: [
    REMINDER(1, "จ่ายค่าเน็ต", "2026-11-15T07:00:00.000Z", { category: "bill" }),
    REMINDER(2, "กินยา", "2026-11-15T11:00:00.000Z", { repeat: "daily", category: "health" }),
    REMINDER(3, "ส่งรายงาน", "2026-11-20T02:00:00.000Z", { status: "done", category: "work" }),
  ],
  active: 2,
  limit: 3,
  repeating: 1,
  repeatLimit: 1,
  canAdd: true,
  canAddOnce: true,
  canAddRepeat: true,
};
const NOTE = (id: string, body: string) => ({
  id,
  body,
  createdAt: "2026-10-02T05:00:00.000Z",
  updatedAt: "2026-10-02T05:00:00.000Z",
});
const NOTES = {
  items: [NOTE("00000000-0000-4000-8000-000000000001", "ซื้อนม ไข่")],
  hasMore: false,
  count: 1,
  limit: 30,
  canAdd: true,
};
const FILES = {
  items: [
    {
      id: "00000000-0000-4000-8000-00000000000a",
      name: "สัญญาเช่า.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12 * 1024 * 1024,
      createdAt: "2026-10-03T05:00:00.000Z",
      hasThumb: false,
    },
  ],
  hasMore: false,
  usedBytes: 12 * 1024 * 1024,
  capacityBytes: 500 * 1024 * 1024,
  viewToken: "tok",
};
const BUDGETS = {
  mode: "overall",
  cycle: "monthly",
  range: { from: "2026-09-30T17:00:00Z", to: "2026-10-31T17:00:00Z" },
  overall: { amountSatang: 1_000_000, spentSatang: 850_000 },
  categories: [
    { categoryId: "a", name: "อาหาร", color: "#0F766E", amountSatang: null, spentSatang: 300_000 },
  ],
};
const CATEGORIES = {
  items: [
    {
      id: "a",
      type: "expense",
      name: "อาหาร",
      own: false,
      keywords: ["ข้าว"],
      color: "#0F766E",
      isHidden: false,
      sortOrder: 1,
      isFallback: false,
    },
  ],
};
const MOCKS = {
  "GET /api/reminders": REMINDERS,
  "GET /api/notes": NOTES,
  "GET /api/files": FILES,
  "GET /api/budgets": BUDGETS,
  "GET /api/categories": CATEGORIES,

  "GET /api/summary": SUMMARY,
  "GET /api/me": ME_PLUS,
  "GET /api/settings": SETTINGS,
  "GET /api/groups": { items: [] },
  "GET /api/recurring": { items: [], limit: 20 },
  "GET /api/memory": { items: [] },
};

/** How bright a CSS colour is, 0 (black) to 1 (white). */
const brightness = (css: string): number => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? (0.2126 * +m[1]! + 0.7152 * +m[2]! + 0.0722 * +m[3]!) / 255 : 1;
};

test.describe("dark mode (the phone's setting)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockApi(page, MOCKS);
  });

  test("the page behind the cards is dark and plain text is light", async ({ page }) => {
    await page.goto("/summary");
    await expect(page.getByText("สมชาย ทดสอบ")).toBeVisible();
    const colours = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const name = getComputedStyle(
        [...document.querySelectorAll("p")].find((p) => p.textContent === "สมชาย ทดสอบ")!,
      ).color;
      return { bg, name };
    });
    expect(brightness(colours.bg)).toBeLessThan(0.15); // near black, not white
    expect(brightness(colours.name)).toBeGreaterThan(0.7); // the name used to be black on a dark card
  });

  test("the summary has no contrast problems", async ({ page }) => {
    await page.goto("/summary");
    await expect(page.getByText("สมชาย ทดสอบ")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("the settings page (every section open) has none either", async ({ page }) => {
    await openSettings(page);
    await expectNoSeriousA11yViolations(page);
  });

  // each page with real rows on it (an error screen would pass, and prove nothing)
  const CASES: [string, string][] = [
    ["reminders", "จ่ายค่าเน็ต"],
    ["vault", "สัญญาเช่า.pdf"],
    ["budgets", "อาหาร"],
  ];
  for (const [path, shown] of CASES) {
    test(`${path} has no contrast problems with its content on screen`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-11-15T03:00:00.000Z"));
      await page.goto(`/${path}`);
      await expect(page.getByText(shown).first()).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test("the reminders calendar's selected period button reads in dark mode", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-15T03:00:00.000Z"));
    await page.goto("/reminders");
    await expect(page.getByText("จ่ายค่าเน็ต").first()).toBeVisible();
    for (const b of await page.locator("button[aria-pressed='true']").all()) {
      await expect(b).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);
  });

  test("light mode is left as it was: a white page", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/summary");
    await expect(page.getByText("สมชาย ทดสอบ")).toBeVisible();
    // nothing painted on the page: the browser's own white
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
  });
});
