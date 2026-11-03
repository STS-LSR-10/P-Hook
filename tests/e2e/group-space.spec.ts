import { expect, test, type Route } from "@playwright/test";
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
const N1 = "00000000-0000-4000-8000-00000000000d";
const N2 = "00000000-0000-4000-8000-00000000000e";
const gnote = (id: string, body: string, mine: boolean) => ({
  id,
  body,
  createdAt: "2026-10-04T05:00:00.000Z",
  updatedAt: "2026-10-04T05:00:00.000Z",
  mine,
});
const GROUP_NOTES = (items: unknown[] = [], canAdd = true) => ({
  items,
  hasMore: false,
  canAdd,
  isOwner: false,
});
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
      [`GET /api/groups/${G}/notes`]: GROUP_NOTES([gnote(N1, "ซื้อน้ำแข็ง 2 ถุง", true)]),
    });
    await page.goto("/vault");
    await expect(page.getByText("บิลค่าไฟ.pdf")).toBeVisible();

    const pick = page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม");
    await pick.selectOption({ label: "กลุ่ม: บ้านเรา" });
    await expect(page).toHaveURL(new RegExp(`/vault\\?g=${G}`));
    await expect(page.getByText("สัญญาเช่า.pdf")).toBeVisible();
    await expect(page.getByText("ซื้อน้ำแข็ง 2 ถุง")).toBeVisible();
    await expect(page.getByText("บิลค่าไฟ.pdf")).toHaveCount(0);
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
      [`GET /api/groups/${G}/notes`]: GROUP_NOTES(),
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

  test("switching the reminders page keeps the switch, without asking for the groups again", async ({
    page,
  }) => {
    const { seen } = await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": GROUPS,
      "GET /api/reminders": {
        items: [],
        active: 0,
        limit: 3,
        repeating: 0,
        repeatLimit: 1,
        canAdd: true,
        canAddOnce: true,
        canAddRepeat: true,
      },
      [`GET /api/groups/${G}/reminders`]: { items: [reminder], isOwner: true },
    });
    await page.goto("/reminders");
    const pick = page.getByLabel("ดูของส่วนตัวหรือของกลุ่ม");
    await pick.selectOption({ label: "กลุ่ม: บ้านเรา" });
    await expect(page.getByText("ประชุมทีม")).toBeVisible();
    await pick.selectOption({ label: "ส่วนตัว" });
    await expect(page).toHaveURL(/\/reminders$/);
    await expect(pick).toHaveValue("");
    expect(seen.filter((s) => s === "GET /api/groups")).toHaveLength(1);
  });

  test("the old group links lead to the switched pages", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": GROUPS,
      [`GET /api/groups/${G}/files`]: files([file(F1, "สัญญาเช่า.pdf", true)]),
      [`GET /api/groups/${G}/notes`]: GROUP_NOTES(),
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
      [`GET /api/groups/${G}/notes`]: {
        status: 404,
        body: { error: "ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้" },
      },
    });
    await page.goto(`/vault?g=${G}`);
    await expect(page.getByText("ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้")).toBeVisible();
  });

  test("a member writes a note for the group, and only changes their own", async ({ page }) => {
    let notes = [gnote(N2, "เมนูร้านโปรด", false)];
    const posted: unknown[] = [];
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "GET /api/groups": { items: [] },
      [`GET /api/groups/${G}/files`]: files([], false),
      [`GET /api/groups/${G}/notes`]: () => GROUP_NOTES(notes),
      [`POST /api/groups/${G}/notes`]: (route: Route) => {
        const body = route.request().postDataJSON() as { body: string };
        posted.push(body);
        notes = [gnote(N1, body.body, true), ...notes];
        return { status: 201, body: { note: notes[0] } };
      },
    });
    await page.goto(`/vault?g=${G}&tab=note`);
    await expect(page.getByText("เมนูร้านโปรด")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole("button", { name: "เพิ่มโน้ตของกลุ่ม" }).click();
    await expect(page.getByText("ทุกคนในกลุ่มเห็นโน้ตนี้")).toBeVisible();
    await page.getByLabel("โน้ตใหม่").fill("ซื้อน้ำแข็ง 2 ถุง");
    await page.getByRole("button", { name: "จดโน้ต" }).click();
    await expect(page.getByText("ซื้อน้ำแข็ง 2 ถุง")).toBeVisible();
    expect(posted).toEqual([{ body: "ซื้อน้ำแข็ง 2 ถุง" }]);

    // someone else's note opens to read only
    await page.getByText("เมนูร้านโปรด").click();
    await expect(page.getByText("แก้หรือลบได้เฉพาะคนที่จดโน้ตนี้")).toBeVisible();
    await expect(page.getByRole("button", { name: "ลบโน้ต" })).toHaveCount(0);
  });
});
