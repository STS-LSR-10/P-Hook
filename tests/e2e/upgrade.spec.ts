import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  mockApi,
  ME_FREE,
  ME_PLUS,
} from "./helpers";

/**
 * A real tap at the middle of an element. Playwright's own click scrolls the page behind the sheet
 * first, and with the long comparison table there its hit check wrongly lands on the neighbouring
 * option, though a tap on the page works.
 */
async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to tap");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("upgrade page (360px)", () => {
  test("shows the four plans with their normal prices, yearly first and monthly on the toggle", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");

    const plans = page.getByRole("radiogroup", { name: "เลือกแผน" });
    await expect(plans.getByText("Free", { exact: true })).toBeVisible();
    const starter = plans.getByRole("radio", { name: /^Starter/ });
    const pro = plans.getByRole("radio", { name: /^Pro/ });
    const ultimate = plans.getByRole("radio", { name: /^Elite/ });
    await expect(starter).toContainText("฿349");
    await expect(pro).toContainText("฿699");
    await expect(ultimate).toContainText("฿1990");
    await expect(pro).not.toContainText("ราคาเปิดตัว");

    await page.getByRole("radio", { name: /รายเดือน/ }).click();
    await expect(starter).toContainText("฿49");
    await expect(pro).toContainText("฿129");
    await expect(ultimate).toContainText("฿299");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("the prices the server sends win over the phone's clock", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2027-02-01T10:00:00+07:00")); // phone says: launch is over
    await mockApi(page, {
      "GET /api/me": {
        ...ME_FREE,
        pricing: {
          launch: true,
          endsText: "31 ธ.ค. 2569",
          prices: {
            starter: { monthly: 29, yearly: 199 },
            plus: { monthly: 39, yearly: 299 },
            ultimate: { monthly: 119, yearly: 699 },
          },
          list: {
            starter: { monthly: 49, yearly: 349 },
            plus: { monthly: 59, yearly: 339 },
            ultimate: { monthly: 139, yearly: 799 },
          },
        },
      },
    });
    await page.goto("/upgrade");
    await expect(
      page.getByRole("radiogroup", { name: "เลือกแผน" }).getByRole("radio", { name: /^Pro/ }),
    ).toContainText("ราคาเปิดตัว");
  });

  test("shows short rows with a tick for the plans that have each function", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    const table = page.getByRole("table");
    const has = (name: RegExp) => table.getByRole("row", { name });

    await expect(has(/จดด้วยข้อความ/).getByText("มี", { exact: true })).toHaveCount(4);
    await expect(has(/จดย้อนหลัง/).getByText("ไม่มี", { exact: true })).toHaveCount(1); // Free only
    await expect(has(/จดย้อนหลัง/).getByText("มี", { exact: true })).toHaveCount(3);
    await expect(has(/จดด้วยเสียง/)).toContainText("30 ครั้ง/เดือน");
    await expect(has(/จดด้วยเสียง/)).toContainText("ลองฟรี 10 ครั้ง");
    await expect(page.getByText("ไม่จำกัดสำหรับการใช้งานตามปกติ")).toBeVisible();
    await expect(has(/อ่านสลิปอัตโนมัติ/)).toContainText("ลองฟรี 10 ใบ");
    await expect(has(/อ่านสลิปอัตโนมัติ/)).toContainText("60 ใบ/เดือน");
    await expect(table.getByText("เร็วๆ นี้")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("checkout sends the chosen plan and period; the stub explains it is not open", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "POST /api/plan/checkout": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { available: false, message: "ยังไม่เปิดให้ชำระเงิน" };
      },
    });
    await page.goto("/upgrade");
    await page.getByRole("radio", { name: /Elite/ }).click();
    await page.getByRole("button", { name: /ชำระเงิน · Elite/ }).click();
    const sheet = page.getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" });
    await tap(page, sheet.getByRole("button", { name: /พร้อมเพย์/ }));
    await tap(
      page,
      page
        .getByRole("dialog", { name: "สรุปก่อนชำระเงิน" })
        .getByRole("button", { name: "ไปชำระเงิน" }),
    );

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      plan: "ultimate",
      period: "yearly",
      method: "promptpay",
      upgrade: false,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "ยังไม่เปิดให้ชำระเงิน" }),
    ).toBeVisible();
  });

  test("pressing pay offers card and PromptPay, each with its price, instead of a choice on the page", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    await expect(page.getByRole("radiogroup", { name: "ช่องทางชำระเงิน" })).toHaveCount(0);
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    const sheet = page.getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" });
    await expect(sheet.getByRole("button", { name: /บัตรเครดิต/ })).toContainText(
      "ต่ออายุอัตโนมัติ",
    );
    await expect(sheet.getByRole("button", { name: /พร้อมเพย์/ })).toContainText(
      "ไม่ต่ออายุอัตโนมัติ",
    );
    await expect(sheet.getByRole("button", { name: /บัตรเครดิต/ })).toContainText("฿");
    await expect(page.getByRole("button", { name: /จัดการการชำระเงิน/ })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("the summary says what is charged today and until when, and can go back to the choice", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    await tap(
      page,
      page
        .getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" })
        .getByRole("button", { name: /พร้อมเพย์/ }),
    );
    const summary = page.getByRole("dialog", { name: "สรุปก่อนชำระเงิน" });
    await expect(summary.getByText("ยอดที่ชำระวันนี้")).toBeVisible();
    await expect(summary.getByText("ใช้งานได้ถึง")).toBeVisible();
    await expect(summary.getByText("ตัดบัตรครั้งถัดไป")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await summary.getByRole("button", { name: "เปลี่ยนช่องทาง" }).click();
    await tap(
      page,
      page
        .getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" })
        .getByRole("button", { name: /บัตรเครดิต/ }),
    );
    await expect(page.getByText("ตัดบัตรครั้งถัดไป (โดยประมาณ)")).toBeVisible();
    await expect(page.getByText("ใช้งานได้ถึง")).toHaveCount(0);
  });

  test("an Early Bird seat shows in today's price, with the normal price beside it", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/me": {
        ...ME_FREE,
        earlyBird: [{ plan: "plus", period: "yearly", remaining: 10, price: 499 }],
      },
    });
    await page.goto("/upgrade");
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    const sheet = page.getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" });
    await expect(sheet.getByRole("button", { name: /บัตรเครดิต/ })).toContainText("฿499");
    await expect(sheet.getByRole("button", { name: /พร้อมเพย์/ })).toContainText("฿499");
  });

  test("when the last Early Bird seat goes, the page says so instead of opening a normal-price payment", async ({
    page,
  }) => {
    let seatGone = false;
    await mockApi(page, {
      "GET /api/me": () => ({
        ...ME_FREE,
        earlyBird: seatGone ? [] : [{ plan: "plus", period: "yearly", remaining: 1, price: 499 }],
      }),
      "POST /api/plan/checkout": () => {
        seatGone = true; // someone else took it first
        return { available: true, url: "https://pay.example.test/session", earlyBird: false };
      },
    });
    await page.goto("/upgrade");
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    await tap(
      page,
      page
        .getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" })
        .getByRole("button", { name: /บัตรเครดิต/ }),
    );
    await expect(page.getByRole("dialog", { name: "สรุปก่อนชำระเงิน" })).toContainText("฿499");
    let opened = 0;
    page.on("popup", () => opened++);
    await tap(
      page,
      page
        .getByRole("dialog", { name: "สรุปก่อนชำระเงิน" })
        .getByRole("button", { name: "ไปชำระเงิน" }),
    );
    await expect(
      page.getByRole("status").filter({ hasText: "ที่นั่ง Early Bird หมดไปแล้ว" }),
    ).toBeVisible();
    expect(opened).toBe(0);
    // the page now shows the normal price, and paying again opens the payment
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    await expect(page.getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" })).not.toContainText(
      "ปกติ",
    );
  });

  test("with an Early Bird seat secured, the payment page opens", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": {
        ...ME_FREE,
        earlyBird: [{ plan: "plus", period: "yearly", remaining: 5, price: 499 }],
      },
      "POST /api/plan/checkout": () => ({
        available: true,
        url: "about:blank#early",
        earlyBird: true,
      }),
    });
    await page.goto("/upgrade");
    await page.getByRole("button", { name: /ชำระเงิน · Pro/ }).click();
    await tap(
      page,
      page
        .getByRole("dialog", { name: "เลือกช่องทางชำระเงิน" })
        .getByRole("button", { name: /บัตรเครดิต/ }),
    );
    const popup = page.waitForEvent("popup");
    await tap(
      page,
      page
        .getByRole("dialog", { name: "สรุปก่อนชำระเงิน" })
        .getByRole("button", { name: "ไปชำระเงิน" }),
    );
    expect((await popup).url()).toContain("about:blank");
  });

  test("someone already paying one way goes straight to the summary, with no choice", async ({
    page,
  }) => {
    await mockApi(page, {
      "GET /api/me": {
        ...ME_PLUS,
        payments: { available: true, history: [], canManage: false, prepaidRunning: true },
      },
    });
    await page.goto("/upgrade");
    await page.getByRole("button", { name: /ต่ออายุ · Pro/ }).click();
    const summary = page.getByRole("dialog", { name: "สรุปก่อนชำระเงิน" });
    await expect(summary.getByText("ใช้งานได้ถึง")).toBeVisible();
    await expect(summary.getByRole("button", { name: "เปลี่ยนช่องทาง" })).toHaveCount(0);
  });

  test("a card subscriber can upgrade the tier or switch to yearly (difference only)", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    const me = {
      ...ME_PLUS,
      payments: {
        available: true,
        history: [],
        canManage: true,
        autoRenew: true,
        period: "monthly",
      },
    };
    await mockApi(page, {
      "GET /api/me": me,
      "POST /api/plan/change": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { available: true, changed: true };
      },
    });
    await page.goto("/upgrade");

    // a subscriber can only change the running subscription, so the payment method is not asked
    await expect(page.getByRole("radiogroup", { name: "ช่องทางชำระเงิน" })).toHaveCount(0);

    // default view: Pro + yearly = switch the monthly subscription to yearly
    const change = page.getByRole("button", { name: /อัปเกรดแผน · Pro \(รายปี\)/ });
    await expect(change).toBeEnabled();
    await expect(page.getByText(/จ่ายเฉพาะส่วนต่าง/)).toBeVisible();

    // upgrade the tier instead, still monthly
    await page.getByRole("radio", { name: /^Elite/ }).click();
    await page.getByRole("radio", { name: /รายเดือน/ }).click();
    const toElite = page.getByRole("button", { name: /อัปเกรดแผน · Elite \(รายเดือน\)/ });
    await expect(toElite).toBeEnabled();
    await toElite.click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ plan: "ultimate", period: "monthly" });
    await expect(page.getByRole("status").filter({ hasText: "เปลี่ยนแผนเรียบร้อย" })).toBeVisible();
  });

  test("a card subscriber cannot repeat the same plan, and can open the billing portal", async ({
    page,
  }) => {
    const me = {
      ...ME_PLUS,
      payments: {
        available: true,
        history: [],
        canManage: true,
        autoRenew: true,
        period: "monthly",
      },
    };
    const { seen } = await mockApi(page, {
      "GET /api/me": me,
      "POST /api/plan/portal": { available: false, message: "ยังไม่เปิด" },
    });
    await page.goto("/upgrade");
    await page.getByRole("radio", { name: /รายเดือน/ }).click(); // Pro + monthly = what they have
    await expect(page.getByText(/คุณใช้แผนนี้อยู่แล้ว/)).toBeVisible();
    await expect(page.getByRole("button", { name: /(ชำระเงิน|ต่ออายุ) · Pro/ })).toBeDisabled();

    await page.getByRole("button", { name: /จัดการการชำระเงิน/ }).click();
    await expect.poll(() => seen.some((s) => s.startsWith("POST /api/plan/portal"))).toBe(true);
  });

  test("a yearly subscriber cannot go back to monthly mid-term", async ({ page }) => {
    const me = {
      ...ME_PLUS,
      payments: {
        available: true,
        history: [],
        canManage: true,
        autoRenew: true,
        period: "yearly",
      },
    };
    await mockApi(page, { "GET /api/me": me });
    await page.goto("/upgrade");
    await page.getByRole("radio", { name: /รายเดือน/ }).click();
    await expect(page.getByText(/เปลี่ยนจากรายปีเป็นรายเดือนไม่ได้/)).toBeVisible();
  });
  test("prepaid (PromptPay) time continues with PromptPay: no method choice, top-up and upgrade work", async ({
    page,
  }) => {
    const me = {
      ...ME_PLUS,
      payments: { available: true, history: [], canManage: false, prepaidRunning: true },
    };
    await mockApi(page, { "GET /api/me": me });
    await page.goto("/upgrade");

    // mixing with a card is refused by the server, so the page does not offer it at all
    await expect(page.getByRole("radiogroup", { name: "ช่องทางชำระเงิน" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ต่ออายุ · Pro/ })).toBeEnabled();
    await page.getByRole("radio", { name: /^Elite/ }).click();
    await expect(page.getByRole("button", { name: /ชำระเงิน · Elite/ })).toBeEnabled();
  });
  test("an Elite user cannot buy the cheaper plan", async ({ page }) => {
    await mockApi(page, { "GET /api/me": { ...ME_PLUS, plan: "ultimate" } });
    await page.goto("/upgrade");
    await expect(page.getByText("คุณใช้แผนที่สูงกว่านี้อยู่แล้ว")).toBeVisible();
    await expect(page.getByRole("button", { name: /ต่ออายุ · Pro|ชำระเงิน · Pro/ })).toBeDisabled();
  });
  test("a new user can start a 7-day free trial", async ({ page }) => {
    const bodies: unknown[] = [];
    await mockApi(page, {
      "GET /api/me": ME_FREE,
      "POST /api/plan/trial": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { ok: true, days: 7 };
      },
    });
    await page.goto("/upgrade");
    await expect(page.getByRole("button", { name: "ทดลองใช้ Pro ฟรี 7 วัน" })).toBeVisible();
    await expect(page.getByText(/ไม่ต้องใช้บัตร/)).toBeVisible();

    await page.getByRole("radio", { name: /^Elite/ }).click();
    await page.getByRole("button", { name: "ทดลองใช้ Elite ฟรี 7 วัน" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ plan: "ultimate" });
    await expect(
      page.getByRole("status").filter({ hasText: "เริ่มทดลองใช้ Elite ฟรี 7 วันแล้ว" }),
    ).toBeVisible();
  });

  test("no trial button once the tier was tried or a plan is running", async ({ page }) => {
    await mockApi(page, {
      "GET /api/me": { ...ME_FREE, trial: { days: 7, available: { plus: false, ultimate: true } } },
    });
    await page.goto("/upgrade");
    await expect(page.getByRole("button", { name: /ทดลองใช้ Pro/ })).toHaveCount(0);
    await page.getByRole("radio", { name: /^Elite/ }).click();
    await expect(page.getByRole("button", { name: /ทดลองใช้ Elite/ })).toBeVisible();

    const plus = await page.context().newPage();
    await mockApi(plus, { "GET /api/me": ME_PLUS });
    await plus.goto("/upgrade");
    await expect(plus.getByRole("button", { name: /ทดลองใช้/ })).toHaveCount(0);
  });

  test("prepaid time can be upgraded by paying only the difference", async ({ page }) => {
    const bodies: unknown[] = [];
    const in15Days = new Date(Date.now() + 15 * 86_400_000 - 3_600_000).toISOString();
    const me = {
      ...ME_PLUS,
      planExpiresAt: in15Days,
      payments: {
        available: true,
        history: [],
        canManage: true,
        prepaidRunning: true,
        prepaidMonths: 1,
      },
    };
    await mockApi(page, {
      "GET /api/me": me,
      "POST /api/plan/checkout": (route: Route) => {
        bodies.push(route.request().postDataJSON());
        return { available: false, message: "ยังไม่เปิด" };
      },
    });
    await page.goto("/upgrade");

    // same tier: only the normal top-up, no difference offer
    await expect(page.getByRole("button", { name: /อัปเกรดส่วนที่เหลือ/ })).toHaveCount(0);

    await page.getByRole("radio", { name: /^Elite/ }).click();
    // (299 - 129) / 30 * 15 days = ฿85
    const diff = page.getByRole("button", { name: "อัปเกรดส่วนที่เหลือ · จ่ายส่วนต่าง ฿85" });
    await expect(diff).toBeVisible();
    await expect(page.getByText(/อีก 15 วัน/)).toBeVisible();
    await expect(page.getByRole("button", { name: /ชำระเงิน · Elite/ })).toBeEnabled(); // full new period

    await diff.click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ plan: "ultimate", method: "promptpay", upgrade: true });
  });
  test("only the chosen plan card is green (frame and fill) and it follows the choice", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    const pro = page.getByRole("radio", { name: /^Pro/ });
    const ultimate = page.getByRole("radio", { name: /^Elite/ });
    const isGreen = (c: string | null) =>
      /border-primary/.test(c ?? "") && /bg-primary-soft/.test(c ?? "");

    expect(isGreen(await pro.getAttribute("class"))).toBe(true);
    expect(isGreen(await ultimate.getAttribute("class"))).toBe(false);

    await ultimate.click();
    expect(isGreen(await ultimate.getAttribute("class"))).toBe(true);
    expect(isGreen(await pro.getAttribute("class"))).toBe(false);
  });
  test("scrolling the comparison sideways keeps its title, group names and feature column in place", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    const box = page.getByRole("region", { name: "เปรียบเทียบแผน" });
    await box.scrollIntoViewIfNeeded();
    const scroller = box.getByRole("group");
    const range = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(range).toBeGreaterThan(20); // there is something to scroll
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth));

    const left = (await scroller.boundingBox())!.x;
    // the title, the first group name and the first feature name still start at the left edge
    for (const el of [
      page.getByText("ทำอะไรได้บ้าง?"),
      box.locator("tbody tr").first().locator("th span"),
      box.getByRole("rowheader").first(),
    ]) {
      expect((await el.boundingBox())!.x).toBeGreaterThanOrEqual(left - 1);
    }
    // and the feature column is narrow, so no plan column hides under it while scrolled
    const feature = (await box.getByRole("rowheader").first().boundingBox())!;
    expect(feature.x + feature.width - left).toBeLessThan(150);
  });

  test("tapping a plan name tints that plan's whole column; the chosen plan card sets it too", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    const table = page.getByRole("table");
    const head = (name: string) => table.getByRole("button", { name: `ไฮไลต์แผน ${name}` });
    // the cells of one plan's column in every row: column 1 = Free ... column 4 = Elite
    const tinted = (n: number) =>
      table.locator(`tbody td:nth-child(${n + 1}).bg-primary-soft`).count();
    const rows = await table.locator("tbody td:nth-child(2)").count();

    // it starts on the chosen plan (Pro)
    await expect(head("Pro")).toHaveAttribute("aria-pressed", "true");
    expect(await tinted(3)).toBe(rows);
    expect(await tinted(1)).toBe(0);

    await head("Starter").click();
    await expect(head("Starter")).toHaveAttribute("aria-pressed", "true");
    await expect(head("Pro")).toHaveAttribute("aria-pressed", "false");
    expect(await tinted(2)).toBe(rows);
    expect(await tinted(3)).toBe(0);

    await head("Starter").click(); // tap again to clear
    await expect(head("Starter")).toHaveAttribute("aria-pressed", "false");
    expect(await tinted(2)).toBe(0);

    await page.getByRole("radio", { name: /^Elite/ }).click(); // picking a plan card marks it
    await expect(head("Elite")).toHaveAttribute("aria-pressed", "true");
    expect(await tinted(4)).toBe(rows);
  });

  test("a plan name that scrolls under the feature column is hidden with its column", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    const box = page.getByRole("region", { name: "เปรียบเทียบแผน" });
    await box.scrollIntoViewIfNeeded();
    await box.getByRole("group").evaluate((el) => (el.scrollLeft = el.scrollWidth));
    const free = page.getByRole("button", { name: "ไฮไลต์แผน Free" });
    // what is on top at the centre of "Free" is the blank sticky header cell, not the name
    const covered = await free.evaluate((el) => {
      // bring the header row into the viewport first (the point must be on screen to be hit-tested)
      window.scrollBy(0, el.getBoundingClientRect().y - 150);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top !== null && !el.contains(top) && top.closest("th") !== el.closest("th");
    });
    expect(covered).toBe(true);
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await mockApi(page, { "GET /api/me": ME_FREE });
    await page.goto("/upgrade");
    await expect(page.getByRole("table")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
