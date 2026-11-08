import { expect, test, type Route } from "@playwright/test";
import { expectNoHorizontalScroll, mockApi, ME_PLUS, SETTINGS } from "./helpers";

test.describe("suggestions in settings (360px)", () => {
  test("the button sits after the general settings; a written suggestion is sent and thanked", async ({
    page,
  }) => {
    const sent: unknown[] = [];
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [] },
      "POST /api/feedback": (route: Route) => {
        sent.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/settings");

    const general = page.getByRole("button", { name: /ตั้งค่าทั่วไป/ });
    const suggest = page.getByRole("button", { name: "💡 เสนอแนะ" });
    await expect(suggest).toBeVisible();
    // right after the general settings, before privacy
    const top = async (l: typeof suggest) => (await l.boundingBox())?.y ?? 0;
    const privacy = page.getByRole("button", { name: /จัดการข้อมูลและความเป็นส่วนตัว/ });
    expect(await top(general)).toBeLessThan(await top(suggest));
    expect(await top(suggest)).toBeLessThan(await top(privacy));

    await suggest.click();
    const dialog = page.getByRole("dialog", { name: "💡 เสนอแนะ" });
    const submit = dialog.getByRole("button", { name: "ส่งข้อเสนอแนะ" });
    await expect(submit).toBeDisabled(); // nothing written yet
    await dialog.getByLabel("ข้อเสนอแนะ").fill("อยากให้มีโหมดมืด");
    await expectNoHorizontalScroll(page);
    await submit.click();

    await expect(dialog.getByText("ขอบคุณที่ช่วยพี่ฮูกพัฒนา 🦉")).toBeVisible();
    expect(sent).toEqual([{ body: "อยากให้มีโหมดมืด" }]);
  });

  test("a failed send shows why and keeps what was written", async ({ page }) => {
    await mockApi(page, {
      "GET /api/settings": SETTINGS,
      "GET /api/me": ME_PLUS,
      "GET /api/groups": { items: [] },
      "POST /api/feedback": { status: 429, body: { error: "ส่งบ่อยเกินไป" } },
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "💡 เสนอแนะ" }).click();
    const dialog = page.getByRole("dialog", { name: "💡 เสนอแนะ" });
    await dialog.getByLabel("ข้อเสนอแนะ").fill("ข้อความของฉัน");
    await dialog.getByRole("button", { name: "ส่งข้อเสนอแนะ" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("ข้อเสนอแนะ")).toHaveValue("ข้อความของฉัน");
  });
});
