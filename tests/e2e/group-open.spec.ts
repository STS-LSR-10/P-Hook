import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousA11yViolations, mockApi } from "./helpers";

const CHECK = {
  friend: true,
  plan: "ultimate",
  canOpen: true,
  addFriendUrl: "https://line.me/R/ti/p/%40964jamyy",
};

test.describe("open the group ledger page (360px)", () => {
  test("a friend on Elite gets the open button; outside LINE it explains what to type", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/group-open": CHECK });
    await page.goto("/group-open");
    await expect(page.getByRole("heading", { name: "เปิดสมุดกลุ่มนี้" })).toBeVisible();
    await page.getByRole("button", { name: /เปิดสมุดกลุ่ม/ }).click();
    // outside the LINE app the page cannot write in the chat, so it says what to type
    await expect(page.getByText(/กลับไปที่กลุ่มแล้วพิมพ์/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("someone who is not a friend gets an explanation and a link to add the bot, and no open button", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/group-open": { ...CHECK, friend: false } });
    await page.goto("/group-open");
    await expect(
      page.getByRole("heading", { name: /ยังไม่ได้เพิ่มพี่ฮูกเป็นเพื่อน/ }),
    ).toBeVisible();
    const add = page.getByRole("link", { name: "เพิ่มเพื่อน" });
    await expect(add).toHaveAttribute("href", "https://line.me/R/ti/p/%40964jamyy");
    await expect(page.getByRole("button", { name: /เปิดสมุดกลุ่ม/ })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("a friend without Elite is told, with a link to the plans", async ({ page }) => {
    await mockApi(page, { "GET /api/group-open": { ...CHECK, plan: "free", canOpen: false } });
    await page.goto("/group-open");
    await expect(page.getByRole("heading", { name: /ต้องเป็นแผน Starter/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /ดูแผนและทดลองใช้ฟรี/ })).toHaveAttribute(
      "href",
      "/upgrade",
    );
    await expect(page.getByRole("button", { name: /เปิดสมุดกลุ่ม/ })).toHaveCount(0);
  });

  test("when LINE could not tell (friend unknown) the person can still try", async ({ page }) => {
    await mockApi(page, { "GET /api/group-open": { ...CHECK, friend: null } });
    await page.goto("/group-open");
    await expect(page.getByRole("button", { name: /เปิดสมุดกลุ่ม/ })).toBeVisible();
  });

  test("a failed check shows a retry", async ({ page }) => {
    await mockApi(page, { "GET /api/group-open": { status: 500, body: { error: "ผิดพลาด" } } });
    await page.goto("/group-open");
    await expect(page.getByRole("button", { name: "ลองอีกครั้ง" })).toBeVisible();
  });
});
