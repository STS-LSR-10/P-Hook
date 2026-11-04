import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
} from "./helpers";

const NOW = "2026-11-15T03:00:00.000Z";
const ID = "00000000-0000-4000-8000-000000000001";
const INFO = (google: Record<string, unknown>) => ({
  reminder: { id: ID, body: "กินยา", remindAt: "2026-11-15T11:00:00.000Z", repeat: "daily" },
  google,
});

test.describe("add a reminder to a calendar (360px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
  });

  test("offers Google Calendar and the phone's calendar, with no overflow", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/reminders/${ID}/calendar`]: INFO({ available: true, linked: false, email: null }),
    });
    await page.goto(`/reminders/calendar?id=${ID}`);
    await expect(page.getByText("กินยา")).toBeVisible();
    await expect(page.getByText("· ทุกวัน")).toBeVisible();
    await expect(page.getByRole("button", { name: /Google Calendar/ })).toContainText(
      "ลงชื่อเข้าใช้ด้วย Google ครั้งแรก",
    );
    await expect(page.getByRole("button", { name: /ปฏิทินในเครื่อง/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("signed in: one tap adds it and says so", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/reminders/${ID}/calendar`]: INFO({
        available: true,
        linked: true,
        email: "a@gmail.com",
      }),
      [`POST /api/reminders/${ID}/calendar`]: { added: true, email: "a@gmail.com" },
    });
    await page.goto(`/reminders/calendar?id=${ID}`);
    await expect(page.getByText("เชื่อมกับ a@gmail.com แล้ว", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /Google Calendar/ }).click();
    await expect(page.getByRole("status")).toHaveText("เพิ่มลง Google Calendar แล้ว");
  });

  test("a reminder that is gone says so, with a way to try again", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/reminders/${ID}/calendar`]: {
        status: 404,
        body: { error: "ไม่พบเตือนนี้ หรือเตือนไปแล้ว" },
      },
    });
    await page.goto(`/reminders/calendar?id=${ID}`);
    await expect(page.getByText("ไม่พบเตือนนี้ หรือเตือนไปแล้ว")).toBeVisible();
  });
});
