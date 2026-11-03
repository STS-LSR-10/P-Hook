import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
} from "./helpers";

const G = "00000000-0000-4000-8000-0000000000aa";
const F1 = "00000000-0000-4000-8000-00000000000a";
const F2 = "00000000-0000-4000-8000-00000000000b";
const R1 = "00000000-0000-4000-8000-00000000000c";

const files = (items: unknown[], owner = true) => ({
  items,
  hasMore: false,
  ...(owner
    ? {
        usedBytes: 30 * 1024 * 1024,
        groupBytes: 12 * 1024 * 1024,
        capacityBytes: 2 * 1024 * 1024 * 1024,
      }
    : { usedBytes: null, groupBytes: null, capacityBytes: null }),
  spaceLow: !owner,
  isOwner: owner,
  viewToken: "tok",
});
const file = (id: string, name: string, mine: boolean) => ({
  id,
  name,
  mimeType: "application/pdf",
  sizeBytes: 6 * 1024 * 1024,
  createdAt: "2026-10-03T05:00:00.000Z",
  hasThumb: false,
  mine,
});
const reminder = {
  id: R1,
  body: "ประชุมทีม",
  remindAt: "2026-11-05T02:00:00.000Z",
  repeat: "weekly",
  status: "active",
  category: null,
  mine: true,
};

test.describe("a group's files and reminders (360px)", () => {
  test("shows the group's files and the owner's shared space, with no accessibility or overflow problems", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/groups/${G}/files`]: files([
        file(F1, "สัญญาเช่า.pdf", true),
        file(F2, "เมนูร้าน.pdf", false),
      ]),
    });
    await page.goto(`/group?id=${G}`);
    await expect(page.getByRole("heading", { name: "คลังกลุ่ม | พี่ฮูก" })).toBeVisible();
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.getByText(/ใช้ไป 30 MB จาก 2 GB/)).toBeVisible();
    await expect(page.getByText(/ไฟล์ในกลุ่มของคุณ 12 MB/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // only a file this person kept can be deleted by them
    await page.getByText("เมนูร้าน.pdf").click();
    await expect(page.getByRole("button", { name: "ลบไฟล์" })).toHaveCount(0);
    await expect(page.getByText("ลบได้เฉพาะคนที่เก็บไฟล์นี้")).toBeVisible();
  });

  test("a member sees only that the owner's space is running out, not the figures", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/groups/${G}/files`]: files([file(F1, "สัญญาเช่า.pdf", true)], false),
    });
    await page.goto(`/group?id=${G}`);
    await expect(page.getByText("พื้นที่เก็บไฟล์ของเจ้าของสมุดใกล้เต็มแล้ว")).toBeVisible();
    await expect(page.getByText(/ใช้ไป/)).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("lists the group's reminders, and cancels one", async ({ page }) => {
    let cancelled = false;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/groups/${G}/reminders`]: () => ({
        items: cancelled ? [] : [reminder],
        isOwner: false,
      }),
      [`DELETE /api/groups/${G}/reminders/${R1}`]: () => {
        cancelled = true;
        return { ok: true };
      },
    });
    await page.goto(`/group?id=${G}&tab=reminders`);
    await expect(page.getByText("ประชุมทีม")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "ยกเลิกเตือน ประชุมทีม" }).click();
    await expect(page.getByText("กลุ่มนี้ยังไม่มีเตือน")).toBeVisible();
  });

  test("says so for someone who is not in the group, and for a broken link", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      [`GET /api/groups/${G}/files`]: {
        status: 404,
        body: { error: "ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้" },
      },
    });
    await page.goto(`/group?id=${G}`);
    await expect(page.getByText("ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้")).toBeVisible();
    await page.goto("/group?id=nope");
    await expect(page.getByText("ไม่พบกลุ่มนี้")).toBeVisible();
  });
});
