import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalScroll, mockApi, ME_PLUS, SETTINGS, TX } from "./helpers";

/** The page as someone who chose English sees it (the language is remembered in the browser). */
async function inEnglish(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("phook-locale", "en"));
}

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

test.describe("in English (360px)", () => {
  test("the summary and the menu are in English, with Western dates", async ({ page }) => {
    await inEnglish(page);
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_PLUS });
    await page.goto("/summary");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main menu" });
    await expect(nav.getByRole("link", { name: "Summary" })).toBeVisible();
    await expect(page.getByText(/Oct 2026|Nov 2026/).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("settings offer the language, and saving English reloads in it", async ({ page }) => {
    await inEnglish(page);
    const saved: unknown[] = [];
    await mockApi(page, {
      "GET /api/settings": { ...SETTINGS, locale: "en" },
      "GET /api/me": ME_PLUS,
      "GET /api/recurring": { items: [], limit: 20 },
      "GET /api/memory": { items: [] },
      "PATCH /api/settings": (route: Route) => {
        saved.push(route.request().postDataJSON());
        return { ...SETTINGS, locale: "th" };
      },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /General settings/ }).click();
    await page.getByRole("button", { name: "Language" }).click();
    const dialog = page.getByRole("dialog", { name: "Language" });
    await expect(dialog.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dialog.getByRole("button", { name: "ไทย" }).click();
    await expect.poll(() => saved).toEqual([{ locale: "th" }]);
  });
});
