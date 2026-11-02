import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
  SETTINGS,
} from "./helpers";

const SERIES = Array.from({ length: 6 }, (_, i) => ({
  start: `2026-${String(i + 5).padStart(2, "0")}-01T00:00:00Z`,
  label: ["พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค."][i] ?? "",
  incomeSatang: 2_000_000,
  expenseSatang: 1_200_000 + i * 50_000,
}));

const ANALYTICS = {
  view: "month",
  scope: "cycle",
  offset: 0,
  series: SERIES,
  categories: [
    { categoryId: "a", name: "อาหาร", color: "#0F766E", icon: "🍜", totalSatang: 300_000 },
    { categoryId: "b", name: "เดินทาง", color: "#0369A1", icon: null, totalSatang: 150_000 },
  ],
  categoriesTotalSatang: 450_000,
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
    {
      id: "z",
      type: "expense",
      name: "อื่นๆ",
      own: false,
      keywords: [],
      color: "#64748B",
      isHidden: false,
      sortOrder: 99,
      isFallback: true,
    },
  ],
};

test.describe("analytics page (360px)", () => {
  test("renders both charts and the category legend", async ({ page }) => {
    await mockApi(page, { "GET /api/analytics": ANALYTICS, "GET /api/me": ME_PLUS });
    await page.goto("/analytics");

    await expect(page.getByRole("region", { name: "กราฟรายรับรายจ่าย" })).toBeVisible();
    await expect(page.getByRole("region", { name: "สัดส่วนรายจ่ายตามหมวด" })).toBeVisible();
    await expect(page.getByText("อาหาร").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("Free sees the locked teaser with the real price and never calls the analytics API", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, {
      "GET /api/analytics": ANALYTICS,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/analytics");

    const teaser = page.getByRole("region", { name: "ฟีเจอร์ของแผน Pro" });
    await expect(teaser.getByText("สำหรับแผน Pro")).toBeVisible();
    await expect(
      teaser.getByRole("link", { name: /อัปเกรดเป็น Pro เริ่มต้น ฿\d+\/เดือน/ }),
    ).toHaveAttribute("href", "/upgrade");
    await expect(page.getByRole("region", { name: "กราฟรายรับรายจ่าย" })).toHaveCount(0);
    expect(seen.some((s) => s.includes("/api/analytics"))).toBe(false);
    // the savings tab gets its own teaser
    await page.getByRole("tab", { name: /เก็บออม/ }).click();
    await expect(teaser.getByText('ปลดล็อกระบบ "วางแผนเก็บออม"')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("shows the range, the averages per bar and the category bars", async ({ page }) => {
    await mockApi(page, { "GET /api/analytics": ANALYTICS, "GET /api/me": ME_PLUS });
    await page.goto("/analytics");

    await expect(page.getByText("พ.ค. – ต.ค. 2569")).toBeVisible();
    await expect(page.getByText("รายรับเฉลี่ย / เดือน")).toBeVisible();
    await expect(page.getByText("฿20,000", { exact: true }).first()).toBeVisible(); // 6 × 20,000 ÷ 6
    await expect(page.getByText("2 หมวดหมู่")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "อาหาร 67%" })).toHaveAttribute(
      "aria-valuenow",
      "67",
    );
    await expect(page.getByText("🍜")).toBeVisible();
  });

  test("the arrows step back through earlier windows and never forward past the latest", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, {
      "GET /api/analytics": ANALYTICS,
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/analytics");
    await expect(page.getByRole("button", { name: "ช่วงถัดไป" })).toBeDisabled();
    await page.getByRole("button", { name: "ช่วงก่อนหน้า" }).click();
    await expect.poll(() => seen.some((u) => u.includes("offset=-1"))).toBe(true);
    await expect(page.getByRole("button", { name: "ช่วงถัดไป" })).toBeEnabled();
    // changing the view starts again from the latest window
    await page.getByRole("tab", { name: "รายสัปดาห์" }).click();
    await expect
      .poll(() => seen.some((u) => u.includes("view=week&scope=cycle&offset=0")))
      .toBe(true);
  });

  test("savings tab shows the real chart for Plus", async ({ page }) => {
    await mockApi(page, { "GET /api/analytics": ANALYTICS, "GET /api/me": ME_PLUS });
    await page.goto("/analytics");
    await page.getByRole("tab", { name: /เก็บออม/ }).click();
    await expect(page.getByRole("region", { name: "กราฟเงินเก็บออม" })).toBeVisible();
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/analytics": ANALYTICS, "GET /api/me": ME_PLUS });
    await page.goto("/analytics");
    await expect(page.getByRole("region", { name: "กราฟรายรับรายจ่าย" })).toBeVisible();
    // let the chart animation and fades finish: contrast is measured on settled colours
    await page.waitForTimeout(1200);
    await expectNoSeriousA11yViolations(page);
  });
});

const OWN_CATEGORIES = {
  items: [
    ...CATEGORIES.items,
    {
      id: "m1",
      type: "expense",
      name: "ค่าอาหารแมว",
      own: true,
      keywords: ["ทราย"],
      color: "#7C3AED",
      emoji: "🐱",
      isHidden: false,
      sortOrder: 5,
      isFallback: false,
    },
  ],
};

test.describe("custom categories (360px)", () => {
  const BASE = { "GET /api/budgets": BUDGETS, "GET /api/categories": OWN_CATEGORIES };

  test("a category's emoji is shown in front of its name", async ({ page }) => {
    await mockApi(page, { ...BASE, "GET /api/me": ME_PLUS });
    await page.goto("/budgets");
    const row = page.getByRole("listitem").filter({ hasText: "ค่าอาหารแมว" });
    await expect(row).toContainText("🐱");
    await expectNoHorizontalScroll(page);
  });

  test("Free: adding shows the Pro lock and sends nothing", async ({ page }) => {
    const { seen } = await mockApi(page, { ...BASE, "GET /api/me": ME_FREE });
    await page.goto("/budgets");
    await page.getByRole("button", { name: /เพิ่มหมวด/ }).click();

    const dialog = page.getByRole("dialog", { name: "หมวดของตัวเอง" });
    await expect(dialog.getByText("สร้างหมวดของตัวเองสำหรับแผน Pro")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "ดูแผน Pro" })).toHaveAttribute(
      "href",
      "/upgrade",
    );
    await expect(page.getByLabel("ชื่อหมวด")).toHaveCount(0);
    expect(seen.some((s) => s.startsWith("POST"))).toBe(false);
  });

  test("Free: an own category can be deleted but not edited", async ({ page }) => {
    await mockApi(page, { ...BASE, "GET /api/me": ME_FREE });
    await page.goto("/budgets");
    await page.getByRole("button", { name: "แก้ไข ค่าอาหารแมว" }).click();

    const dialog = page.getByRole("dialog", { name: "แก้ไขหมวด" });
    await expect(dialog.getByLabel("ชื่อหมวด")).toBeDisabled();
    await expect(dialog.getByText("แก้หมวดของตัวเองได้ในแผน Pro ขึ้นไป")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "บันทึก" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "ลบหมวดนี้" })).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "เลือกอีโมจิ" })).toHaveCount(0);
  });

  test("Pro: pick an emoji from the grid and it is sent with the new category", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...BASE,
      "GET /api/me": ME_PLUS,
      "POST /api/categories": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { id: "new" };
      },
    });
    await page.goto("/budgets");
    await page.getByRole("button", { name: /เพิ่มหมวด/ }).click();

    const dialog = page.getByRole("dialog", { name: /เพิ่มหมวด/ });
    await dialog.getByLabel("ชื่อหมวด").fill("เติมเกม");
    await dialog.getByRole("radio", { name: "อีโมจิ 🎮" }).click();
    await expect(dialog.getByRole("radio", { name: "อีโมจิ 🎮" })).toBeChecked();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByRole("button", { name: "เพิ่มหมวด" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ type: "expense", name: "เติมเกม", emoji: "🎮" });
  });

  test("Pro: typing something that is not one emoji is refused before sending", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, { ...BASE, "GET /api/me": ME_PLUS });
    await page.goto("/budgets");
    await page.getByRole("button", { name: /เพิ่มหมวด/ }).click();

    const dialog = page.getByRole("dialog", { name: /เพิ่มหมวด/ });
    await dialog.getByLabel("ชื่อหมวด").fill("ทดสอบ");
    await dialog.getByLabel("อีโมจิ (พิมพ์เอง)").fill("ab");
    await expect(dialog.getByText("ใส่ได้เป็นอีโมจิตัวเดียวเท่านั้นนะ").first()).toBeVisible();
    await dialog.getByRole("button", { name: "เพิ่มหมวด" }).click();
    await expect(dialog.getByRole("alert")).toContainText("อีโมจิตัวเดียว");
    expect(seen.some((s) => s.startsWith("POST"))).toBe(false);
  });

  test("Pro: clearing the emoji sends an empty one", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...BASE,
      "GET /api/me": ME_PLUS,
      "PATCH /api/categories/m1": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/budgets");
    await page.getByRole("button", { name: "แก้ไข ค่าอาหารแมว" }).click();
    const dialog = page.getByRole("dialog", { name: "แก้ไขหมวด" });
    await expect(dialog.getByRole("radio", { name: "อีโมจิ 🐱" })).toBeChecked();
    await dialog.getByRole("button", { name: "ล้าง" }).click();
    await dialog.getByRole("button", { name: "บันทึก" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ emoji: "" });
  });
});

test.describe("budgets page (360px)", () => {
  test("shows the budget progress with a text label, not just colour", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");

    await expect(page.getByRole("progressbar", { name: "การใช้งบ" })).toBeVisible();
    await expect(page.getByText("ใช้ไปแล้ว ฿8,500 (85%)")).toBeVisible();
    await expect(page.getByText("เหลือ ฿1,500")).toBeVisible();
    await expect(page.getByText("ใกล้ครบงบ")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");
    await expect(page.getByRole("progressbar", { name: "การใช้งบ" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("category budgets are Pro and above (360px)", () => {
  const CATEGORY_MODE = {
    ...BUDGETS,
    mode: "category",
    categories: [
      {
        categoryId: "a",
        name: "อาหาร",
        color: "#0F766E",
        amountSatang: 300_000,
        spentSatang: 100_000,
      },
    ],
  };
  const FOOD = { items: [CATEGORIES.items[0]] };

  test("Free: the แยกตามหมวด choice is off and the upgrade note shows; the overall budget works", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");

    await page.getByRole("button", { name: /รวมก้อนเดียว/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "แยกตามหมวด" })).toBeDisabled();
    await expect(page.getByRole("menuitemradio", { name: "รวมก้อนเดียว" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.getByText("สำหรับแผน Pro").first()).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "การใช้งบ" })).toBeVisible();
  });

  test("Free with an old category budget: kept, shown, but read only", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": CATEGORY_MODE,
      "GET /api/categories": FOOD,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");

    await page.getByRole("button", { name: "แก้ไข อาหาร" }).click();
    const field = page.getByLabel("งบหมวด อาหาร", { exact: true });
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue("3000");
  });

  test("Pro: the แยกตามหมวด choice and the budget field are open, quick amounts add up", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/budgets": CATEGORY_MODE,
      "GET /api/categories": FOOD,
      "GET /api/me": ME_PLUS,
      "PATCH /api/categories/a": { ok: true },
      "PUT /api/budgets": async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/budgets");

    await expect(page.getByText("จะแจ้งเตือนในแชทเมื่อใช้ถึง 80%")).toBeVisible();
    await page.getByRole("button", { name: /แยกตามหมวด/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "แยกตามหมวด" })).toBeEnabled();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "แก้ไข อาหาร" }).click();
    const dialog = page.getByRole("dialog", { name: "แก้ไขหมวด" });
    const field = dialog.getByLabel("งบหมวด อาหาร");
    await expect(field).toBeEnabled();
    await dialog.getByRole("button", { name: "+฿500" }).click();
    await expect(field).toHaveValue("3500");
    await dialog.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ categories: [{ categoryId: "a", amount: "3500" }] });
  });

  test("the card shows spent / budget, what is left and a bar; the totals add up in the hero", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/budgets": CATEGORY_MODE,
      "GET /api/categories": FOOD,
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/budgets");

    await expect(page.getByText("฿3,000").first()).toBeVisible(); // budget total = the one category
    await expect(page.getByText("เหลือ ฿2,000")).toBeVisible(); // 3,000 − 1,000 on the card
    await expect(page.getByRole("progressbar", { name: "การใช้งบหมวด อาหาร" })).toHaveAttribute(
      "aria-valuenow",
      "33",
    );
    await expectNoHorizontalScroll(page);
  });

  test("search filters the list; the sort button shows arrows", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/budgets");
    await page.getByLabel("ค้นหาหมวดหมู่").fill("ข้าว"); // a keyword of อาหาร
    await expect(page.getByRole("button", { name: "แก้ไข อาหาร" })).toBeVisible();
    await expect(page.getByRole("button", { name: "แก้ไข อื่นๆ" })).toHaveCount(0);
    await page.getByLabel("ค้นหาหมวดหมู่").fill("zzz");
    await expect(page.getByText("ไม่พบหมวดที่ค้นหา")).toBeVisible();
    await page.getByLabel("ค้นหาหมวดหมู่").fill("");
    await page.getByRole("button", { name: "จัดเรียง" }).click();
    await expect(page.getByRole("button", { name: "เลื่อน อื่นๆ ขึ้น" })).toBeVisible();
  });

  test("income tab: what came in this cycle per category, no budget hero", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": {
        ...BUDGETS,
        income: [{ categoryId: "inc", receivedSatang: 3_500_000 }],
      },
      "GET /api/categories": {
        items: [
          {
            id: "inc",
            type: "income",
            name: "เงินเดือน",
            own: false,
            keywords: [],
            color: "#059669",
            isHidden: false,
            sortOrder: 1,
            isFallback: false,
          },
        ],
      },
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/budgets");
    await page.getByRole("tab", { name: "หมวดรายรับ" }).click();
    await expect(page.getByText("+฿35,000")).toBeVisible();
    await expect(page.getByRole("region", { name: "งบประมาณ" })).toHaveCount(0);
  });
});

test.describe("daily budget (360px)", () => {
  const WITH_DAILY = { ...BUDGETS, daily: { amountSatang: 50_000, spentSatang: 62_000 } };
  const NO_DAILY = { ...BUDGETS, daily: { amountSatang: null, spentSatang: 32_000 } };

  test("Pro: shows today's use of the limit and saves a new one", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/budgets": WITH_DAILY,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
      "PUT /api/budgets": async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/budgets");

    const section = page.getByRole("region", { name: "งบรายวัน" });
    await expect(section.getByRole("progressbar", { name: "การใช้งบวันนี้" })).toBeVisible();
    await expect(section.getByText("เกินงบ")).toBeVisible();
    await section.getByLabel("งบรายวัน").fill("800");
    await section.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ daily: "800" });
  });

  test("clearing the field sends null", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/budgets": WITH_DAILY,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
      "PUT /api/budgets": async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/budgets");

    const section = page.getByRole("region", { name: "งบรายวัน" });
    await section.getByLabel("งบรายวัน").fill("");
    await section.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ daily: null });
  });

  test("a bad amount is refused before sending", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": NO_DAILY,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/budgets");

    const section = page.getByRole("region", { name: "งบรายวัน" });
    await section.getByLabel("งบรายวัน").fill("abc");
    await section.getByRole("button", { name: "บันทึก" }).click();
    await expect(section.getByText("จำนวนเงินไม่ถูกต้อง")).toBeVisible();
  });

  test("Free: the field is off with an upgrade note", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": NO_DAILY,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");

    const section = page.getByRole("region", { name: "งบรายวัน" });
    await expect(section.getByLabel("งบรายวัน")).toBeDisabled();
    await expect(section.getByText("สำหรับแผน Pro")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("budget cycle sheet (360px)", () => {
  test("ตั้งค่า opens a sheet that saves the cycle and shows it straight away", async ({ page }) => {
    const bodies: unknown[] = [];
    let cycle: Record<string, unknown> = { cycle: "monthly", cycleStartDay: 1 };
    await mockApi(page, {
      "GET /api/budgets": () => ({ ...BUDGETS, ...cycle }),
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
      "PATCH /api/settings": async (route: Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        bodies.push(body);
        cycle = { cycle: body.budget_cycle, cycleStartDay: body.cycle_start_day };
        return { ...SETTINGS, ...body };
      },
    });
    await page.goto("/budgets");
    await expect(page.getByText("ทุกวันที่ 1 ของเดือน")).toBeVisible();

    await page.getByRole("button", { name: "ตั้งค่ารอบงบ" }).click();
    const sheet = page.getByRole("dialog", { name: "รอบงบ" });
    await expect(sheet.getByRole("radio", { name: "รายเดือน" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await sheet.getByLabel("วันที่เริ่มต้นงบประมาณ").selectOption("25");
    await expectNoHorizontalScroll(page);
    await sheet.getByRole("button", { name: "บันทึก" }).click();

    await expect(sheet).toBeHidden();
    expect(bodies).toEqual([{ budget_cycle: "monthly", cycle_start_day: 25 }]);
    await expect(page.getByText("ทุกวันที่ 25 ของเดือน")).toBeVisible();
  });

  test("weekly hides the day and says the week starts on Monday", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
      "PATCH /api/settings": async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return SETTINGS;
      },
    });
    await page.goto("/budgets");
    await page.getByRole("button", { name: "ตั้งค่ารอบงบ" }).click();
    const sheet = page.getByRole("dialog", { name: "รอบงบ" });
    await sheet.getByRole("radio", { name: "รายสัปดาห์" }).click();
    await expect(sheet.getByLabel("วันที่เริ่มต้นงบประมาณ")).toBeHidden();
    await expect(sheet.getByText("เริ่มทุกวันจันทร์")).toBeVisible();
    await sheet.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ budget_cycle: "weekly", cycle_start_day: 1 });
  });

  test("a failed save keeps the sheet open with the reason", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
      "PATCH /api/settings": { status: 500, body: { error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" } },
    });
    await page.goto("/budgets");
    await page.getByRole("button", { name: "ตั้งค่ารอบงบ" }).click();
    const sheet = page.getByRole("dialog", { name: "รอบงบ" });
    await sheet.getByRole("button", { name: "บันทึก" }).click();
    await expect(sheet.getByRole("alert")).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(page.getByText("ทุกวันที่ 1 ของเดือน")).toBeVisible();
  });

  test("the sheet has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, {
      "GET /api/budgets": BUDGETS,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/budgets");
    await page.getByRole("button", { name: "ตั้งค่ารอบงบ" }).click();
    await expect(page.getByRole("dialog", { name: "รอบงบ" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("legal pages (public, no sign-in)", () => {
  for (const [path, heading] of [
    ["/privacy", "นโยบายความเป็นส่วนตัว"],
    ["/terms", "ข้อกำหนดการใช้งาน"],
  ] as const) {
    test(`${path} renders, fits the screen and is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("note")).toContainText("ฉบับร่าง");
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }

  test("security headers are present", async ({ request }) => {
    const res = await request.get("/privacy");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
