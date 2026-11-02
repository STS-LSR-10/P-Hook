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
  "GET /api/recurring": { items: [], limit: 20 },
  "GET /api/memory": { items: [] },
  "GET /api/wallets": { items: [], totalSatang: 0, limit: 5, canAdd: true },
};

test.describe("theme and bot manner (360px)", () => {
  test("Free sees the choices but only the default ones can be picked", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/settings": SETTINGS, "GET /api/me": ME_FREE });
    await openSettings(page);

    const card = page.getByRole("region", { name: "ธีมการ์ดและนิสัยบอท" });
    await expect(card).toBeVisible();
    await expect(card.getByText("สำหรับแผน Pro")).toBeVisible();
    await expect(card.getByRole("radio", { name: "เขียวมิ้นต์" })).toBeEnabled();
    await expect(card.getByRole("radio", { name: "ฟ้าทะเล" })).toBeDisabled();
    await expect(card.getByRole("radio", { name: /ดุหน่อย/ })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("Pro picks a theme and a manner, each saved on its own", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/settings": SETTINGS,
      "PATCH /api/settings": async (route: Route) => {
        const body = route.request().postDataJSON();
        bodies.push(body);
        return { ...SETTINGS, ...body };
      },
    });
    await openSettings(page);

    const card = page.getByRole("region", { name: "ธีมการ์ดและนิสัยบอท" });
    await card.getByRole("radio", { name: "ฟ้าทะเล" }).click();
    await expect(card.getByText("บันทึกแล้ว")).toBeVisible();
    await expect(card.getByRole("radio", { name: "ฟ้าทะเล" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await card.getByRole("radio", { name: /ดุหน่อย/ }).click();
    await expect(card.getByRole("radio", { name: /ดุหน่อย/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(bodies).toEqual([{ card_theme: "ocean" }, { bot_persona: "strict" }]);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("a failed save shows the reason and keeps the old choice", async ({ page }) => {
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/settings": SETTINGS,
      "PATCH /api/settings": { status: 500, body: { error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" } },
    });
    await openSettings(page);
    const card = page.getByRole("region", { name: "ธีมการ์ดและนิสัยบอท" });
    await card.getByRole("radio", { name: "ชมพูพีช" }).click();
    await expect(card.getByText("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง")).toBeVisible();
    await expect(card.getByRole("radio", { name: "เขียวมิ้นต์" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("photo offer after a save (360px)", () => {
  test("Free sees it locked; Pro can switch it off", async ({ page }) => {
    await mockApi(page, { ...COMMON, "GET /api/settings": SETTINGS, "GET /api/me": ME_FREE });
    await openSettings(page);
    const free = page.getByRole("region", { name: "ปุ่มแนบรูปบนการ์ด" });
    await expect(free.getByText("สำหรับแผน Pro")).toBeVisible();
    await expect(free.getByRole("switch")).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });

  test("Pro switches it off", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      ...COMMON,
      "GET /api/me": ME_PLUS,
      "GET /api/settings": SETTINGS,
      "PATCH /api/settings": async (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ...SETTINGS, photo_prompt: false };
      },
    });
    await openSettings(page);
    const card = page.getByRole("region", { name: "ปุ่มแนบรูปบนการ์ด" });
    await expect(card.getByRole("switch")).toBeChecked();
    await card.getByRole("switch").click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ photo_prompt: false });
    await expect(card.getByRole("switch")).not.toBeChecked();
  });
});
