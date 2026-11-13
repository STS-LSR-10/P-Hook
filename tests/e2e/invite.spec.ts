import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  openSettings,
  ME_FREE,
  SETTINGS,
} from "./helpers";

test.describe("invite page (360px)", () => {
  test("shows the stats, the benefits, the steps and the code", async ({ page }) => {
    await mockApi(page, { "GET /api/me": { ...ME_FREE, referrals: 3, points: 150 } });
    await page.goto("/invite");

    await expect(page.getByRole("heading", { name: /ชวนเพื่อนมาจดใช้งาน/ })).toBeVisible();
    await expect(page.getByText("3 คน")).toBeVisible();
    await expect(page.getByText("สิทธิประโยชน์ที่ได้รับ")).toBeVisible();
    await expect(page.getByLabel("รหัสชวนเพื่อนของคุณ").last()).toHaveText("ABCD1234");
    await expect(page.getByRole("link", { name: "ส่งคำชวนผ่าน LINE" })).toHaveAttribute(
      "href",
      /^https:\/\/line\.me\/R\/share\?text=/,
    );
    // the shared message points to "add friend", not to the app (a non-friend must land on add)
    const href =
      (await page.getByRole("link", { name: "ส่งคำชวนผ่าน LINE" }).getAttribute("href")) ?? "";
    expect(decodeURIComponent(href)).toContain("https://line.me/R/ti/p/");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("outside the LINE app the invite still goes out as a text link", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.route("https://line.me/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<html><body>line share</body></html>" }),
    );
    await page.goto("/invite");
    await page.getByRole("link", { name: "ส่งคำชวนผ่าน LINE" }).click();
    await page.waitForURL(/^https:\/\/line\.me\/R\/share\?text=/);
    expect(decodeURIComponent(page.url())).toContain("ใช้รหัส ABCD1234");
  });

  test("shows how to earn HookCoins and what they buy", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/invite");
    const earn = page.getByRole("region", { name: "วิธีสะสมฮูกคอยน์" });
    await expect(earn.getByRole("listitem")).toHaveCount(8);
    await expect(earn.getByText("จดครบ 7 วันติดกัน")).toBeVisible();
    await expect(earn.getByText("จดครบ 30 วันติดกัน")).toBeVisible();
    const pass = page.getByRole("region", { name: "แลกฮูกคอยน์เป็น Pro Pass" });
    await expect(pass.getByText("Pro Pass 3 วัน")).toBeVisible();
    await expect(pass.getByText("150 ฮูกคอยน์")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("a friend's code can be entered here (and the field is gone once used)", async ({
    page,
  }) => {
    let referred = false;
    await mockApi(page, {
      "GET /api/me": () => ({ ...ME_FREE, referred }),
      "POST /api/referral": () => {
        referred = true;
        return { ok: true, message: "ใช้รหัสแล้ว!" };
      },
    });
    await page.goto("/invite");

    await page.getByLabel("รหัสของเพื่อน").fill("zzzz9999");
    await page.getByRole("button", { name: "ใช้รหัส" }).click();
    await expect(page.getByRole("status").filter({ hasText: "ใช้รหัสแล้ว!" })).toBeVisible();
    await expect(page.getByLabel("รหัสของเพื่อน")).toHaveCount(0);
  });

  test("short codes cannot be submitted", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/invite");
    await page.getByLabel("รหัสของเพื่อน").fill("AB");
    await expect(page.getByRole("button", { name: "ใช้รหัส" })).toBeDisabled();
  });

  test("settings has a link to it instead of the code card", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": { ...ME_FREE, referrals: 2 },
      "GET /api/settings": SETTINGS,
    });
    await openSettings(page);
    await expect(page.getByRole("link", { name: "ชวนเพื่อน" })).toHaveAttribute("href", "/invite");
    await expect(page.getByLabel("รหัสของเพื่อน")).toHaveCount(0);
  });
});
