import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route } from "@playwright/test";

type Handler = unknown | ((route: Route, url: URL) => unknown | Promise<unknown>);
export interface MockedStatus {
  status: number;
  body: unknown;
}

/** "GET /api/me" -> JSON body, a function, or { status, body } for non-200 answers. */
export type ApiMocks = Record<string, Handler>;

/**
 * Answer every /api call from the table. An unmocked call fails the request loudly (404 with a
 * recognisable body) so a test can never silently talk to a real backend.
 */
export async function mockApi(page: Page, mocks: ApiMocks) {
  const seen: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    seen.push(`${key}${url.search}`);

    const entry = mocks[key];
    if (entry === undefined) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: `UNMOCKED ${key}` }),
      });
    }
    const resolved = typeof entry === "function" ? await entry(route, url) : entry;
    if (
      resolved &&
      typeof resolved === "object" &&
      "status" in resolved &&
      "body" in resolved &&
      typeof (resolved as MockedStatus).status === "number"
    ) {
      const { status, body } = resolved as MockedStatus;
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(resolved),
    });
  });
  return { seen };
}

/** Open the settings page with every section open, as it all was on one page before. */
export async function openSettings(page: Page, path = "/settings") {
  await page.goto(path);
  await page.getByRole("button", { name: "เปิดทั้งหมด" }).click();
}

/** The page must not scroll sideways at phone width. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    // the width of the screen: innerWidth grows with an overflowing page, so it cannot be the yardstick
    inner: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scroll,
    `page is ${overflow.scroll}px wide in a ${overflow.inner}px viewport`,
  ).toBeLessThanOrEqual(overflow.inner);
}

/** Automated accessibility check: no serious or critical WCAG A/AA violations. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 120)}`,
    ),
  ).toEqual([]);
}

// ── fixtures ──
export const ME_FREE = {
  displayName: "สมชาย ทดสอบ",
  pictureUrl: null,
  plan: "free",
  planExpiresAt: null,
  features: {
    savingsChart: false,
    recurring: false,
    multiAccount: false,
    transfer: false,
    creditCard: false,
    debts: false,
    foreignCurrency: false,
    categoryBudget: false,
    budgetAlert: false,
    dailyBudget: false,
    personalize: false,
    savingsGoal: false,
    billReminder: false,
    sharedWallet: false,
    merchantMemory: false,
    dailyReminder: false,
    advancedExport: false,
    autoSummary: false,
    voiceLog: false,
    backdate: false,
    multiEntry: false,
    tags: false,
    entryPhoto: false,
    smartParse: false,
    customRange: false,
    searchTotals: false,
    yearSummary: false,
    categoryCompare: false,
    export: false,
    dashboard: false,
    forecast: false,
    insight: false,
    customCategory: false,
    pdfExport: false,
  },
  slips: { used: 0, limit: 0, remaining: 0 },
  points: 7,
  streak: 3,
  referralCode: "ABCD1234",
  referrals: 3,
  referred: false,
  limits: { recurringRules: 20, wallets: 1 },
  payments: { available: false, history: [] },
  trial: { days: 7, available: { starter: true, plus: true, ultimate: true } },
};

export const ME_PLUS = {
  ...ME_FREE,
  plan: "plus",
  planExpiresAt: "2026-12-31T00:00:00Z",
  features: {
    ...Object.fromEntries(Object.keys(ME_FREE.features).map((k) => [k, true])),

    // Pro has everything but what only Elite adds
    smartParse: false,
    pdfExport: false,
  },
  slips: { used: 3, limit: 5, remaining: 2 },
  points: 25,
  trial: { days: 7, available: { starter: false, plus: false, ultimate: false } },
};

export const SETTINGS = {
  confirm_style: "full",
  budget_cycle: "monthly",
  cycle_start_day: 1,
  daily_reminder_enabled: false,
  daily_reminder_time: null,
  weekly_summary_enabled: false,
  monthly_summary_enabled: false,
};

export const TX = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  type: "expense",
  title: "กาแฟ",
  amountSatang: 3000,
  occurredAt: "2026-10-15T08:00:00Z",
  source: "text",
  categoryId: null,
  categoryName: "อาหาร",
  categoryIcon: null,
  categoryColor: "#0F766E",
  hasSlip: false,
  hasPhoto: false,
  note: null,
  tags: [],
  ...over,
});
