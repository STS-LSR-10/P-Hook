import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
  TX,
} from "./helpers";

const SUMMARY = {
  range: { from: "2026-09-30T17:00:00Z", to: "2026-10-31T17:00:00Z" },
  cycle: "monthly",
  incomeSatang: 2_000_000,
  expenseSatang: 750_000,
  balanceSatang: 1_250_000,
  accumulatedSatang: 3_456_700,
  count: 3,
  offset: 0,
  budgetSatang: null,
  categories: null,
  recent: [
    TX(),
    TX({
      id: "22222222-2222-2222-2222-222222222222",
      title: "เงินเดือน",
      type: "income",
      amountSatang: 2_000_000,
    }),
  ],
};

test.describe("summary page (360px)", () => {
  test("shows balance, totals and recent entries", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    await expect(page.getByRole("heading", { name: "สรุปภาพรวม" })).toBeVisible();
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible(); // balance
    await expect(page.getByText("฿7,500", { exact: true })).toBeVisible(); // expense
    await expect(page.getByText("กาแฟ", { exact: true })).toBeVisible();
    await expect(page.getByText("เงินเดือน")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("bottom navigation has six tabs and marks the current page", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    const nav = page.getByRole("navigation", { name: "เมนูหลัก" });
    await expect(nav.getByRole("link")).toHaveCount(6);
    await expect(nav.getByRole("link", { name: "สรุป" })).toHaveAttribute("aria-current", "page");
  });

  test("empty state when there are no entries", async ({ page }) => {
    await mockApi(page, {
      "GET /api/summary": {
        ...SUMMARY,
        incomeSatang: 0,
        expenseSatang: 0,
        balanceSatang: 0,
        accumulatedSatang: 0,
        count: 0,
        recent: [],
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/summary");
    await expect(page.getByText("ยังไม่มีรายการเลย")).toBeVisible();
  });

  test("error state offers a retry that recovers", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/summary": () =>
        ++calls === 1 ? { status: 500, body: { error: "ขออภัย ระบบสะดุดชั่วคราว" } } : SUMMARY,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/summary");

    await expect(page.getByRole("alert").filter({ hasText: "ระบบสะดุดชั่วคราว" })).toBeVisible();
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible();
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByText("กาแฟ", { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("Free: profile with plan badge, budget not set, category chart locked", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");

    const profile = page.getByRole("region", { name: "โปรไฟล์" });
    await expect(profile.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("ยังไม่ตั้ง")).toBeVisible();
    await expect(page.getByRole("link", { name: "ตั้งงบ" })).toBeVisible();
    await expect(page.getByText("ใช้ได้ในแผน Starter ขึ้นไป")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("Pro: ring, budget status, category details and the goal bar", async ({ page }) => {
    await mockApi(page, {
      "GET /api/summary": {
        ...SUMMARY,
        budgetSatang: 800_000,
        categories: [
          { categoryId: "a", name: "อาหาร", color: "#0F766E", totalSatang: 500_000 },
          { categoryId: "b", name: "เดินทาง", color: "#0369A1", totalSatang: 250_000 },
        ],
      },
      "GET /api/me": { ...ME_PLUS, features: { ...ME_PLUS.features, savingsGoal: true } },
      "GET /api/goals": {
        items: [
          {
            id: "g1",
            name: "เที่ยวญี่ปุ่น",
            emoji: "✈️",
            percent: 40,
            targetSatang: 5_000_000,
            archived: false,
            done: false,
          },
        ],
      },
    });
    await page.goto("/summary");

    await expect(page.getByText("ใกล้เต็มงบ")).toBeVisible(); // 7,500 of 8,000
    await expect(page.getByText("+฿500", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: /เที่ยวญี่ปุ่น/ })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    await page.getByRole("button", { name: "ดูรายละเอียดหมวดหมู่" }).click();
    await expect(
      page
        .getByRole("region", { name: "สัดส่วนการใช้จ่ายและงบ" })
        .getByText("อาหาร", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("66.7%")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("the accumulate button swaps the balance for the all-time one", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByText("เหลือเก็บรอบนี้")).toBeVisible();
    await page.getByRole("button", { name: "สะสม" }).click();
    await expect(page.getByText("เหลือเก็บสะสม")).toBeVisible();
    await expect(page.getByText("฿34,567", { exact: true })).toBeVisible();
  });

  test("the arrows step back through the cycles, and never forward past this one", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await expect(page.getByRole("button", { name: "รอบถัดไป" })).toBeDisabled();
    await page.getByRole("button", { name: "รอบก่อนหน้า" }).click();
    await expect.poll(() => seen.some((u) => u.includes("offset=-1"))).toBe(true);
    await expect(page.getByRole("button", { name: "รอบถัดไป" })).toBeEnabled();
  });

  test("while loading it shows the shape of the page, not an empty screen or dots", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/summary": async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return SUMMARY;
      },
      "GET /api/me": async () => {
        await new Promise((r) => setTimeout(r, 1200));
        return ME_FREE;
      },
    });
    await page.goto("/summary");

    const skeleton = page.getByRole("status", { name: "กำลังโหลด" });
    await expect(skeleton).toBeVisible();
    await expect(page.getByText("…")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByText("฿12,500", { exact: true })).toBeVisible();
  });

  test("shares the summary as a picture: preview, hidden amounts by default, save, no overflow", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/summary": {
        ...SUMMARY,
        categories: [
          {
            categoryId: "c1",
            name: "อาหาร",
            color: "#0F766E",
            icon: "utensils",
            totalSatang: 400_000,
          },
          {
            categoryId: "c2",
            name: "เดินทาง",
            color: "#0369A1",
            icon: "bus",
            totalSatang: 200_000,
          },
        ],
      },
      "GET /api/me": { ...ME_PLUS, referralCode: "ABCD1234" },
    });
    await page.goto("/summary");
    await page.getByRole("button", { name: "แชร์สรุปนี้" }).click();

    const dialog = page.getByRole("dialog", { name: "แชร์สรุปของฉัน" });
    await expect(dialog).toBeVisible();
    const picture = dialog.getByRole("img", { name: "ตัวอย่างการ์ดสรุปที่จะแชร์" });
    await expect(picture).toBeVisible();
    // a story-sized picture (9:16), made on the phone
    await expect
      .poll(() => picture.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]))
      .toEqual([1080, 1920]);
    const hiddenSrc = await picture.getAttribute("src");
    expect(hiddenSrc).toMatch(/^data:image\/png/);

    // amounts are hidden until the switch is turned off, and the picture changes with it
    const hide = dialog.getByRole("switch", { name: "ซ่อนยอดเงิน" });
    await expect(hide).toHaveAttribute("aria-checked", "true");
    await hide.click();
    await expect(hide).toHaveAttribute("aria-checked", "false");
    await expect(picture).not.toHaveAttribute("src", hiddenSrc!);

    await expect(dialog.getByRole("link", { name: "บันทึกรูป" })).toHaveAttribute(
      "download",
      "phook-summary.png",
    );
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("the picture is not blank: the title, the figure and the bars are drawn", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await page.getByRole("button", { name: "แชร์สรุปนี้" }).click();
    const picture = page
      .getByRole("dialog", { name: "แชร์สรุปของฉัน" })
      .getByRole("img", { name: "ตัวอย่างการ์ดสรุปที่จะแชร์" });
    await expect(picture).toBeVisible();
    const colours = await picture.evaluate((el: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(el, 0, 0);
      // the hero card (white) and the line about it (green) are inside the picture
      const px = (x: number, y: number) =>
        Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      return { hero: px(140, 500), headline: px(120, 1500), footer: px(96, 1700) };
    });
    expect(colours.hero).toEqual([255, 255, 255]);
    expect(colours.headline).toEqual([4, 120, 87]);
    expect(colours.footer).toEqual([255, 255, 255]);
  });

  test("card colours: Free has mint only, Starter and above can pick, and the picture follows", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await page.getByRole("button", { name: "แชร์สรุปนี้" }).click();
    const colours = page.getByRole("dialog", { name: "แชร์สรุปของฉัน" }).getByRole("radiogroup", {
      name: "สีการ์ด",
    });
    await expect(colours.getByRole("radio", { name: "เขียวมิ้นต์" })).toBeChecked();
    await expect(colours.getByRole("radio", { name: /ฟ้าทะเล/ })).toBeDisabled();
    await expect(colours.getByRole("radio", { name: /ดำกลางคืน/ })).toBeDisabled();
    await expect(page.getByText("สีอื่นสำหรับแผน Starter ขึ้นไป")).toBeVisible();

    // a paid plan picks one, and the picture is drawn again in it
    const paid = await page.context().newPage();
    await mockApi(paid, {
      "GET /api/summary": SUMMARY,
      "GET /api/me": { ...ME_PLUS, features: { ...ME_PLUS.features, personalize: true } },
    });
    await paid.goto("/summary");
    await paid.getByRole("button", { name: "แชร์สรุปนี้" }).click();
    const dialog = paid.getByRole("dialog", { name: "แชร์สรุปของฉัน" });
    const picture = dialog.getByRole("img", { name: "ตัวอย่างการ์ดสรุปที่จะแชร์" });
    await expect(picture).toBeVisible();
    const mint = await picture.getAttribute("src");
    await dialog.getByRole("radio", { name: /ดำกลางคืน/ }).click();
    await expect(dialog.getByRole("radio", { name: /ดำกลางคืน/ })).toBeChecked();
    await expect(picture).not.toHaveAttribute("src", mint!);
    await expect(dialog.getByText("สีอื่นสำหรับแผน Starter ขึ้นไป")).toHaveCount(0);
  });

  test("sending into a chat explains when the share picker is not there", async ({ page }) => {
    await mockApi(page, { "GET /api/summary": SUMMARY, "GET /api/me": ME_FREE });
    await page.goto("/summary");
    await page.getByRole("button", { name: "แชร์สรุปนี้" }).click();
    await page.getByRole("button", { name: "ส่งเข้าแชท LINE" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "ส่งเข้าแชทไม่ได้ตอนนี้ ลองเปิดสรุปนี้ในแอป LINE นะ" }),
    ).toBeVisible();
  });
});
