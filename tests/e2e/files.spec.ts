import { expect, test, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
} from "./helpers";

const ID = "00000000-0000-4000-8000-000000000001";
const file = {
  id: ID,
  name: "สัญญาเช่า.pdf",
  mimeType: "application/pdf",
  sizeBytes: 12 * 1024 * 1024,
  createdAt: "2026-10-01T05:00:00.000Z",
};
const PAGE = (items: unknown[]) => ({
  items,
  hasMore: false,
  usedBytes: 12 * 1024 * 1024,
  capacityBytes: 500 * 1024 * 1024,
});

test.describe("files page (360px)", () => {
  test("shows the space used and the files, with no accessibility or overflow problems", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/files": PAGE([file]) });
    await page.goto("/files");
    await expect(page.getByRole("heading", { name: "ไฟล์" })).toBeVisible();
    await expect(page.getByText("ใช้ไป 12 MB จาก 500 MB")).toBeVisible();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("keeps a very long name inside the page", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([{ ...file, name: `${"ก".repeat(190)}.pdf` }]),
    });
    await page.goto("/files");
    await expect(page.getByRole("list", { name: "ไฟล์" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("shows the empty state with how to keep a file", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE, "GET /api/files": PAGE([]) });
    await page.goto("/files");
    await expect(page.getByText("ยังไม่มีไฟล์")).toBeVisible();
    await expect(page.getByText("เก็บไว้ให้หน่อย")).toBeVisible();
  });

  test("shows the error state with retry", async ({ page }) => {
    let calls = 0;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": () => {
        calls += 1;
        return calls === 1
          ? { status: 500, body: { error: "ขออภัย ระบบสะดุดชั่วคราว" } }
          : PAGE([file]);
      },
    });
    await page.goto("/files");
    await page.getByRole("button", { name: "ลองอีกครั้ง" }).click();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
  });

  test("searches by name", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
    });
    await page.goto("/files");
    await page.getByRole("searchbox").fill("สัญญา");
    await page.getByRole("button", { name: "ค้นหา" }).click();
    await expect(page.getByText("ค้นหา “สัญญา”")).toBeVisible();
    expect(seen.some((s) => s.startsWith("GET /api/files?q="))).toBe(true);
  });

  test("renames a file", async ({ page }) => {
    let sent: unknown;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
      [`PATCH /api/files/${ID}`]: (route: Route) => {
        sent = JSON.parse(route.request().postData() ?? "{}");
        return { ok: true };
      },
    });
    await page.goto("/files");
    await page.getByRole("button", { name: "เปลี่ยนชื่อไฟล์" }).click();
    await page.getByLabel("ชื่อไฟล์", { exact: true }).fill("สัญญาใหม่");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await expect(page.getByRole("status")).toHaveText("เปลี่ยนชื่อแล้ว");
    expect(sent).toEqual({ name: "สัญญาใหม่" });
  });

  test("deletes after confirming", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
      [`DELETE /api/files/${ID}`]: { ok: true },
    });
    page.on("dialog", (d) => void d.accept());
    await page.goto("/files");
    await page.getByRole("button", { name: "ลบไฟล์" }).click();
    await expect(page.getByRole("status")).toHaveText("ลบแล้ว");
    expect(seen).toContain(`DELETE /api/files/${ID}`);
  });

  test("the open button opens the file outside LINE", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url: string) => {
        (window as unknown as { opened: string }).opened = url;
        return null;
      }) as typeof window.open;
    });
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
      [`POST /api/files/${ID}/link`]: { url: "https://app.example.com/d?t=1" },
    });
    await page.goto("/files");
    await page.getByRole("button", { name: "เปิดไฟล์" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened))
      .toBe("https://app.example.com/d?t=1");
  });

  test("?open=<id> asks for the link and opens it outside LINE", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url: string) => {
        (window as unknown as { opened: string }).opened = url;
        return null;
      }) as typeof window.open;
    });
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
      [`POST /api/files/${ID}/link`]: { url: "https://app.example.com/d?t=2" },
    });
    await page.goto(`/files?open=${ID}`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened))
      .toBe("https://app.example.com/d?t=2");
  });

  test("?open= with anything but an id asks for nothing", async ({ page }) => {
    const { seen } = await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
    });
    await page.goto("/files?open=../../plan/portal%3F");
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    expect(seen.filter((s) => s.startsWith("POST"))).toEqual([]);
  });

  test("a file that is gone says so", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/files": PAGE([file]),
      [`POST /api/files/${ID}/link`]: { status: 404, body: { error: "ไม่พบไฟล์นี้" } },
    });
    await page.goto(`/files?open=${ID}`);
    await expect(page.getByRole("status")).toHaveText("ไม่พบไฟล์นี้");
  });
});
