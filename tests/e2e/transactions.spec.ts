import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
  TX,
} from "./helpers";

const LIST = {
  items: [
    TX(),
    TX({
      id: "22222222-2222-2222-2222-222222222222",
      title: "น้ำมัน",
      amountSatang: 50_000,
      categoryName: "เดินทาง",
      tags: ["ทริปเหนือ", "company"],
    }),
    TX({
      id: "33333333-3333-3333-3333-333333333333",
      title: "ร้านลุงหนวด",
      hasSlip: true,
      source: "slip",
    }),
  ],
  hasMore: false,
};

const CATEGORIES = { items: [{ id: "c1", type: "expense", name: "อาหาร", own: false }] };

test.describe("transactions page (360px)", () => {
  test("lists entries as cards grouped by day, with the day's total, no sideways scroll", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");

    await expect(page.getByText("น้ำมัน")).toBeVisible();
    await expect(page.getByText("#ทริปเหนือ #company")).toBeVisible();
    // the three entries are all on 15 Oct: one group, with their net total
    const group = page.getByRole("region", { name: "15 ต.ค. 2569" });
    await expect(group.getByText("รวม: -฿560")).toBeVisible();
    await expect(group.getByRole("button", { name: "แก้ไข กาแฟ" })).toBeVisible();
    // the card says it has a slip; delete and the slip live in the edit sheet
    await expect(page.getByRole("img", { name: "มีสลิป" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ลบ กาแฟ" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("entries on different days make separate groups, each with its own total", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [
          TX({
            id: "a1",
            title: "ข้าวเที่ยง",
            amountSatang: 12_000,
            occurredAt: "2026-10-16T05:00:00Z",
          }),
          TX({
            id: "a2",
            title: "เงินเดือน",
            type: "income",
            amountSatang: 3_500_000,
            occurredAt: "2026-10-01T02:00:00Z",
          }),
        ],
        hasMore: false,
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    await expect(
      page.getByRole("region", { name: "16 ต.ค. 2569" }).getByText("รวม: -฿120"),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "1 ต.ค. 2569" }).getByText("รวม: +฿35,000"),
    ).toBeVisible();
  });

  test("a foreign-currency entry shows the original amount and the rate under the title", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [
          TX({
            title: "ราเมน",
            amountSatang: 35_025,
            origCurrency: "JPY",
            origAmountMinor: 150_000,
            fxRate: 0.2335,
          }),
        ],
        hasMore: false,
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");

    await expect(page.getByText("1,500 JPY @ 0.2335")).toBeVisible();
    await expect(page.getByText("-฿350.25", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("entries in a shared wallet show who wrote them; the other person's cannot be changed", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [
          TX({
            id: "m1",
            title: "ข้าวเย็น",
            accountShared: true,
            accountName: "กองกลาง",
            mine: true,
            writerName: "แอน",
          }),
          TX({
            id: "o1",
            title: "ค่าน้ำมัน",
            accountShared: true,
            accountName: "กองกลาง",
            mine: false,
            writerName: "บ๊อบ",
          }),
        ],
        hasMore: false,
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");

    await expect(page.getByText("คุณ", { exact: true })).toBeVisible();
    await expect(page.getByText("บ๊อบ", { exact: true })).toBeVisible();
    await expect(page.getByText("กองกลาง", { exact: true })).toHaveCount(2); // the wallet chip on both
    await expect(page.getByRole("button", { name: "แก้ไข ค่าน้ำมัน" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "แก้ไข ข้าวเย็น" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("the type filter re-queries the server", async ({ page }) => {
    const { seen } = await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await expect(page.getByText("น้ำมัน")).toBeVisible();

    await page.getByRole("tab", { name: "รายจ่าย" }).click();
    await expect.poll(() => seen.some((s) => s.includes("type=expense"))).toBe(true);
  });

  test("searching with a # sends the text as typed so the server filters by tag", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await expect(page.getByText("น้ำมัน")).toBeVisible();

    await page.getByRole("searchbox", { name: "ค้นหาชื่อรายการหรือแท็ก" }).fill("#company");
    await expect.poll(() => seen.some((s) => s.includes("q=%23company"))).toBe(true);
  });

  test("an entry with a photo is marked on its card; the edit sheet shows it and can remove it", async ({
    page,
  }) => {
    const id = "44444444-4444-4444-4444-444444444444";
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const { seen } = await mockApi(page, {
      "GET /api/transactions": {
        items: [TX({ id, title: "ข้าวมันไก่", hasPhoto: true })],
        hasMore: false,
      },
      [`GET /api/transactions/${id}/photo`]: { url: png, expiresIn: 60 },
      [`DELETE /api/transactions/${id}/photo`]: { ok: true },
      "GET /api/categories": CATEGORIES,
      "GET /api/wallets": { items: [] },
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/transactions");

    await expect(page.getByRole("img", { name: "มีรูปแนบ" })).toBeVisible();
    await page.getByRole("button", { name: "แก้ไข ข้าวมันไก่" }).click();
    const dialog = page.getByRole("dialog", { name: "แก้ไขรายการ" });
    await expect(dialog.getByRole("img", { name: "รูปแนบ" })).toBeVisible();
    await dialog.getByRole("button", { name: "เอารูปออก" }).click();
    await dialog.getByRole("button", { name: "บันทึก" }).click();
    await expect
      .poll(() => seen.some((s) => s.includes(`DELETE /api/transactions/${id}/photo`)))
      .toBe(true);
    await expect(page.getByText("บันทึกแล้ว")).toBeVisible();
  });

  test("a search link prefills the box, and Pro sees the totals of everything found", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [TX({ title: "กาแฟเย็น" })],
        hasMore: false,
        totals: { incomeSatang: 10_000, expenseSatang: 10_550, count: 3 },
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions?q=กาแฟ");

    await expect(page.getByRole("searchbox", { name: "ค้นหาชื่อรายการหรือแท็ก" })).toHaveValue(
      "กาแฟ",
    );
    const strip = page.getByRole("status", { name: "ยอดรวมของผลค้นหา" });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("+฿100");
    await expect(strip).toContainText("-฿105.50");
    await expect(strip).toContainText("3 รายการ");
    await expectNoHorizontalScroll(page);
  });

  test("no totals strip when the server sends none (Free) or nothing is searched", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": { items: [TX()], hasMore: false, totals: null },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions?q=กาแฟ");
    await expect(page.getByText("กาแฟ").first()).toBeVisible();
    await expect(page.getByRole("status", { name: "ยอดรวมของผลค้นหา" })).toHaveCount(0);
  });

  test("a category's emoji is shown in front of its name in the list", async ({ page }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [TX({ title: "ทรายแมว", categoryName: "ค่าอาหารแมว", categoryIcon: "🐱" })],
        hasMore: false,
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    await expect(page.getByText("ค่าอาหารแมว", { exact: true })).toBeVisible();
    await expect(page.getByText("🐱", { exact: true })).toBeVisible(); // on the card's tile
  });

  test("each entry gets an icon that fits its title or category, on a tile in the category's colour", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": {
        items: [
          TX({ id: "a1", title: "กาแฟ", categoryName: "อาหาร", categoryIcon: "utensils" }),
          TX({
            id: "a2",
            title: "ค่าแท็กซี่",
            categoryName: "เดินทาง",
            categoryIcon: "bus",
            categoryColor: "#0369A1",
          }),
          TX({
            id: "a3",
            title: "ของลึกลับ",
            categoryName: "อาหาร",
            categoryIcon: "utensils",
          }),
          TX({
            id: "a4",
            title: "ของลึกลับอีกอย่าง",
            categoryName: "อื่นๆ",
            categoryIcon: "mystery-icon",
          }),
        ],
        hasMore: false,
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    const card = (title: string) =>
      page.getByRole("button", { name: `แก้ไข ${title}`, exact: true });
    await expect(card("กาแฟ")).toContainText("☕"); // the title beats the category
    await expect(card("ค่าแท็กซี่")).toContainText("🚕");
    await expect(card("ของลึกลับ")).toContainText("🍜"); // no word of the title: the category's icon
    await expect(card("ของลึกลับอีกอย่าง")).not.toContainText(/\p{Extended_Pictographic}/u); // a dot only
    // the tile takes the category's own colour (a faint tint of #0369A1)
    const tint = await card("ค่าแท็กซี่")
      .locator("span[aria-hidden]")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(tint).toMatch(/^rgba\(3, 105, 161, 0\.1\d*\)$/);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("empty state", async ({ page }) => {
    await mockApi(page, {
      "GET /api/transactions": { items: [], hasMore: false },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    await expect(page.getByText("ยังไม่มีรายการ", { exact: true })).toBeVisible();
  });

  test("deleting asks first, then calls the API", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/me": ME_FREE,
      "DELETE /api/transactions/11111111-1111-1111-1111-111111111111": { ok: true },
    });
    page.once("dialog", (d) => void d.accept());
    await page.goto("/transactions");
    await page.getByRole("button", { name: "แก้ไข กาแฟ" }).click();
    await page
      .getByRole("dialog", { name: "แก้ไขรายการ" })
      .getByRole("button", { name: "ลบรายการนี้" })
      .click();
    await expect
      .poll(() => seen.some((s) => s.startsWith("DELETE /api/transactions/1111")))
      .toBe(true);
    await expect(page.getByText("ลบแล้ว", { exact: true })).toBeVisible();
  });

  test("an entry added here that goes over the budget shows the warning on the page", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
      "POST /api/transactions": { id: "x", alerts: ["⚠️ หมวดอาหารเกินงบแล้ว"] },
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เพิ่ม" }).click();
    await page.getByLabel("ชื่อรายการ", { exact: true }).fill("ข้าว");
    await page.getByLabel("จำนวนเงิน").fill("500");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByText("จดแล้ว")).toBeVisible();
    await expect(page.getByText("หมวดอาหารเกินงบแล้ว")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("add sheet validates the amount before sending", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เพิ่ม" }).click();

    await page.getByLabel("ชื่อรายการ", { exact: true }).fill("ข้าว");
    await page.getByLabel("จำนวนเงิน").fill("abc");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "จำนวนเงินไม่ถูกต้อง" })).toBeVisible();
    expect(seen.some((s) => s.startsWith("POST"))).toBe(false);
  });

  test("export sheet is locked for Free and points to the upgrade page", async ({ page }) => {
    const { seen } = await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "ส่งออกไฟล์" }).click();

    const dialog = page.getByRole("dialog", { name: "ส่งออกข้อมูลรายการ" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("ส่งออก Excel / CSV สำหรับแผน Starter ขึ้นไป")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "ดูแผน" })).toHaveAttribute("href", "/upgrade");
    await expect(dialog.getByRole("button", { name: "สร้างไฟล์และส่งออก" })).toHaveCount(0);
    expect(seen.some((s) => s.includes("/api/export"))).toBe(false);
  });

  test("export sheet: format, the filters in use, columns and the zip switch go into the link request", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/me": { ...ME_PLUS, features: { ...ME_PLUS.features, pdfExport: true } },
      "POST /api/export/link": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { url: "http://localhost/api/export/download?t=x", expiresIn: 120 };
      },
    });
    await page.goto("/transactions");
    await page.getByRole("tab", { name: "รายจ่าย" }).click();
    await page.getByRole("button", { name: "ส่งออกไฟล์" }).click();

    const dialog = page.getByRole("dialog", { name: "ส่งออกข้อมูลรายการ" });
    await expect(dialog.getByText("ทุกช่วงเวลา")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Excel (.xlsx)" })).toBeChecked();
    await dialog.getByRole("radio", { name: "PDF สรุป" }).click();
    await dialog.getByLabel("หมวดหมู่").uncheck();
    await dialog.getByLabel("ที่มา (ข้อความ/สลิป)").uncheck();
    await dialog.getByRole("switch", { name: "รวมไฟล์รูปสลิปและใบเสร็จ" }).click();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByRole("button", { name: "สร้างไฟล์และส่งออก" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({
      format: "pdf",
      type: "expense",
      attachments: true,
      groups: ["date", "title", "amount", "type", "wallet", "fx"],
    });
  });

  test("export sheet: the last column cannot be unticked, and all columns send no list", async ({
    page,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/me": ME_PLUS,
      "POST /api/export/link": (route: Route) => {
        bodies.push(route.request().postDataJSON() as Record<string, unknown>);
        return { url: "http://localhost/api/export/download?t=x", expiresIn: 120 };
      },
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "ส่งออกไฟล์" }).click();
    const dialog = page.getByRole("dialog", { name: "ส่งออกข้อมูลรายการ" });
    await dialog.getByRole("button", { name: "สร้างไฟล์และส่งออก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ format: "xlsx" });
    expect(bodies[0]).not.toHaveProperty("groups");
    expect(bodies[0]).not.toHaveProperty("attachments");
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await expect(page.getByText("น้ำมัน")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("editing sends only the changed fields", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
      "PATCH /api/transactions/11111111-1111-1111-1111-111111111111": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "แก้ไข กาแฟ" }).click();

    const dialog = page.getByRole("dialog", { name: "แก้ไขรายการ" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("ชื่อรายการ")).toHaveValue("กาแฟ");
    await expect(dialog.getByLabel("จำนวนเงิน")).toHaveValue("30.00");
    await expectNoHorizontalScroll(page);

    await dialog.getByLabel("จำนวนเงิน").fill("45.50");
    await dialog.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ amount: "45.50" });
    await expect(page.getByText("บันทึกแล้ว")).toBeVisible();
  });

  test("?edit=<id> (the chat's แก้ button) opens that entry's editor, and saving says it worked", async ({
    page,
  }) => {
    const id = "11111111-1111-1111-1111-111111111111";
    const bodies: unknown[] = [];
    await mockApi(page, {
      [`GET /api/transactions/${id}`]: TX(),
      "GET /api/categories": CATEGORIES,
      "GET /api/wallets": { items: [] },
      "GET /api/me": ME_FREE,
      [`PATCH /api/transactions/${id}`]: (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true };
      },
    });
    await page.goto(`/transactions?edit=${id}`);

    // a full page, not a sheet: captions above every field and a summary card on top
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("ชื่อรายการ")).toHaveValue("กาแฟ");
    await expect(page.getByText("วันที่และเวลา")).toBeVisible();
    await expect(page.getByText("จำนวนเงิน (บาท)")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByLabel("ชื่อรายการ").fill("กาแฟเย็น");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ title: "กาแฟเย็น" });
    await expect(page.getByText("✅ แก้ไขรายการสำเร็จ")).toBeVisible();
    // outside LINE nothing can be sent: the page says why and offers the button (never a server push)
    await expect(
      page.getByText("ส่งการ์ดเข้าแชทได้เมื่อเปิดหน้านี้จากปุ่มในแชทของ LINE"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "ส่งการ์ดเข้าแชท" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("Pro can attach a photo in the editor (shrunk, sent after the entry); Free sees a locked row", async ({
    page,
  }) => {
    const id = "11111111-1111-1111-1111-111111111111";
    const uploads: string[] = [];
    await mockApi(page, {
      [`GET /api/transactions/${id}`]: TX(),
      "GET /api/categories": CATEGORIES,
      "GET /api/wallets": { items: [] },
      "GET /api/me": ME_PLUS,
      [`POST /api/transactions/${id}/photo`]: (route: Route) => {
        uploads.push(route.request().headers()["content-type"] ?? "");
        return { ok: true };
      },
    });
    await page.goto(`/transactions?edit=${id}`);
    await expect(page.getByText("ถ่ายหรือเลือกรูป")).toBeVisible();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByLabel("เลือกรูปแนบ")
      .setInputFiles({ name: "r.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("img", { name: "รูปแนบ" })).toBeVisible();
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0]).toContain("multipart/form-data");
    await expect(page.getByText("✅ แก้ไขรายการสำเร็จ")).toBeVisible();
  });

  test("Free sees the photo row locked with a link to the plans", async ({ page }) => {
    const id = "11111111-1111-1111-1111-111111111111";
    await mockApi(page, {
      [`GET /api/transactions/${id}`]: TX(),
      "GET /api/categories": CATEGORIES,
      "GET /api/wallets": { items: [] },
      "GET /api/me": ME_FREE,
    });
    await page.goto(`/transactions?edit=${id}`);
    await expect(page.getByText("ใช้ได้ในแผน Starter ขึ้นไป")).toBeVisible();
    await expect(page.getByLabel("เลือกรูปแนบ")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("?edit= for an entry that is gone says so instead of hanging", async ({ page }) => {
    const id = "99999999-9999-9999-9999-999999999999";
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.route(`**/api/transactions/${id}`, (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "ไม่พบรายการนี้" }),
      }),
    );
    await page.goto(`/transactions?edit=${id}`);
    await expect(page.getByText("ไม่พบรายการนี้")).toBeVisible();
  });

  test("edit sheet validates before sending", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "แก้ไข กาแฟ" }).click();
    const dialog = page.getByRole("dialog", { name: "แก้ไขรายการ" });

    await dialog.getByLabel("จำนวนเงิน").fill("0");
    await dialog.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "จำนวนเงินไม่ถูกต้อง" })).toBeVisible();
    expect(seen.some((s) => s.startsWith("PATCH"))).toBe(false);
  });

  test("select mode: choose two entries and delete them in one call", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/me": ME_FREE,
      "POST /api/transactions/bulk": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { updated: 2, skipped: 0 };
      },
    });
    page.once("dialog", (d) => void d.accept());
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เลือกหลายรายการ" }).click();

    const bar = page.getByRole("region", { name: "จัดการรายการที่เลือก" });
    await expect(bar.getByRole("button", { name: "ลบ" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "เลือก กาแฟ" }).check();
    await page.getByRole("checkbox", { name: "เลือก น้ำมัน" }).check();
    await expect(bar.getByText("เลือกแล้ว 2 รายการ")).toBeVisible();
    await expectNoHorizontalScroll(page);

    await bar.getByRole("button", { name: "ลบ" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      action: "delete",
      ids: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
    });
    await expect(page.getByText("ลบแล้ว 2 รายการ")).toBeVisible();
    await expect(page.getByRole("region", { name: "จัดการรายการที่เลือก" })).toHaveCount(0);
  });

  test("select mode: move the selection to another category", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": {
        items: [
          { id: "c1", type: "expense", name: "อาหาร" },
          { id: "c2", type: "income", name: "เงินเดือน" },
        ],
      },
      "GET /api/me": ME_FREE,
      "POST /api/transactions/bulk": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { updated: 1, skipped: 1 };
      },
    });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เลือกหลายรายการ" }).click();
    await page.getByRole("checkbox", { name: "เลือก กาแฟ" }).check();
    await page.getByRole("checkbox", { name: "เลือก น้ำมัน" }).check();
    await page.getByRole("button", { name: "ย้ายหมวด", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: /ย้ายหมวด 2 รายการ/ });
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByLabel("หมวดปลายทาง").selectOption({ label: "อาหาร" });
    await dialog.getByRole("button", { name: "ย้ายหมวด" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ action: "move", categoryId: "c1" });
    await expect(page.getByText("ย้ายหมวดแล้ว 1 รายการ (ข้าม 1)")).toBeVisible();
  });

  test("select mode has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await page.getByRole("button", { name: "เลือกหลายรายการ" }).click();
    await page.getByRole("checkbox", { name: "เลือก กาแฟ" }).check();
    await expectNoSeriousA11yViolations(page);
  });

  test("the calendar: pick a first and last day, apply, and the list asks for that range", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, { "GET /api/transactions": LIST, "GET /api/me": ME_FREE });
    await page.goto("/transactions");
    await expect(page.getByText("ทุกช่วงเวลา")).toBeVisible();

    await page.getByRole("button", { name: /ช่วงเวลาที่เลือก/ }).click();
    const dialog = page.getByRole("dialog", { name: "เลือกช่วงวันที่" });
    await expect(dialog.getByText("ยังไม่ได้เลือกช่วงวันที่")).toBeVisible();
    await dialog.getByRole("button", { name: "เดือนนี้" }).click();
    await expect(dialog.getByText(/^\d+ \S+ \d{4} — \d+ \S+ \d{4}$/)).toBeVisible();
    // two taps of one's own: the 10th and the 12th of the month on show
    const month = await dialog.getByRole("heading").innerText();
    await dialog.getByRole("button", { name: new RegExp(`^10 ${month.split(" ")[0]}`) }).click();
    await expect(dialog.getByText("เลือกวันสุดท้ายของช่วง")).toBeVisible();
    await dialog.getByRole("button", { name: new RegExp(`^12 ${month.split(" ")[0]}`) }).click();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByRole("button", { name: "ตกลง" }).click();

    await expect.poll(() => seen.some((u) => u.includes("from=") && u.includes("to="))).toBe(true);
    await expect(page.getByText(/10 .* — 12 /)).toBeVisible();
    // "ทั้งหมด" in the calendar clears it again
    await page.getByRole("button", { name: /ช่วงเวลาที่เลือก/ }).click();
    await page
      .getByRole("dialog", { name: "เลือกช่วงวันที่" })
      .getByRole("button", { name: "ทั้งหมด" })
      .click();
    await expect(page.getByText("ทุกช่วงเวลา")).toBeVisible();
  });

  test("category chips filter the list by category, and switching the type clears the choice", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": {
        items: [
          { id: "c1", type: "expense", name: "อาหาร", emoji: null },
          { id: "c2", type: "income", name: "เงินเดือน", emoji: null },
        ],
      },
      "GET /api/me": ME_FREE,
    });
    await page.goto("/transactions");
    const chips = page.getByRole("group", { name: "เลือกหมวดหมู่" });
    await chips.getByRole("button", { name: "อาหาร" }).click();
    await expect.poll(() => seen.some((u) => u.includes("categoryId=c1"))).toBe(true);
    await expect(page.getByText("อาหาร").first()).toBeVisible();
    await page.getByRole("tab", { name: "รายรับ" }).click();
    await expect(chips.getByRole("button", { name: "อาหาร" })).toHaveCount(0); // not an income category
    await expect(chips.getByRole("button", { name: "เงินเดือน" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the buttons under the filters: select several, and the recurring link; + adds", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/transactions": LIST,
      "GET /api/categories": CATEGORIES,
      "GET /api/me": ME_PLUS,
    });
    await page.goto("/transactions");
    await expect(page.getByRole("link", { name: "ตั้งรายการจดประจำ" })).toHaveAttribute(
      "href",
      "/settings#recurring",
    );
    await page.getByRole("button", { name: "เลือกหลายรายการ" }).click();
    // while choosing: the + is gone and the bar with the actions is at the top
    await expect(page.getByRole("button", { name: "เพิ่มรายการใหม่" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "จัดการรายการที่เลือก" })).toBeVisible();
    await page
      .getByRole("region", { name: "จัดการรายการที่เลือก" })
      .getByRole("button", { name: "ยกเลิก" })
      .click();
    await page.getByRole("button", { name: "เพิ่มรายการใหม่" }).click();
    await expect(page.getByLabel("ชื่อรายการ", { exact: true })).toBeVisible();
  });
});
