import { expect, test, type Route } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousA11yViolations, mockApi } from "./helpers";

const CATALOG = [
  {
    sku: "storage_10",
    kind: "storage",
    label: "Storage Pack 10GB",
    units: 10,
    baht: 15,
    monthly: true,
  },
  {
    sku: "alerts_s",
    kind: "alerts",
    label: "Alert Booster S",
    units: 50,
    baht: 15,
    monthly: false,
  },
  { sku: "slips_100", kind: "slips", label: "Slip Pack 100", units: 100, baht: 19, monthly: false },
  {
    sku: "groups_2",
    kind: "group_slots",
    label: "Extra Group Slot",
    units: 2,
    baht: 29,
    monthly: true,
  },
];
const BASE = {
  plan: "plus",
  canBuy: true,
  paymentsAvailable: true,
  catalog: CATALOG,
  bonus: { storageBytes: 0, alerts: 0, slips: 0, groups: 0 },
  active: [],
};

test.describe("add-on boosters page (360px)", () => {
  test("lists the packs with their price and what they add, with no overflow or a11y problems", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/addons": BASE });
    await page.goto("/addons");

    await expect(page.getByRole("heading", { name: "ซื้อโควตาเพิ่ม" })).toBeVisible();
    const storage = page.getByRole("region", { name: /พื้นที่เก็บไฟล์/ });
    await expect(storage.getByText("Storage Pack 10GB")).toBeVisible();
    await expect(storage.getByText("฿15 / เดือน")).toBeVisible();
    const slips = page.getByRole("region", { name: /อ่านสลิปเพิ่ม/ });
    await expect(slips.getByText("฿19 · ซื้อครั้งเดียว")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("buying sends the pack and the chosen payment method, never a price", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/addons": BASE,
      "POST /api/addons/checkout": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { available: false, message: "ยังไม่เปิด" };
      },
    });
    await page.goto("/addons");
    await page.getByRole("radio", { name: /พร้อมเพย์/ }).click();
    await page.getByRole("button", { name: "ซื้อ Extra Group Slot" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ sku: "groups_2", method: "promptpay" });
    await expect(page.getByRole("status")).toContainText("ยังไม่เปิด");
  });

  test("Free is told to upgrade and the buy buttons are off", async ({ page }) => {
    await mockApi(page, { "GET /api/addons": { ...BASE, plan: "free", canBuy: false } });
    await page.goto("/addons");
    await expect(page.getByText("แพ็กเกจเสริมสำหรับแผน Starter ขึ้นไป")).toBeVisible();
    await expect(page.getByRole("button", { name: "ซื้อ Slip Pack 100" })).toBeDisabled();
  });

  test("shows what the person has, with the end date of a monthly pack", async ({ page }) => {
    await mockApi(page, {
      "GET /api/addons": {
        ...BASE,
        bonus: { storageBytes: 10 * 1024 ** 3, alerts: 0, slips: 64, groups: 2 },
        active: [{ sku: "groups_2", expiresAt: "2026-12-10T00:00:00Z" }],
      },
    });
    await page.goto("/addons");
    const have = page.getByRole("region", { name: "ที่คุณมีอยู่" });
    await expect(have).toContainText("สลิปเหลือ 64 ใบ");
    await expect(have).toContainText("Extra Group Slot");
  });

  test("a failed load shows a retry", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/addons": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "โหลดไม่สำเร็จ" } } : BASE;
      },
    });
    await page.goto("/addons");
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("Storage Pack 10GB")).toBeVisible();
  });
});
