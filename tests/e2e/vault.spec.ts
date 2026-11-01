import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
} from "./helpers";

const N1 = "00000000-0000-4000-8000-000000000001";
const N2 = "00000000-0000-4000-8000-000000000002";
const F1 = "00000000-0000-4000-8000-00000000000a";
const P1 = "00000000-0000-4000-8000-00000000000b";

const note = (id: string, body: string, day = 2) => ({
  id,
  body,
  createdAt: `2026-10-0${day}T05:00:00.000Z`,
  updatedAt: `2026-10-0${day}T05:00:00.000Z`,
});
const file = {
  id: F1,
  name: "สัญญาเช่า.pdf",
  mimeType: "application/pdf",
  sizeBytes: 12 * 1024 * 1024,
  createdAt: "2026-10-03T05:00:00.000Z",
  hasThumb: false,
};
const picture = {
  id: P1,
  name: "รูปบัตร.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 300 * 1024,
  createdAt: "2026-10-04T05:00:00.000Z",
  hasThumb: true,
};
const NOTES = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  hasMore: false,
  count: items.length,
  limit: 30,
  canAdd: true,
  ...extra,
});
const FILES = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  hasMore: false,
  usedBytes: 12 * 1024 * 1024,
  capacityBytes: 500 * 1024 * 1024,
  viewToken: "tok",
  ...extra,
});
const filtered = (route: Route, url: URL) => {
  const kind = url.searchParams.get("kind");
  void route;
  if (kind === "image") return FILES([picture]);
  if (kind === "file") return FILES([file]);
  return FILES([picture, file]);
};
const BASE = {
  "GET /api/me": ME_FREE,
  "GET /api/notes": (_r: Route, url: URL) =>
    url.searchParams.get("links") === "1"
      ? NOTES([note(N2, "เอกสาร https://example.com/a")])
      : NOTES([note(N1, "ซื้อนม\nไข่", 1), note(N2, "เอกสาร https://example.com/a")]),
  "GET /api/files": filtered,
};
const tab = (name: string) => ({ name, exact: true });

test.describe("vault page (360px)", () => {
  test("mixes notes and files, shows the space, with no accessibility or overflow problems", async ({
    page,
  }) => {
    await mockApi(page, BASE);
    await page.goto("/vault");
    await expect(page.getByRole("heading", { name: "คลัง | พี่ฮูก" })).toBeVisible();
    await expect(page.getByText("ส่วนตัว")).toBeVisible();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.getByText("ซื้อนม")).toBeVisible();
    await expect(page.getByText("12 MB / 500 MB")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("the menu has the vault before settings", async ({ page }) => {
    await mockApi(page, BASE);
    await page.goto("/vault");
    const labels = await page
      .getByRole("navigation", { name: "เมนูหลัก" })
      .getByRole("link")
      .allInnerTexts();
    expect(labels).toEqual(["สรุป", "วิเคราะห์", "หมวด/งบ", "รายการ", "คลัง", "ตั้งค่า"]);
    await expectNoHorizontalScroll(page);
  });

  test("the old pages lead here, and keep what they carried", async ({ page }) => {
    await mockApi(page, BASE);
    await page.goto("/notes?q=นม");
    await expect(page).toHaveURL(/\/vault\?tab=note&q=/);
    await page.goto("/files");
    await expect(page).toHaveURL(/\/vault\?tab=file/);
  });

  test("keeps a very long name inside the page", async ({ page }) => {
    await mockApi(page, {
      ...BASE,
      "GET /api/files": FILES([{ ...file, name: `${"ก".repeat(190)}.pdf` }]),
    });
    await page.goto("/vault");
    await expect(page.getByRole("list", { name: "รายการในคลัง" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("shows the empty state with the owl of the app", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/notes": NOTES([]),
      "GET /api/files": FILES([]),
    });
    await page.goto("/vault");
    await expect(page.getByText("ยังไม่มีอะไรในคลังเลยครับ")).toBeVisible();
    await expect(page.getByRole("img", { name: "พี่ฮูก (P'Hook)" })).toHaveAttribute(
      "src",
      "/logo.png",
    );
  });

  test("shows the error state with retry", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      ...BASE,
      "GET /api/files": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "ระบบสะดุด" } } : FILES([file]);
      },
    });
    await page.goto("/vault");
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
  });

  test("each tab shows its own things", async ({ page }) => {
    const { seen } = await mockApi(page, BASE);
    await page.goto("/vault");
    await page.getByRole("button", tab("โน้ต")).click();
    await expect(page.getByText("ซื้อนม")).toBeVisible();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeHidden();
    await page.getByRole("button", tab("ลิงก์")).click();
    await expect(page.getByText("ซื้อนม")).toBeHidden();
    await page.getByRole("button", tab("รูป")).click();
    await expect(page.getByText("รูปบัตร.jpg")).toBeVisible();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeHidden();
    await page.getByRole("button", tab("ไฟล์")).click();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    expect(seen.some((s) => s.includes("links=1"))).toBe(true);
    expect(seen.some((s) => s.includes("kind=image"))).toBe(true);
  });

  test("searches notes and files", async ({ page }) => {
    const { seen } = await mockApi(page, BASE);
    await page.goto("/vault");
    await page.getByRole("searchbox").fill("สัญญา");
    await page.getByRole("button", { name: "ค้นหา" }).click();
    await expect(page.getByText("ค้นหา “สัญญา”")).toBeVisible();
    expect(seen.some((s) => s.startsWith("GET /api/files?q="))).toBe(true);
    expect(seen.some((s) => s.startsWith("GET /api/notes?q="))).toBe(true);
  });

  test("hides a note that looks like a secret until it is opened", async ({ page }) => {
    await mockApi(page, { ...BASE, "GET /api/notes": NOTES([note(N1, "รหัสไวไฟ 12345678")]) });
    await page.goto("/vault?tab=note");
    await expect(page.getByText("12345678")).toBeHidden();
    await page.getByRole("button", { name: /ซ่อนเนื้อหา/ }).click();
    await expect(page.getByRole("textbox", { name: "เนื้อหาโน้ต" })).toHaveValue(
      "รหัสไวไฟ 12345678",
    );
  });

  test("adds a note", async ({ page }) => {
    let posted: unknown;
    await mockApi(page, {
      ...BASE,
      "POST /api/notes": (route: Route) => {
        posted = JSON.parse(route.request().postData() ?? "{}");
        return { id: N1 };
      },
    });
    await page.goto("/vault");
    await page.getByRole("button", { name: "เพิ่มโน้ต" }).click();
    await page.getByRole("textbox", { name: "โน้ตใหม่" }).fill("จดใหม่");
    await page.getByRole("button", { name: "จดโน้ต" }).click();
    await expect(page.getByRole("status")).toHaveText("จดแล้ว");
    expect(posted).toEqual({ body: "จดใหม่" });
  });

  test("a full notebook says so", async ({ page }) => {
    await mockApi(page, {
      ...BASE,
      "GET /api/notes": NOTES([note(N1, "ซื้อนม")], { canAdd: false }),
    });
    await page.goto("/vault");
    await page.getByRole("button", { name: "เพิ่มโน้ต" }).click();
    await expect(page.getByText("โน้ตเต็มแล้ว")).toBeVisible();
    await expect(page.getByRole("button", { name: "จดโน้ต" })).toBeDisabled();
  });

  test("edits and deletes a note", async ({ page }) => {
    let patched: unknown;
    await mockApi(page, {
      ...BASE,
      [`PATCH /api/notes/${N1}`]: (route: Route) => {
        patched = JSON.parse(route.request().postData() ?? "{}");
        return { ok: true };
      },
      [`DELETE /api/notes/${N1}`]: { ok: true },
    });
    page.on("dialog", (d) => void d.accept());
    await page.goto("/vault?tab=note");
    await page.getByRole("button", { name: /ซื้อนม/ }).click();
    await page.getByRole("textbox", { name: "เนื้อหาโน้ต" }).fill("แก้แล้ว");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByRole("status")).toHaveText("แก้ไขแล้ว");
    expect(patched).toEqual({ body: "แก้แล้ว" });
    await page.getByRole("button", { name: /ซื้อนม/ }).click();
    await page.getByRole("button", { name: "ลบโน้ต" }).click();
    await expect(page.getByRole("status")).toHaveText("ลบแล้ว");
  });

  test("a link opens outside LINE", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url: string) => {
        (window as unknown as { opened: string }).opened = url;
        return null;
      }) as typeof window.open;
    });
    await mockApi(page, BASE);
    await page.goto("/vault?tab=link");
    await page.getByRole("button", { name: /เอกสาร/ }).click();
    await page.getByRole("button", { name: "เปิดลิงก์" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened))
      .toBe("https://example.com/a");
  });

  test("pictures show their small preview, in a list and as a grid", async ({ page }) => {
    await mockApi(page, BASE);
    await page.route(`**/api/files/${P1}/view**`, (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    await page.goto("/vault?tab=image");
    await expect(page.locator('img[src*="size=thumb"]').first()).toHaveAttribute(
      "src",
      `/api/files/${P1}/view?t=tok&size=thumb`,
    );
    await page.getByRole("button", { name: "รูปเล็ก" }).click();
    await expect(page.getByRole("list", { name: "รูปเล็ก" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a file with no preview shows an icon", async ({ page }) => {
    await mockApi(page, BASE);
    await page.goto("/vault?tab=file");
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("tapping a picture opens it large, and it can be downloaded", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url: string) => {
        (window as unknown as { opened: string }).opened = url;
        return null;
      }) as typeof window.open;
    });
    await mockApi(page, {
      ...BASE,
      [`POST /api/files/${P1}/link`]: { url: "https://app.example.com/d?t=1" },
    });
    await page.goto("/vault?tab=image");
    await page.getByRole("button", { name: /รูปบัตร/ }).click();
    const dialog = page.getByRole("dialog", { name: "รูปบัตร.jpg" });
    await expect(dialog.locator("img")).toHaveAttribute("src", `/api/files/${P1}/view?t=tok`);
    await dialog.getByRole("button", { name: "ดาวน์โหลด" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened))
      .toBe("https://app.example.com/d?t=1");
  });

  test("renames a file", async ({ page }) => {
    let sent: unknown;
    await mockApi(page, {
      ...BASE,
      [`PATCH /api/files/${F1}`]: (route: Route) => {
        sent = JSON.parse(route.request().postData() ?? "{}");
        return { ok: true };
      },
    });
    await page.goto("/vault?tab=file");
    await page.getByRole("button", { name: /สัญญาเช่า/ }).click();
    await page.getByLabel("ชื่อไฟล์", { exact: true }).fill("สัญญาใหม่");
    await page.getByRole("button", { name: "บันทึกชื่อ" }).click();
    await expect(page.getByRole("status")).toHaveText("เปลี่ยนชื่อแล้ว");
    expect(sent).toEqual({ name: "สัญญาใหม่" });
  });

  test("deletes a file after confirming", async ({ page }) => {
    const { seen } = await mockApi(page, { ...BASE, [`DELETE /api/files/${F1}`]: { ok: true } });
    page.on("dialog", (d) => void d.accept());
    await page.goto("/vault?tab=file");
    await page.getByRole("button", { name: /สัญญาเช่า/ }).click();
    await page.getByRole("button", { name: "ลบไฟล์" }).click();
    await expect(page.getByRole("status")).toHaveText("ลบแล้ว");
    expect(seen).toContain(`DELETE /api/files/${F1}`);
  });

  test("?open=<id> asks for the link and opens it outside LINE", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url: string) => {
        (window as unknown as { opened: string }).opened = url;
        return null;
      }) as typeof window.open;
    });
    await mockApi(page, {
      ...BASE,
      [`POST /api/files/${F1}/link`]: { url: "https://app.example.com/d?t=2" },
    });
    await page.goto(`/files?open=${F1}`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened))
      .toBe("https://app.example.com/d?t=2");
  });

  test("?open= with anything but an id asks for nothing", async ({ page }) => {
    const { seen } = await mockApi(page, BASE);
    await page.goto("/vault?open=../../plan/portal%3F");
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    expect(seen.filter((s) => s.startsWith("POST"))).toEqual([]);
  });

  test("older things load with ดูเพิ่ม", async ({ page }) => {
    await mockApi(page, {
      ...BASE,
      "GET /api/files": (_r: Route, url: URL) =>
        url.searchParams.get("before")
          ? FILES([
              { ...file, id: P1, name: "เก่ากว่า.pdf", createdAt: "2026-09-01T05:00:00.000Z" },
            ])
          : FILES([file], { hasMore: true }),
    });
    await page.goto("/vault?tab=file");
    await page.getByRole("button", { name: "ดูเพิ่ม" }).click();
    await expect(page.getByText("เก่ากว่า.pdf")).toBeVisible();
  });
});
