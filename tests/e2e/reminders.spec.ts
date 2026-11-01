import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
} from "./helpers";

// a fixed clock, so the calendar does not depend on the day the test runs
const NOW = "2026-11-15T03:00:00.000Z"; // 15 Nov 2569, 10:00 in Bangkok

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const item = (n: number, body: string, remindAt: string, over: Record<string, unknown> = {}) => ({
  id: ID(n),
  body,
  remindAt,
  repeat: null,
  status: "active",
  category: null,
  ...over,
});
const LIST = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  active: items.length,
  limit: 3,
  canAdd: true,
  ...extra,
});
const THREE = [
  item(1, "จ่ายค่าเน็ต", "2026-11-15T07:00:00.000Z", { category: "bill" }),
  item(2, "กินยา", "2026-11-15T11:00:00.000Z", { repeat: "daily", category: "health" }),
  item(3, "ส่งรายงาน", "2026-11-20T02:00:00.000Z", { status: "done", category: "work" }),
];
const row = (name: string) => ({ name: new RegExp(`^${name}`) });

test.describe("reminders page (360px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
  });

  test("opens on the calendar of today, with no overflow or accessibility problems", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await expect(page.getByRole("heading", { name: "เตือน | พี่ฮูก" })).toBeVisible();
    await expect(page.getByText("พฤศจิกายน 2569")).toBeVisible();
    await expect(page.getByText("รายการเตือน: 15 พ.ย. 2569")).toBeVisible();
    await expect(page.getByRole("button", row("จ่ายค่าเน็ต"))).toContainText("เวลา 14:00 น.");
    await expect(page.getByRole("button", row("กินยา"))).toContainText("เวลา 18:00 น.");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("tapping a day shows its reminders", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "20 พ.ย. 2569, มีเตือน" }).click();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toBeVisible();
    await expect(page.getByRole("button", row("จ่ายค่าเน็ต"))).toBeHidden();
  });

  test("a repeat shows on the days ahead, but only its next round can be ticked", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await expect(page.getByRole("button", { name: "ทำเสร็จ กินยา" })).toBeVisible();
    await page.getByRole("button", { name: "18 พ.ย. 2569, มีเตือน" }).click();
    await expect(page.getByRole("button", row("กินยา"))).toBeVisible();
    await expect(page.getByRole("button", { name: "ทำเสร็จ กินยา" })).toBeHidden();
  });

  test("moves between months and back to today", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "ถัดไป" }).click();
    await expect(page.getByText("ธันวาคม 2569")).toBeVisible();
    await page.getByRole("button", { name: "วันนี้" }).click();
    await expect(page.getByText("พฤศจิกายน 2569")).toBeVisible();
  });

  test("the week and day views show the same reminders", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "สัปดาห์", exact: true }).click();
    await expect(page.getByText("15 พ.ย. 2569 - 21 พ.ย. 2569")).toBeVisible();
    await page.getByRole("button", { name: "20 พ.ย. 2569, มีเตือน" }).click();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toBeVisible();
    await page.getByRole("button", { name: "วัน", exact: true }).click();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toBeVisible();
    await page.getByRole("button", { name: "ก่อนหน้า" }).click();
    await expect(page.getByText("รายการเตือน: 19 พ.ย. 2569")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a day with nothing says so", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST([]) });
    await page.goto("/reminders");
    await expect(page.getByText("ไม่มีรายการเตือนในวันที่เลือก")).toBeVisible();
  });

  test("shows the error with a retry", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "ระบบสะดุด" } } : LIST(THREE);
      },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByRole("button", row("จ่ายค่าเน็ต"))).toBeVisible();
  });

  test("the all view filters by state, and counts", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    await page.getByRole("button", { name: /รายการทั้งหมด/ }).click();
    await expect(page.getByRole("button", { name: "ทั้งหมด (3)" })).toBeVisible();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toContainText("20 พ.ย.");
    await page.getByRole("button", { name: "ยังไม่เตือน" }).click();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toBeHidden();
    await page.getByRole("button", { name: "เสร็จสิ้นแล้ว" }).click();
    await expect(page.getByRole("button", row("จ่ายค่าเน็ต"))).toBeHidden();
    await expect(page.getByRole("button", row("ส่งรายงาน"))).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("sets a reminder with its day, time, category and repeat", async ({ page }) => {
    let posted: unknown;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      "POST /api/reminders": (route: Route) => {
        posted = JSON.parse(route.request().postData() ?? "{}");
        return { reminder: {} };
      },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "เพิ่มการเตือนใหม่" }).click();
    await page.getByLabel("ชื่อรายการเตือน").fill("ซื้อยา");
    await page.getByLabel("เวลา").fill("20:30");
    await page.getByRole("button", { name: /สุขภาพ/ }).click();
    await page.getByLabel("ทำซ้ำ").selectOption("weekly");
    await page.getByRole("button", { name: "บันทึกการเตือน" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "บันทึกการเตือนให้แล้ว" }),
    ).toBeVisible();
    expect(posted).toEqual({
      body: "ซื้อยา",
      remindAt: "2026-11-15T13:30:00.000Z",
      repeat: "weekly",
      category: "health",
    });
  });

  test("a full list blocks adding and says so", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE, { canAdd: false }),
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "เพิ่มการเตือนใหม่" }).click();
    await expect(page.getByText("มีเตือนที่รออยู่ครบ 3 รายการแล้ว")).toBeVisible();
    await expect(page.getByRole("button", { name: "บันทึกการเตือน" })).toBeDisabled();
  });

  test("tapping a row edits it", async ({ page }) => {
    let patched: unknown;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      [`PATCH /api/reminders/${ID(1)}`]: (route: Route) => {
        patched = JSON.parse(route.request().postData() ?? "{}");
        return { reminder: {} };
      },
    });
    await page.goto("/reminders");
    await page.getByRole("button", row("จ่ายค่าเน็ต")).click();
    await expect(page.getByLabel("ชื่อรายการเตือน")).toHaveValue("จ่ายค่าเน็ต");
    await expect(page.getByLabel("วันที่เตือน")).toHaveValue("2026-11-15");
    await expect(page.getByLabel("เวลา")).toHaveValue("14:00");
    await page.getByLabel("เวลา").fill("16:00");
    await page.getByRole("button", { name: "บันทึกการเตือน" }).click();
    await expect(page.getByRole("status").filter({ hasText: "แก้ไขแล้ว" })).toBeVisible();
    expect(patched).toEqual({
      body: "จ่ายค่าเน็ต",
      remindAt: "2026-11-15T09:00:00.000Z",
      repeat: null,
      category: "bill",
    });
  });

  test("ticking a one-off marks it done", async ({ page }) => {
    let sent: unknown;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      [`PATCH /api/reminders/${ID(1)}`]: (route: Route) => {
        sent = JSON.parse(route.request().postData() ?? "{}");
        return { ok: true };
      },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "ทำเสร็จ จ่ายค่าเน็ต" }).click();
    await expect(page.getByRole("status").filter({ hasText: "เสร็จแล้ว" })).toBeVisible();
    expect(sent).toEqual({ action: "done" });
  });

  test("ticking a repeat says the next round goes on", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      [`PATCH /api/reminders/${ID(2)}`]: { ok: true, skipped: true },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "ทำเสร็จ กินยา" }).click();
    await expect(page.getByRole("status").filter({ hasText: "ข้ามรอบนี้แล้ว" })).toBeVisible();
  });

  test("a tick is taken back, and a refusal is shown", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      [`PATCH /api/reminders/${ID(3)}`]: {
        status: 409,
        body: { error: "เลยเวลาแล้ว กดแก้เพื่อตั้งเวลาใหม่นะ" },
      },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "20 พ.ย. 2569, มีเตือน" }).click();
    await page.getByRole("button", { name: "ยกเลิกเสร็จ ส่งรายงาน" }).click();
    await expect(page.getByRole("status").filter({ hasText: "เลยเวลาแล้ว" })).toBeVisible();
  });

  test("deletes after asking, and tells a repeat from a single round", async ({ page }) => {
    const asked: string[] = [];
    page.on("dialog", (d) => {
      asked.push(d.message());
      void d.accept();
    });
    const { seen } = await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST(THREE),
      [`DELETE /api/reminders/${ID(2)}`]: { ok: true },
    });
    await page.goto("/reminders");
    await page.getByRole("button", { name: "ลบ กินยา" }).click();
    await expect(page.getByRole("status").filter({ hasText: "ลบแล้ว" })).toBeVisible();
    expect(asked[0]).toContain("ทุกรอบ");
    expect(seen).toContain(`DELETE /api/reminders/${ID(2)}`);
  });

  test("tapping the owl gives a new word, with no broken picture", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/reminders": LIST(THREE) });
    await page.goto("/reminders");
    const greeting = page.getByTestId("owl-word");
    const first = await greeting.innerText();
    await page.getByRole("button", { name: "แตะพี่ฮูก" }).click();
    await expect(greeting).not.toHaveText(first);
    await expect(page.getByRole("img", { name: "พี่ฮูก (P'Hook)" })).toHaveAttribute(
      "src",
      "/logo.png",
    );
  });

  test("long names stay on one row, inside the page", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/reminders": LIST([item(1, "ก".repeat(200), "2026-11-15T07:00:00.000Z")]),
    });
    await page.goto("/reminders");
    await expect(page.getByRole("list", { name: "รายการเตือน" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
