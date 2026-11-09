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
  features: { ...ME_PLUS.features, billReminder: true },
};

const bill = (over: Record<string, unknown>) => ({
  id: "b1",
  name: "ค่าไฟ",
  amountSatang: 125_000,
  cadence: "monthly",
  dayOfMonth: 15,
  monthOfYear: null,
  nextDueOn: "2099-11-15",
  remindDays: [2, 1],
  remindHour: 9,
  snoozedOn: null,
  note: null,
  isActive: true,
  ...over,
});

const LIST = {
  items: [
    bill({ id: "b0", name: "ค่าเน็ต", nextDueOn: "2020-01-01", amountSatang: null }),
    bill({}),
    bill({
      id: "card:c1",
      name: "บัตร KBank",
      fromCard: true,
      remindDays: [3, 1],
      nextDueOn: "2099-12-25",
      amountSatang: 450_000,
    }),
  ],
  limit: 30,
  canAdd: true,
};

test.describe("bills page (360px)", () => {
  test("lists bills with the next due date, an overdue one in red, and the card's due day read only", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_ULTIMATE, "GET /api/bills": LIST });
    await page.goto("/bills");

    await expect(page.getByText("ค่าไฟ").first()).toBeVisible();
    await expect(page.getByText(/เลยกำหนด/)).toBeVisible();
    await expect(page.getByText("จากวันชำระของบัตร")).toBeVisible();
    // the card's bill cannot be edited or deleted here
    await expect(page.getByRole("button", { name: "แก้ไข บัตร KBank" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "แก้ไข ค่าไฟ" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("empty state", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": { items: [], limit: 30, canAdd: true },
    });
    await page.goto("/bills");
    await expect(page.getByText("ยังไม่มีบิลที่ตั้งเตือน")).toBeVisible();
  });

  test("Free: an upgrade note, buttons off, no add button", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/bills": LIST });
    await page.goto("/bills");

    await expect(page.getByText("สำหรับแผน Pro")).toBeVisible();
    await expect(page.getByRole("button", { name: "เพิ่มบิล" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "แก้ไข ค่าไฟ" })).toBeDisabled();
  });

  test("adding sends the schedule, the chosen reminder days and the hour", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": LIST,
      "POST /api/bills": async (route: Route) => {
        body = route.request().postDataJSON();
        return { id: "new" };
      },
    });
    await page.goto("/bills");

    await page.getByRole("button", { name: "เพิ่มบิล" }).click();
    await page.getByLabel("ชื่อบิล").fill("ค่าน้ำ");
    await page.getByLabel("ยอดโดยประมาณ").fill("300");
    await page.getByLabel("วันที่ครบกำหนด").selectOption("25");
    await page.getByLabel("ก่อน 3 วัน").check();
    await page.getByLabel("เวลาที่ให้เตือน").selectOption("20");
    await page.getByRole("button", { name: "บันทึก" }).click();

    await expect(page.getByRole("status")).toContainText("เพิ่มบิลแล้ว");
    expect(body).toMatchObject({
      name: "ค่าน้ำ",
      amount: "300",
      cadence: "monthly",
      dayOfMonth: 25,
      remindDays: [1, 3],
      remindHour: 20,
    });
  });

  test("a yearly bill asks for the month", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_ULTIMATE, "GET /api/bills": LIST });
    await page.goto("/bills");

    await page.getByRole("button", { name: "เพิ่มบิล" }).click();
    await expect(page.getByLabel("เดือนที่ครบกำหนด")).toHaveCount(0);
    await page.getByLabel("ความถี่").selectOption("yearly");
    await expect(page.getByLabel("เดือนที่ครบกำหนด")).toBeVisible();
  });

  test("a bad amount and no reminder days are refused before sending", async ({ page }) => {
    let posted = false;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": LIST,
      "POST /api/bills": () => {
        posted = true;
        return { id: "x" };
      },
    });
    await page.goto("/bills");

    await page.getByRole("button", { name: "เพิ่มบิล" }).click();
    await page.getByLabel("ชื่อบิล").fill("ค่าน้ำ");
    await page.getByLabel("ยอดโดยประมาณ").fill("abc");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByText("จำนวนเงินไม่ถูกต้อง")).toBeVisible();

    await page.getByLabel("ยอดโดยประมาณ").fill("");
    await page.getByLabel("ก่อน 1 วัน").uncheck();
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByText("เลือกวันที่จะให้เตือนอย่างน้อย 1 ข้อ")).toBeVisible();
    expect(posted).toBe(false);
  });

  test("paid and recorded sends record true with the amount", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": LIST,
      "POST /api/bills/b1/pay": async (route: Route) => {
        body = route.request().postDataJSON();
        return { ok: true, nextDueOn: "2099-12-15", recorded: true };
      },
    });
    await page.goto("/bills");

    await page.getByRole("button", { name: "จ่ายแล้ว ค่าไฟ" }).click();
    await expect(page.getByLabel("จำนวนเงินที่จ่าย")).toHaveValue("1250.00");
    await page.getByRole("button", { name: "จ่ายแล้ว", exact: true }).last().click();

    await expect(page.getByRole("status")).toContainText("จ่ายแล้วและจดรายจ่ายให้แล้ว");
    expect(body).toMatchObject({ record: true, amount: "1250.00" });
  });

  test("skipping sends nothing to record", async ({ page }) => {
    let body: unknown = null;
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": LIST,
      "POST /api/bills/b1/pay": async (route: Route) => {
        body = route.request().postDataJSON();
        return { ok: true, nextDueOn: "2099-12-15", recorded: false };
      },
    });
    await page.goto("/bills");

    await page.getByRole("button", { name: "จ่ายแล้ว ค่าไฟ" }).click();
    await page.getByRole("button", { name: "ข้ามรอบนี้ (ไม่จด)" }).click();
    await expect(page.getByRole("status")).toContainText("ข้ามรอบนี้แล้ว");
    expect(body).toEqual({});
  });

  test("a failed load shows a retry", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_ULTIMATE,
      "GET /api/bills": { status: 500, body: { error: "เซิร์ฟเวอร์ขัดข้อง" } },
    });
    await page.goto("/bills");
    await expect(page.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
  });
});
