import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  openSettings,
  ME_FREE,
  ME_PLUS,
  SETTINGS,
} from "./helpers";

const COMMON = {
  "GET /api/settings": SETTINGS,
  "GET /api/recurring": { items: [], limit: 20 },
};

test.describe("settings page (360px)", () => {
  test("Free: shows the plan and Plus locks instead of errors", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_FREE });
    await openSettings(page);

    await expect(page.getByText("สมชาย ทดสอบ")).toBeVisible();
    await expect(page.getByText("สำหรับแผน Pro").first()).toBeVisible();
    await expect(page.getByRole("switch", { name: "เปิดเตือนจดประจำวัน" })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "เปิดสรุปรายสัปดาห์" })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "เปิดสรุปรายเดือน" })).toBeDisabled();
    await page.getByRole("button", { name: "รายการประจำ" }).click();
    const dialog = page.getByRole("dialog", { name: "รายการประจำ" });
    await expect(dialog.getByRole("button", { name: "เพิ่ม" })).toBeDisabled();
    await dialog.getByRole("button", { name: "ปิด" }).click();
    await expectNoHorizontalScroll(page);
  });

  test("Plus: reminder switch and recurring are usable", async ({ page }) => {
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/memory": { items: [] },
    });
    await openSettings(page);

    await expect(page.getByRole("switch", { name: "เปิดเตือนจดประจำวัน" })).toBeEnabled();
    await page.getByRole("button", { name: "รายการประจำ" }).click();
    await expect(
      page.getByRole("dialog", { name: "รายการประจำ" }).getByRole("button", { name: "เพิ่ม" }),
    ).toBeEnabled();
    await page
      .getByRole("dialog", { name: "รายการประจำ" })
      .getByRole("button", { name: "ปิด" })
      .click();
  });

  test("Pro: automatic summaries are off by default and saved when switched on", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/memory": { items: [] },
      "PATCH /api/settings": (route: Route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        return { ...SETTINGS, ...body };
      },
    });
    await openSettings(page);

    const weekly = page.getByRole("switch", { name: "เปิดสรุปรายสัปดาห์" });
    const monthly = page.getByRole("switch", { name: "เปิดสรุปรายเดือน" });
    await expect(weekly).toHaveAttribute("aria-checked", "false");
    await expect(monthly).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText(/ทุกวันจันทร์ 09:00/)).toBeVisible();
    await expect(page.getByText(/วันที่ 1 ของเดือน 09:00/)).toBeVisible();

    await weekly.click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ weekly_summary_enabled: true });
    await expect(weekly).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalScroll(page);
  });
  test("delete-all needs two steps and the exact phrase", async ({ page }) => {
    const { seen } = await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_FREE,
      "POST /api/account/delete": { ok: true },
    });
    await openSettings(page);

    await page.getByRole("button", { name: "ลบข้อมูลทั้งหมด" }).click(); // step 1: warning
    await expect(page.getByRole("dialog", { name: "ลบข้อมูลทั้งหมด?" })).toBeVisible();
    expect(seen.some((s) => s.startsWith("POST /api/account/delete"))).toBe(false);

    await page.getByRole("button", { name: "ดำเนินการต่อ" }).click(); // step 2: type phrase
    const confirm = page.getByRole("button", { name: "ลบข้อมูลทั้งหมดถาวร" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/พิมพ์/).fill("ลบข้อมูล");
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/พิมพ์/).fill("ลบข้อมูลทั้งหมด");
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(page.getByText("ลบข้อมูลทั้งหมดแล้ว")).toBeVisible();
  });

  test("reset-all shows what will go, asks for the phrase and sends the keep-balance choice", async ({
    page,
  }) => {
    let body: unknown = null;
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_FREE,
      "GET /api/account/erase": {
        entries: 1234,
        transfers: 12,
        debts: 3,
        goalDeposits: 5,
        files: 20,
        keptShared: 7,
      },
      "POST /api/account/erase": async (route: Route) => {
        body = route.request().postDataJSON();
        return { ok: true };
      },
    });
    await openSettings(page);

    await page.getByRole("button", { name: "ล้างประวัติการเงินทั้งหมด" }).click();
    const dialog = page.getByRole("dialog", { name: "ล้างประวัติการเงินทั้งหมด?" });
    await expect(dialog.getByText("รายการรับ/จ่าย 1,234 รายการ")).toBeVisible();
    await expect(dialog.getByText("รูปแนบและรูปสลิป 20 ไฟล์")).toBeVisible();
    await expect(dialog.getByText("กระเป๋าร่วม").first()).toBeVisible();
    await expect(dialog.getByLabel("คงยอดเงินปัจจุบันของแต่ละกระเป๋าไว้")).toBeChecked();
    await dialog.getByLabel("คงยอดเงินปัจจุบันของแต่ละกระเป๋าไว้").uncheck();

    await dialog.getByRole("button", { name: "ดำเนินการต่อ" }).click();
    const confirm = page.getByRole("button", { name: "ลบอย่างถาวร" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/พิมพ์/).fill("ล้างประวัติ");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByRole("status")).toContainText("ล้างประวัติการเงินแล้ว");
    expect(body).toEqual({ scope: "all", keepBalance: false, confirm: "ล้างประวัติ" });
  });

  test("delete one month: pick it, see the numbers, type the month's phrase", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_FREE,
      "GET /api/account/erase": async (_route: Route, url: URL) =>
        url.searchParams.get("scope") === "month"
          ? { entries: 40, transfers: 0, debts: 0, goalDeposits: 0, files: 2, keptShared: 0 }
          : {
              months: [
                { month: "2026-10", entries: 40, transfers: 0 },
                { month: "2026-09", entries: 5, transfers: 1 },
              ],
            },
      "POST /api/account/erase": async (route: Route) => {
        body = route.request().postDataJSON();
        return { ok: true };
      },
    });
    await openSettings(page);

    await page.getByRole("button", { name: "ลบเฉพาะเดือน" }).click();
    await page.getByLabel("เดือนที่จะลบ").selectOption("2026-10");
    await expect(page.getByText("รายการรับ/จ่าย 40 รายการ")).toBeVisible();
    await page.getByRole("button", { name: "ดำเนินการต่อ" }).click();

    const confirm = page.getByRole("button", { name: "ลบอย่างถาวร" });
    await page.getByLabel(/พิมพ์/).fill("ลบเดือน ก.ย. 2569"); // the wrong month
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/พิมพ์/).fill("ลบเดือน ต.ค. 2569");
    await confirm.click();
    await expect(page.getByRole("status")).toContainText("ลบข้อมูลเดือน ต.ค. 2569 แล้ว");
    expect(body).toEqual({ scope: "month", month: "2026-10", confirm: "ลบเดือน ต.ค. 2569" });
  });

  test("nothing to delete: the continue button says so", async ({ page }) => {
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_FREE,
      "GET /api/account/erase": {
        entries: 0,
        transfers: 0,
        debts: 0,
        goalDeposits: 0,
        files: 0,
        keptShared: 0,
      },
    });
    await openSettings(page);
    await page.getByRole("button", { name: "ล้างประวัติการเงินทั้งหมด" }).click();
    await expect(page.getByRole("button", { name: "ไม่มีอะไรให้ลบ" })).toBeDisabled();
  });

  test("links to the privacy policy and terms", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_FREE });
    await openSettings(page);
    await expect(page.getByRole("link", { name: "นโยบายความเป็นส่วนตัว" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await expect(page.getByRole("link", { name: "ข้อกำหนดการใช้งาน" })).toHaveAttribute(
      "href",
      "/terms",
    );
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_FREE });
    await openSettings(page);
    await expect(page.getByText("สมชาย ทดสอบ")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("the reminder and the summaries are one card; the time shows only while the reminder is on", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/memory": { items: [] },
      "PATCH /api/settings": (route: Route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        return { ...SETTINGS, ...body };
      },
    });
    await openSettings(page);
    const card = page.getByRole("region", { name: "การแจ้งเตือนและสรุปอัตโนมัติ" });
    await expect(card.getByRole("switch", { name: "เปิดสรุปรายสัปดาห์" })).toBeVisible();
    await expect(card.getByLabel("เวลาที่เตือน")).toHaveCount(0);
    await card.getByRole("switch", { name: "เปิดเตือนจดประจำวัน" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ daily_reminder_enabled: true });
    await expect(card.getByLabel("เวลาที่เตือน")).toBeVisible();
  });

  test("recurring and memory open as sheets; /settings#recurring opens the recurring one at once", async ({
    page,
  }) => {
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/memory": {
        items: [{ id: "m1", text: "ร้านลุงหนวด", categoryName: "อาหาร", hits: 3 }],
      },
    });
    await page.goto("/settings#recurring");
    await expect(page.getByRole("dialog", { name: "รายการประจำ" })).toBeVisible();
    await page
      .getByRole("dialog", { name: "รายการประจำ" })
      .getByRole("button", { name: "ปิด" })
      .click();
    await page.getByRole("button", { name: "เปิดทั้งหมด" }).click();
    await page.getByRole("button", { name: "จัดหมวดด้วยความจำ" }).click();
    await expect(
      page.getByRole("dialog", { name: "จัดหมวดด้วยความจำ" }).getByText("ร้านลุงหนวด"),
    ).toBeVisible();
  });

  test("payment history opens as a sheet with the real payments; the member and general groups are there", async ({
    page,
  }) => {
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": {
        ...ME_PLUS,
        payments: {
          ...ME_PLUS.payments,
          history: [
            {
              id: "p1",
              amountSatang: 3_900,
              status: "paid",
              createdAt: "2026-10-01T03:00:00Z",
              paidAt: "2026-10-01T03:01:00Z",
            },
            {
              id: "p2",
              amountSatang: 29_900,
              status: "refunded",
              createdAt: "2026-08-01T03:00:00Z",
              paidAt: null,
            },
          ],
        },
      },
      "GET /api/memory": { items: [] },
    });
    await openSettings(page);
    await expect(page.getByRole("link", { name: "อัปเกรด" })).toHaveAttribute("href", "/upgrade");
    // general: only what the app really supports, shown as information
    const general = page.getByRole("list", { name: "ทั่วไป" });
    await expect(general.getByText("ไทย", { exact: true })).toBeVisible();
    await expect(general.getByText("บาท (฿)")).toBeVisible();
    await expect(general.getByText("Bangkok")).toBeVisible();
    await page.getByRole("button", { name: "ประวัติการชำระเงิน" }).last().click();
    const dialog = page.getByRole("dialog", { name: "ประวัติการชำระเงิน" });
    await expect(dialog.getByText("฿39")).toBeVisible();
    await expect(dialog.getByText("ชำระแล้ว")).toBeVisible();
    await expect(dialog.getByText("คืนเงินแล้ว")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("settings sections and search (360px)", () => {
  test("sections start closed, open one at a time, and all at once", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_PLUS, "GET /api/memory": { items: [] } });
    await page.goto("/settings");

    const bot = page.getByRole("button", { name: "การแจ้งเตือนและแชทบอท" });
    await expect(bot).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("switch", { name: "เปิดสรุปรายสัปดาห์" })).toBeHidden();
    await bot.click();
    await expect(bot).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("switch", { name: "เปิดสรุปรายสัปดาห์" })).toBeVisible();
    await expect(page.getByRole("link", { name: "กระเป๋าเงิน" })).toBeHidden();

    await page.getByRole("button", { name: "เปิดทั้งหมด" }).click();
    await expect(page.getByRole("link", { name: "กระเป๋าเงิน" })).toBeVisible();
    await page.getByRole("button", { name: "ย่อทั้งหมด" }).click();
    await expect(bot).toHaveAttribute("aria-expanded", "false");
    await expectNoHorizontalScroll(page);
  });

  test("search keeps only the sections that match, opened, and says when nothing does", async ({
    page,
  }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_PLUS, "GET /api/memory": { items: [] } });
    await page.goto("/settings");

    await page.getByLabel("ค้นหาการตั้งค่า").fill("ชวนเพื่อน");
    await expect(page.getByRole("link", { name: "ชวนเพื่อน" })).toBeVisible();
    await expect(page.getByRole("button", { name: "การแจ้งเตือนและแชทบอท" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "เปิดทั้งหมด" })).toHaveCount(0);

    await page.getByLabel("ค้นหาการตั้งค่า").fill("ไม่มีแน่นอน");
    await expect(page.getByText("ไม่พบการตั้งค่า")).toBeVisible();

    await page.getByLabel("ค้นหาการตั้งค่า").fill("");
    await expect(page.getByRole("button", { name: "การแจ้งเตือนและแชทบอท" })).toBeVisible();
  });

  test("the budget cycle sits with the money settings and still saves", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_FREE,
      "PATCH /api/settings": (route: Route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        return { ...SETTINGS, ...body };
      },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "รอบงบ บัญชี และเป้าหมาย" }).click();
    await page.getByRole("radio", { name: "รายสัปดาห์" }).click();
    await expect.poll(() => bodies).toEqual([{ budget_cycle: "weekly" }]);
    await expect(page.getByText("บันทึกแล้ว")).toBeVisible();
  });

  test("the profile shows the plan, coins and streak, with a quota button", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/me": ME_PLUS });
    await page.goto("/settings");
    const profile = page.getByRole("region", { name: "โปรไฟล์และแผน" });
    await expect(profile.getByText("แผน Pro")).toBeVisible();
    await expect(profile.getByText("เหรียญสะสม")).toBeVisible();
    await expect(profile.getByText("จดต่อเนื่อง")).toBeVisible();
    await expect(profile.getByRole("link", { name: "โควตา" })).toHaveAttribute(
      "href",
      "/settings/quota",
    );
  });
});

const QUOTA = (plan: "free" | "plus" | "ultimate") => ({
  plan,
  planExpiresAt: plan === "free" ? null : "2027-10-17T00:00:00Z",
  kept: [
    {
      key: "storage",
      label: "พื้นที่เก็บไฟล์",
      used: 50 * 1024 * 1024,
      limit: 500 * 1024 * 1024,
      unit: "bytes",
      period: "total",
    },
    { key: "reminders", label: "การเตือน", used: 3, limit: 3, unit: "count", period: "total" },
    {
      key: "recurring",
      label: "รายการประจำ",
      used: 0,
      limit: plan === "free" ? 0 : 20,
      unit: "count",
      period: "total",
    },
  ],
  counted: [
    {
      key: "slips",
      label: "อ่านสลิป",
      used: 2,
      limit: plan === "ultimate" ? null : 30,
      unit: "count",
      period: "month",
    },
    { key: "owl", label: "ถามพี่ฮูก", used: 4, limit: 5, unit: "count", period: "month" },
  ],
});

test.describe("quota page (360px)", () => {
  test("Free: each quota with its use; full, near and locked ones say so", async ({ page }) => {
    await mockApi(page, { "GET /api/quota": QUOTA("free") });
    await page.goto("/settings/quota");

    await expect(page.getByRole("heading", { name: "โควตาการใช้งาน" })).toBeVisible();
    await expect(page.getByText("แผน Free")).toBeVisible();
    await expect(page.getByText("50 MB")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "การเตือน" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await expect(page.getByText("ใช้ครบแล้ว")).toBeVisible();
    await expect(page.getByText("ใกล้ครบแล้ว")).toBeVisible(); // owl 4 / 5
    await expect(page.getByText("ต้องอัปเกรด")).toBeVisible(); // recurring on Free
    await expect(page.getByRole("link", { name: "อัปเกรดเพื่อเพิ่มโควตา" })).toHaveAttribute(
      "href",
      "/upgrade",
    );
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("Elite: no plan limit reads as ไม่จำกัด and there is no upgrade button", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/quota": QUOTA("ultimate") });
    await page.goto("/settings/quota");
    await expect(page.getByText("แผน Elite")).toBeVisible();
    await expect(page.getByText("ไม่จำกัด")).toBeVisible();
    await expect(page.getByRole("link", { name: /อัปเกรด|ดูแผน/ })).toHaveCount(0);
  });

  test("a failed load can be retried, and the back link goes to settings", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/quota": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "โหลดไม่สำเร็จ" } } : QUOTA("plus");
      },
    });
    await page.goto("/settings/quota");
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("แผน Pro")).toBeVisible();
    await expect(page.getByRole("link", { name: "กลับไปหน้าตั้งค่า" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
