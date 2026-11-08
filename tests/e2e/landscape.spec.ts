import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, mockApi, ME_PLUS, SETTINGS, TX } from "./helpers";

const SUMMARY = {
  range: { from: "2026-09-30T17:00:00Z", to: "2026-10-31T17:00:00Z" },
  cycle: "monthly",
  incomeSatang: 2_000_000,
  expenseSatang: 750_000,
  balanceSatang: 1_250_000,
  accumulatedSatang: 3_456_700,
  count: 1,
  offset: 0,
  budgetSatang: null,
  categories: null,
  recent: [TX()],
};
const MOCKS = {
  "GET /api/summary": SUMMARY,
  "GET /api/me": ME_PLUS,
  "GET /api/settings": SETTINGS,
};
const PAGES = ["summary", "analytics", "budgets", "transactions", "vault", "settings"];

test.describe("a phone turned sideways (844x390)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  for (const page of PAGES) {
    test(`${page}: the menu is a narrow rail on the left, the content fills the rest`, async ({
      page: p,
    }) => {
      await mockApi(p, MOCKS);
      await p.goto(`/${page}`);
      const nav = p.getByRole("navigation", { name: "เมนูหลัก" });
      await expect(nav.getByRole("link")).toHaveCount(6);
      const box = (await nav.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBeLessThanOrEqual(80);
      expect(box.height).toBe(390); // the whole height, not a bar at the bottom
      for (const link of await nav.getByRole("link").all()) await expect(link).toBeInViewport();
      const main = (await p.locator("main").first().boundingBox())!;
      expect(main.x).toBeGreaterThanOrEqual(box.width); // clear of the rail
      expect(main.width).toBeGreaterThan(448); // not the phone-portrait column any more
      await expectNoHorizontalScroll(p);
    });
  }

  test("the summary is laid out in two columns", async ({ page }) => {
    await mockApi(page, MOCKS);
    await page.goto("/summary");
    const hero = (await page.getByLabel("ภาพรวม").boundingBox())!;
    const recent = (await page.getByRole("region", { name: "รายการล่าสุด" }).boundingBox())!;
    expect(recent.x).toBeGreaterThan(hero.x + hero.width - 1);
  });

  test("a sheet is a box in the middle that fits the short screen", async ({ page }) => {
    await mockApi(page, { ...MOCKS, "GET /api/groups": { items: [] } });
    await page.goto("/settings");
    await page.getByRole("button", { name: "💡 เสนอแนะ" }).click();
    const box = (await page
      .getByRole("dialog", { name: "💡 เสนอแนะ" })
      .locator("> div")
      .boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
    // in the middle, not stuck to the bottom edge like the upright sheet
    expect(Math.abs(box.y + box.height / 2 - 195)).toBeLessThan(40);
  });
});

test.describe("a short sideways screen, as inside LINE's own header bar (844x320)", () => {
  test.use({ viewport: { width: 844, height: 320 } });

  test("every menu icon is reachable", async ({ page }) => {
    await mockApi(page, MOCKS);
    await page.goto("/summary");
    for (const link of await page
      .getByRole("navigation", { name: "เมนูหลัก" })
      .getByRole("link")
      .all())
      await expect(link).toBeInViewport();
  });

  test("the add form and the date calendar fit, with their buttons in reach", async ({ page }) => {
    await mockApi(page, MOCKS);
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เพิ่มรายการใหม่" }).click();
    const form = page.getByRole("dialog").locator("form");
    await expect(form).toBeVisible();
    const f = (await form.boundingBox())!;
    expect(f.y).toBeGreaterThanOrEqual(0);
    expect(f.y + f.height).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "ปิด" }).click();

    await page.getByRole("button", { name: /ช่วงเวลาที่เลือก/ }).click();
    const ok = page.getByRole("button", { name: "ตกลง" });
    await ok.scrollIntoViewIfNeeded();
    await expect(ok).toBeInViewport();
  });
});

test("a short desktop window keeps the sidebar, not the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await mockApi(page, MOCKS);
  await page.goto("/summary");
  const box = (await page.getByRole("navigation", { name: "เมนูหลัก" }).boundingBox())!;
  expect(box.width).toBe(240);
});

test("an upright phone with its keyboard open (360x350) keeps the bottom bar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 350 });
  await mockApi(page, MOCKS);
  await page.goto("/summary");
  const box = (await page.getByRole("navigation", { name: "เมนูหลัก" }).boundingBox())!;
  expect(box.y + box.height).toBe(350);
  expect(box.width).toBe(360);
});

test("upright, the menu is still the bar along the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, MOCKS);
  await page.goto("/summary");
  const box = (await page.getByRole("navigation", { name: "เมนูหลัก" }).boundingBox())!;
  expect(box.y + box.height).toBe(844);
  expect(box.width).toBe(390);
});
