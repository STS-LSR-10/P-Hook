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
const OWN_FILES = {
  items: [{ ...file(F2, "บิลค่าไฟ.pdf", true), mine: undefined }],
  hasMore: false,
  usedBytes: 30 * 1024 * 1024,
  capacityBytes: 2 * 1024 * 1024 * 1024,
  viewToken: "tok",
};
const OWN_NOTES = { items: [], hasMore: false, canAdd: true };
const GROUPS = { items: [{ id: G, name: "บ้านเรา", isActive: true }] };

test.describe("switching the vault and reminders to a group (360px)", () => {
  test("the owner switches the vault to a group's files, and back", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": GROUPS,
      "GET /api/files": OWN_FILES,
      "GET /api/notes": OWN_NOTES,
      [`GET /api/groups/${G}/files`]: files([
        file(F1, "สัญญาเช่า.pdf", true),
        file(F2, "เมนูร้าน.pdf", false),
      ]),
    });
    await page.goto("/vault");
    await expect(page.getByText("บิลค่าไฟ.pdf")).toBeVisible();

    const pick = page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม");
    await pick.selectOption({ label: "กลุ่ม: บ้านเรา" });
    await expect(page).toHaveURL(new RegExp(`/vault\\?g=${G}`));
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.getByText("บิลค่าไฟ.pdf")).toHaveCount(0);
    // a group keeps no notes, and its files are kept from the group's chat
    await expect(page.getByRole("button", { name: "โน้ต", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "เพิ่มโน้ต" })).toHaveCount(0);
    await expect(page.getByText("30 MB / 2 GB")).toBeVisible();
    await expect(page.getByText(/ไฟล์ในกลุ่มของคุณ 12 MB/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // only a file this person kept can be deleted by them
    await page.getByText("เมนูร้าน.pdf").click();
    await expect(page.getByRole("button", { name: "ลบไฟล์" })).toHaveCount(0);
    await expect(page.getByText("ลบได้เฉพาะคนที่เก็บไฟล์นี้")).toBeVisible();
    await page.keyboard.press("Escape");

    await pick.selectOption({ label: "ส่วนตัว" });
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByText("บิลค่าไฟ.pdf")).toBeVisible();
  });

  test("someone who owns no group sees only the plain chip", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": { items: [] },
      "GET /api/files": OWN_FILES,
      "GET /api/notes": OWN_NOTES,
    });
    await page.goto("/vault");
    await expect(page.getByText("บิลค่าไฟ.pdf")).toBeVisible();
    await expect(page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม")).toHaveCount(0);
    await expect(page.getByText("ส่วนตัว", { exact: true })).toBeVisible();
  });

  test("a member sent from the group sees only that the owner's space is running out", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": { items: [] },
      [`GET /api/groups/${G}/files`]: files([file(F1, "สัญญาเช่า.pdf", true)], false),
    });
    await page.goto(`/vault?g=${G}`);
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.getByText("ของเจ้าของสมุดใกล้เต็มแล้ว")).toBeVisible();
    await expect(page.getByText(/ไฟล์ในกลุ่มของคุณ/)).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม")).toHaveValue(G);
    await expectNoSeriousA11yViolations(page);
  });

  test("the reminders page lists a group's reminders, and cancels one", async ({ page }) => {
    let cancelled = false;
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": GROUPS,
      [`GET /api/groups/${G}/reminders`]: () => ({
        items: cancelled ? [] : [reminder],
        isOwner: true,
      }),
      [`DELETE /api/groups/${G}/reminders/${R1}`]: () => {
        cancelled = true;
        return { ok: true };
      },
    });
    await page.goto(`/reminders?g=${G}`);
    await expect(page.getByText("ประชุมทีม")).toBeVisible();
    await expect(page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม")).toHaveValue(G);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "ยกเลิกเตือน ประชุมทีม" }).click();
    await expect(page.getByText("กลุ่มนี้ยังไม่มีเตือน")).toBeVisible();
  });

  test("the old group links lead to the switched pages", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": GROUPS,
      [`GET /api/groups/${G}/files`]: files([file(F1, "สัญญาเช่า.pdf", true)]),
      [`GET /api/groups/${G}/reminders`]: { items: [reminder], isOwner: true },
    });
    await page.goto(`/group?id=${G}`);
    await expect(page).toHaveURL(new RegExp(`/vault\\?g=${G}`));
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await page.goto(`/group?id=${G}&tab=reminders`);
    await expect(page).toHaveURL(new RegExp(`/reminders\\?g=${G}`));
    await expect(page.getByText("ประชุมทีม")).toBeVisible();
    await page.goto("/group?id=nope");
    await expect(page.getByText("ไม่พบกลุ่มนี้")).toBeVisible();
  });

  test("says so for someone who is not in the group", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": { items: [] },
      [`GET /api/groups/${G}/files`]: {
        status: 404,
        body: { error: "ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้" },
      },
    });
    await page.goto(`/vault?g=${G}`);
    await expect(page.getByText("ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้")).toBeVisible();
  });
});
