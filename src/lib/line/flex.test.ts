import { describe, expect, it } from "vitest";
import {
  backdatePrefix,
  BACKDATE_MAX_DAYS,
  buildBackdatePrompt,
  buildCategoryKeyboardList,
  buildDatePicker,
  buildRangeEndPicker,
  buildRangeStartPicker,
  withSummaryShortcuts,
  buildComposeCard,
  buildConfirmMessage,
  buildTypeQuestion,
} from "./flex";
import { buildCategoryChooser } from "./slip-flex";
import { buildSearchCard } from "./search-flex";

const base = {
  txId: "11111111-1111-1111-1111-111111111111",
  type: "expense" as const,
  title: "กาแฟ",
  categoryName: "อาหาร",
  amountSatang: 3000,
  occurredAt: new Date("2026-10-15T08:00:00Z"),
  cycleTotalSatang: 125_000,
};

describe("flex", () => {
  it("builds a full card with brand colors and three actions", () => {
    const msg = buildConfirmMessage({ ...base, style: "full" });
    expect(msg.type).toBe("flex");
    const json = JSON.stringify(msg);
    expect(json).toContain("#CCFBF1"); // primary-soft header
    expect(json).toContain("จดสำเร็จ");
    expect(json).toContain("อย่าลืมตรวจสอบรายการที่จดด้วยนะ");
    expect(json).toContain("a=del&id=" + base.txId);
    expect(json).toContain("a=edit&id=" + base.txId);
    expect(json).toContain("line.me/R/share");
    expect(json).toContain("฿30");
    expect(json).toContain("฿1,250");
    expect(msg.altText).toBeTypeOf("string");
  });

  it("the 'แก้' chip opens the editor page when a link is known, and says so on an edited card", () => {
    const url = "https://liff.line.me/1234-abcd/transactions?edit=" + base.txId;
    const json = JSON.stringify(buildConfirmMessage({ ...base, style: "full", editUrl: url }));
    expect(json).toContain(url);
    expect(json).not.toContain("a=edit&id=");
    expect(json).toContain("จดสำเร็จ");
    const done = JSON.stringify(
      buildConfirmMessage({ ...base, style: "full", editUrl: url, edited: true }),
    );
    expect(done).toContain("แก้ไขรายการสำเร็จ");
    expect(done).not.toContain("จดสำเร็จ");
    const short = JSON.stringify(buildConfirmMessage({ ...base, style: "short", edited: true }));
    expect(short).toContain("แก้ไขรายการสำเร็จ: ");
  });

  it("income card is green with a plus sign and its own message", () => {
    const json = JSON.stringify(
      buildConfirmMessage({
        ...base,
        style: "full",
        type: "income",
        title: "เงินเดือนเข้า",
        categoryName: "เงินเดือน",
        amountSatang: 3_500_000,
        cycleTotalSatang: 3_500_000,
        cycleLabel: "รายเดือน (วันที่ 1)",
      }),
    );
    expect(json).toContain("รายรับ");
    expect(json).toContain("+฿35,000");
    expect(json).toContain("เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ");
    expect(json).toContain("รอบงบ: รายเดือน (วันที่ 1)");
    expect(json).toContain('"width":"100%"'); // the only entry fills the bar
  });

  it("adds the logo only when a URL is given", () => {
    const withLogo = JSON.stringify(
      buildConfirmMessage({ ...base, style: "full", logoUrl: "https://example.com/logo.png" }),
    );
    expect(withLogo).toContain("https://example.com/logo.png");
    expect(JSON.stringify(buildConfirmMessage({ ...base, style: "full" }))).not.toContain(
      '"type":"image"',
    );
  });

  it("shows #tags on the full and short cards, and nothing when there are none", () => {
    const tagged = { ...base, tags: ["ปาร์ตี้", "trip"] };
    expect(JSON.stringify(buildConfirmMessage({ ...tagged, style: "full" }))).toContain(
      "#ปาร์ตี้ #trip",
    );
    expect(buildConfirmMessage({ ...tagged, style: "short" })).toMatchObject({
      type: "text",
      text: "จดแล้ว: กาแฟ ฿30 · อาหาร #ปาร์ตี้ #trip",
    });
    expect(JSON.stringify(buildConfirmMessage({ ...base, style: "full" }))).not.toContain(
      '"text":"#',
    );
  });

  it("omits the cycle total when unknown", () => {
    const json = JSON.stringify(
      buildConfirmMessage({ ...base, style: "full", cycleTotalSatang: null }),
    );
    expect(json).not.toContain("รอบนี้รวม");
  });

  it("short style is a plain text message", () => {
    const msg = buildConfirmMessage({ ...base, style: "short" });
    expect(msg).toMatchObject({ type: "text", text: "จดแล้ว: กาแฟ ฿30 · อาหาร" });
  });

  it("category chooser respects LINE's limits", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      name: "หมวดที่มีชื่อยาวมากเกินกว่ายี่สิบตัวอักษรแน่นอน",
    }));
    const msg = buildCategoryChooser(base.txId, many);
    const items = (msg.quickReply as { items: { action: { label: string; data: string } }[] })
      .items;
    expect(items).toHaveLength(13);
    for (const i of items) {
      expect(i.action.label.length).toBeLessThanOrEqual(20);
      expect(i.action.data.length).toBeLessThan(300);
    }
  });

  it("type question has three quick replies with postback data under the 300 char limit", () => {
    const msg = buildTypeQuestion({ txId: base.txId, title: "ของขวัญ", amountSatang: 50_000 });
    const items = (msg.quickReply as { items: { action: { data: string; label: string } }[] })
      .items;
    expect(items.map((i) => i.action.label)).toEqual(["รายจ่าย", "รายรับ", "ยกเลิก"]);
    for (const i of items) expect(i.action.data.length).toBeLessThan(300);
  });
});

describe("compose card", () => {
  it("shows the two examples and a button that opens the keyboard without prefilled text", () => {
    const msg = buildComposeCard();
    const json = JSON.stringify(msg);
    expect(msg.type).toBe("flex");
    expect(json).toContain("กระเพราหมูกรอบ 65");
    expect(json).toContain("เงินเดือน 25000");
    expect(json).toContain("ระบบจะช่วยจดและแยกหมวดหมู่อัตโนมัติทันทีครับ");
    expect(json).toContain('"inputOption":"openKeyboard"');
    expect(json).not.toContain("fillInText");
    expect(msg.altText).toBeTypeOf("string");
  });
});

describe("the cards no longer carry a แนบรูป button (the bot offers the photo itself)", () => {
  it("not on the full card", () => {
    expect(JSON.stringify(buildConfirmMessage({ ...base, style: "full" }))).not.toContain("a=ph");
  });

  it("not under the short card, which has no quick reply at all without a wallet to move to", () => {
    const msg = buildConfirmMessage({ ...base, style: "short" }) as unknown as {
      quickReply?: unknown;
    };
    expect(msg.quickReply).toBeUndefined();
    const withMove = buildConfirmMessage({ ...base, style: "short", canMoveWallet: true });
    expect(JSON.stringify(withMove)).not.toContain("a=ph");
    expect(JSON.stringify(withMove)).toContain("quickReply");
  });
});

describe("compose quick replies", () => {
  type Item = {
    action: { label: string; data: string; fillInText?: string; inputOption?: string };
  };
  const items = (m: Record<string, unknown>) => (m.quickReply as { items: Item[] }).items;
  const cat = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    type: "expense" as const,
    sort_order: 0,
    is_hidden: false,
    ...over,
  });

  it("the compose card offers expense and income category lists, then backdating", () => {
    const card = buildComposeCard();
    expect(items(card).map((i) => i.action.data)).toEqual([
      "a=cp&t=expense",
      "a=cp&t=income",
      "a=bd",
    ]);
  });

  it("each category button opens the keyboard with its name already typed", () => {
    const m = buildCategoryKeyboardList("expense", [
      cat("อาหาร"),
      cat("เดินทาง", { sort_order: 1 }),
    ]);
    expect(items(m).map((i) => i.action.fillInText)).toEqual(["อาหาร ", "เดินทาง "]);
    expect(items(m).every((i) => i.action.inputOption === "openKeyboard")).toBe(true);
  });

  it("lists only the chosen type, skips hidden and the shared อื่นๆ, and follows sort order", () => {
    const m = buildCategoryKeyboardList("income", [
      cat("ขายของ", { type: "income", sort_order: 5 }),
      cat("เงินเดือน", { type: "income", sort_order: 1 }),
      cat("งานพิเศษ", { type: "income", sort_order: 3, is_hidden: true }),
      cat("อื่นๆ", { type: "income", sort_order: 99 }),
      cat("อาหาร"),
    ]);
    expect(items(m).map((i) => i.action.label)).toEqual(["เงินเดือน", "ขายของ"]);
  });

  it("never offers more than 13 buttons (LINE limit) and cuts long labels to 20", () => {
    const many = Array.from({ length: 20 }, (_, i) => cat(`หมวด${i}`, { sort_order: i }));
    expect(items(buildCategoryKeyboardList("expense", many))).toHaveLength(13);
    const long = buildCategoryKeyboardList("expense", [cat("ก".repeat(40))]);
    expect(items(long)[0]?.action.label).toHaveLength(20);
  });

  it("falls back to a plain message when there is nothing to pick", () => {
    const m = buildCategoryKeyboardList("expense", []);
    expect(m.type).toBe("text");
    expect(m.quickReply).toBeUndefined();
  });
});

describe("backdating with the date picker", () => {
  type PickerItem = {
    action: {
      type: string;
      data: string;
      mode?: string;
      initial?: string;
      max?: string;
      min?: string;
      fillInText?: string;
      inputOption?: string;
    };
  };
  const items = (m: Record<string, unknown>) => (m.quickReply as { items: PickerItem[] }).items;
  const NOW = new Date("2026-10-17T08:00:00Z"); // 15:00 on 17 Oct in Bangkok

  it("the calendar is a date-only picker up to today, a year back, starting on yesterday", () => {
    const a = items(buildDatePicker(NOW))[0]!.action;
    expect(a).toMatchObject({
      type: "datetimepicker",
      data: "a=bdp",
      mode: "date",
      initial: "2026-10-16",
      max: "2026-10-17",
    });
    const days = (Date.parse(a.max!) - Date.parse(a.min!)) / 86_400_000;
    expect(days).toBe(BACKDATE_MAX_DAYS);
  });

  it("near midnight in Bangkok the dates follow Bangkok, not UTC", () => {
    // 2026-10-17 18:30 UTC is already 18 Oct 01:30 in Bangkok
    const a = items(buildDatePicker(new Date("2026-10-17T18:30:00Z")))[0]!.action;
    expect(a.max).toBe("2026-10-18");
    expect(a.initial).toBe("2026-10-17");
  });

  it("the prompt opens the keyboard with the chosen day already typed", () => {
    const a = items(buildBackdatePrompt("2026-10-12", "12 ต.ค. 2569"))[0]!.action;
    expect(a.inputOption).toBe("openKeyboard");
    expect(a.fillInText).toBe("12/10/2026 ");
  });

  it("backdatePrefix writes DD/MM/YYYY with a trailing space", () => {
    expect(backdatePrefix("2026-01-05")).toBe("05/01/2026 ");
  });
});

describe("custom range pickers", () => {
  type A = { action: Record<string, string> };
  const first = (m: Record<string, unknown>) => (m.quickReply as { items: A[] }).items[0]!.action;
  const NOW = new Date("2026-10-17T08:00:00Z");

  it("the shortcuts keep the card and add the range, category and latest buttons", () => {
    const card = { type: "flex", altText: "x", contents: { type: "bubble" } };
    const out = withSummaryShortcuts(card);
    expect(out.contents).toEqual(card.contents);
    const items = (out.quickReply as { items: A[] }).items.map((i) => i.action);
    expect(items[0]).toMatchObject({ type: "postback", data: "a=sr" });
    expect(items[1]).toMatchObject({ type: "message", text: "สรุปหมวด" });
    expect(items[2]).toMatchObject({ type: "message", text: "ล่าสุด" });
    expect(items[3]).toMatchObject({ type: "message", text: "เทียบเดือน" });
    expect(items[4]).toMatchObject({ type: "message", text: "สรุปปี" });
    expect(items[5]).toMatchObject({ type: "message", text: "พยากรณ์" });
    expect(items[6]).toMatchObject({ type: "message", text: "วิเคราะห์" });
    expect(items).toHaveLength(7);
    expect(items.every((a) => (a.label ?? "").length <= 20)).toBe(true);
  });

  it("the first-day picker reaches back about three years and stops at today", () => {
    const a = first(buildRangeStartPicker(NOW));
    expect(a).toMatchObject({
      type: "datetimepicker",
      data: "a=sr1",
      mode: "date",
      max: "2026-10-17",
    });
    expect(a.min! < a.initial!).toBe(true);
    expect(a.initial! <= a.max!).toBe(true);
  });

  it("the last-day picker starts at the first day, keeps it in data, and stops at today", () => {
    const a = first(buildRangeEndPicker("2026-10-01", "1 ต.ค. 2569", NOW));
    expect(a).toMatchObject({
      data: "a=sr2&f=2026-10-01",
      min: "2026-10-01",
      max: "2026-10-17",
      initial: "2026-10-17",
    });
  });
});

describe("search result card", () => {
  const item = (title: string, amountSatang: number, type: "expense" | "income" = "expense") => ({
    id: title,
    type,
    title,
    amountSatang,
    occurredAt: "2026-10-10T05:00:00Z",
    source: "text",
    categoryId: null,
    categoryName: null,
    categoryIcon: null,
    categoryColor: null,
    hasPhoto: false,
    hasSlip: false,
    note: null,
    tags: [],
    accountId: null,
    origCurrency: null,
    origAmountMinor: null,
    fxRate: null,
    accountName: null,
  });
  const totals = { incomeSatang: 10_000, expenseSatang: 10_550, count: 3 };

  it("shows the term, the totals, the newest matches and the link", () => {
    const json = JSON.stringify(
      buildSearchCard({
        term: "กาแฟ",
        totals,
        items: [item("กาแฟเย็น", 6000), item("ขายกาแฟ", 10_000, "income")],
        moreUrl: "https://liff.line.me/123/transactions?q=%E0%B8%81",
      }),
    );
    expect(json).toContain("ผลการค้นหา");
    expect(json).toContain("กาแฟ");
    expect(json).toContain("+฿100");
    expect(json).toContain("-฿105.50");
    expect(json).toContain("พบ 3 รายการ");
    expect(json).toContain("10 ต.ค. กาแฟเย็น");
    expect(json).toContain("และอีก 1 รายการ");
    expect(json).toContain("ดูทั้งหมดในแอป");
  });

  it("has no button without an https link, and shows at most five matches", () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`รายการ${i}`, 100));
    const json = JSON.stringify(
      buildSearchCard({
        term: "x",
        totals: { incomeSatang: 0, expenseSatang: 900, count: 9 },
        items: many,
        moreUrl: "http://localhost/x",
      }),
    );
    expect(json).not.toContain("ดูทั้งหมดในแอป");
    expect(json).toContain("รายการ4");
    expect(json).not.toContain("รายการ5");
    expect(json).toContain("และอีก 4 รายการ");
  });
});

describe("emoji in front of a category's name", () => {
  type Btn = { action: { label: string; fillInText?: string; data?: string } };
  const labels = (m: Record<string, unknown>) =>
    (m.quickReply as { items: Btn[] }).items.map((i) => i.action);

  it("the category buttons of พี่ฮูก show it, but the text put in the box is the plain name", () => {
    const m = buildCategoryKeyboardList("expense", [
      { name: "ค่าอาหารแมว", icon: "🐱", type: "expense", sort_order: 1, is_hidden: false },
      { name: "อาหาร", icon: "utensils", type: "expense", sort_order: 2, is_hidden: false },
    ]);
    expect(labels(m).map((a) => a.label)).toEqual(["🐱 ค่าอาหารแมว", "อาหาร"]);
    expect(labels(m).map((a) => a.fillInText)).toEqual(["ค่าอาหารแมว ", "อาหาร "]);
  });

  it("a long name with an emoji still fits the 20-character label", () => {
    const m = buildCategoryKeyboardList("expense", [
      { name: "ก".repeat(30), icon: "🐱", type: "expense", sort_order: 1, is_hidden: false },
    ]);
    expect(labels(m)[0]!.label).toHaveLength(20);
  });

  it("the category list of a checked slip shows it", () => {
    const m = buildCategoryChooser("t1", [
      { id: "c1", name: "ค่าอาหารแมว", icon: "🐱" },
      { id: "c2", name: "อาหาร", icon: "utensils" },
    ]);
    expect(labels(m).map((a) => a.label)).toEqual(["🐱 ค่าอาหารแมว", "อาหาร"]);
    expect(labels(m)[0]!.data).toBe("a=sk&id=t1&c=c1");
  });

  it("the entry-saved card carries the label it is given", () => {
    const json = JSON.stringify(
      buildConfirmMessage({ ...base, style: "full", categoryName: "🐱 ค่าอาหารแมว" }),
    );
    expect(json).toContain("🐱 ค่าอาหารแมว");
  });
});

describe("the budget block, the warnings and the payment row on the entry card", () => {
  const card = (over: Record<string, unknown> = {}) =>
    JSON.stringify(
      buildConfirmMessage({
        ...base,
        style: "full",
        cycleTotalSatang: 1_000,
        cycleLabel: "รายเดือน (วันที่ 1)",
        ...over,
      } as Parameters<typeof buildConfirmMessage>[0]),
    );

  it("shows spent / budget with the cycle, replacing the category total", () => {
    const json = card({
      budget: { scopeName: "อาหาร", spentSatang: 1_557_400, limitSatang: 1_500_000, level: "over" },
    });
    expect(json).toContain("งบหมวดอาหาร");
    expect(json).toContain("฿15,574");
    expect(json).toContain(" / ฿15,000");
    expect(json).toContain("เกินงบ ฿574"); // how much over
    expect(json).toContain("รอบงบ: รายเดือน (วันที่ 1)");
    expect(json).toContain("เกินงบ"); // badge
  });

  it("the overall budget is called งบรวม, and the bar and the words follow the level", () => {
    const ok = card({
      budget: { scopeName: null, spentSatang: 40_000, limitSatang: 100_000, level: "ok" },
    });
    expect(ok).toContain("งบรวม");
    expect(ok).toContain("เหลือ ฿600");
    expect(ok).not.toContain("ใกล้เต็มงบ");
    const warn = card({
      budget: { scopeName: null, spentSatang: 85_000, limitSatang: 100_000, level: "warn" },
    });
    expect(warn).toContain("ใกล้เต็มงบ");
    expect(warn).toContain("#F59E0B");
  });

  it("keeps the category total when there is no budget", () => {
    const json = card();
    expect(json).toContain("฿10"); // cycle total 1,000 satang
    expect(json).not.toContain("งบรวม");
  });

  it("carries the warnings on the card", () => {
    const json = card({
      notices: [
        { text: "เกินงบหมวดอาหารแล้ว", level: "over" },
        { text: "วันนี้เกินงบวันนี้ ฿120", level: "warn" },
      ],
    });
    expect(json).toContain("🚨 เกินงบหมวดอาหารแล้ว");
    expect(json).toContain("⚠️ วันนี้เกินงบวันนี้ ฿120");
  });

  const wallets = [
    { id: "w1", label: "💵 เงินสด", selected: true },
    { id: "w2", label: "💳 บัตร KTC", selected: false },
  ];

  it("offers the wallets as a row: the chosen one marked, the others move the entry", () => {
    const json = card({ walletChoices: wallets, canMoveWallet: true });
    expect(json).toContain("จ่ายด้วย");
    expect(json).toContain("✓ 💵 เงินสด");
    expect(json).toContain(`"data":"a=wm&id=${base.txId}&w=w2"`);
    expect(json).not.toContain("a=wm&id=" + base.txId + "&w=w1"); // the chosen one is not a button
    expect(json).not.toContain("ย้ายกระเป๋า"); // the old link button is gone
    expect(json).not.toContain("a=wl"); // nothing more to list
  });

  it("adds อื่น ๆ when there are more wallets than the row shows, and cuts long names", () => {
    const json = card({
      walletChoices: [
        { id: "w1", label: "💳 บัตรเครดิตธนาคารกรุงเทพ", selected: true },
        wallets[1],
      ],
      moreWallets: true,
      canMoveWallet: true,
    });
    expect(json).toContain("อื่น ๆ");
    expect(json).toContain(`"data":"a=wl&id=${base.txId}"`);
    expect(json).not.toContain("บัตรเครดิตธนาคารกรุงเทพ");
    expect(json).toContain("…");
  });

  it("has no row with a single wallet (it falls back to the old button when it can move)", () => {
    expect(card()).not.toContain("จ่ายด้วย");
    expect(card({ canMoveWallet: true })).toContain("ย้ายกระเป๋า");
  });
});

describe("the card title", () => {
  const title = (over: Record<string, unknown> = {}) =>
    JSON.stringify(
      buildConfirmMessage({ ...base, style: "full", ...over } as Parameters<
        typeof buildConfirmMessage
      >[0]),
    );

  it("has the tick right after the words, in the same text", () => {
    expect(title()).toContain('"text":"จดสำเร็จ ✅"');
    expect(title({ edited: true })).toContain('"text":"แก้ไขรายการสำเร็จ ✅"');
  });

  it("has no separate tick badge to run into the mascot", () => {
    expect(title({ logoUrl: "https://x.test/a.png" })).not.toContain('"text":"✓"');
  });
});

describe("the look of the saved-entry card", () => {
  const full = (over: Record<string, unknown> = {}) =>
    buildConfirmMessage({
      ...base,
      style: "full",
      logoUrl: "https://x.test/logo.png",
      ...over,
    } as Parameters<typeof buildConfirmMessage>[0]);
  const json = (over: Record<string, unknown> = {}) => JSON.stringify(full(over));

  it("has a compact green header with the tick after the title, on a white body", () => {
    const card = full() as unknown as { contents: { header: unknown; body: { backgroundColor: string } } };
    const header = JSON.stringify(card.contents.header);
    expect(header).toContain('"text":"จดสำเร็จ ✅"');
    expect(header).toContain('"size":"xl"');
    expect(header).not.toContain('"size":"xxl"');
    expect(card.contents.body.backgroundColor).toBe("#FFFFFF");
    expect(json()).not.toContain("#FAF8F2");
  });

  it("edit and delete are icon buttons beside the amount", () => {
    const out = json();
    expect(out).toContain('"text":"✏️"');
    expect(out).toContain('"text":"🗑️"');
    expect(out).toContain('"data":"a=del&id=');
  });

  it("the budget sits in its own light grey box with a thick bar", () => {
    const out = json({
      budget: { scopeName: "อาหาร", spentSatang: 357_100, limitSatang: 300_000, level: "over" },
      cycleLabel: "รายเดือน (วันที่ 1)",
    });
    expect(out).toContain('"backgroundColor":"#F6F8F9"');
    expect(out).toContain('"size":"xxl"'); // the amount spent
    expect(out).toContain('"height":"10px"'); // the bar
    expect(out).toContain("ใช้ไป 119%");
    expect(out).toContain("เกินงบ ฿571");
  });

  /** The texts of the pills in each "จ่ายด้วย" row. */
  const payRows = (over: Record<string, unknown>) => {
    const rows: string[][] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const box = node as { layout?: string; contents?: unknown[] };
      const pills = (Array.isArray(box.contents) ? box.contents : []).filter(
        (c) => (c as { height?: string }).height === "38px",
      );
      if (box.layout === "horizontal" && pills.length > 0) {
        rows.push(pills.map((c) => JSON.stringify(c).match(/"text":"([^"]*)"/)?.[1] ?? ""));
        return;
      }
      Object.values(box).forEach(walk);
    };
    walk(full(over));
    return rows;
  };
  const wallet = (n: number) => ({ id: `w${n}`, label: `กระเป๋า${n}`, selected: n === 1 });

  it("the payment channels sit on one row of three, the chosen one ticked", () => {
    const card = full({
      walletChoices: [wallet(1), wallet(2), wallet(3)],
      addWalletUrl: "https://liff.line.me/1/wallets",
    });
    const out = JSON.stringify(card);
    expect(payRows({ walletChoices: [wallet(1), wallet(2), wallet(3)] })).toEqual([
      ["✓ กระเป๋า1", "กระเป๋า2", "กระเป๋า3"],
    ]);
    expect(out).not.toContain("＋ เพิ่มช่องทาง"); // no room left on the row
    expect(out).not.toContain("เลื่อน"); // the row does not scroll, so nothing says it does
    expect(out).toContain('"borderWidth":"2px"'); // the chosen one
    expect(out.match(/"text":"จ่ายด้วย"/g)).toHaveLength(1);
  });

  it("more places than fit end the row with อื่น ๆ", () => {
    expect(payRows({ walletChoices: [wallet(1), wallet(2)], moreWallets: true })).toEqual([
      ["✓ กระเป๋า1", "กระเป๋า2", "อื่น ๆ"],
    ]);
  });

  it("a short row offers to add a place, and keeps its pills a third wide", () => {
    const rows = payRows({
      walletChoices: [wallet(1)],
      addWalletUrl: "https://liff.line.me/1/wallets",
    });
    expect(rows).toEqual([["✓ กระเป๋า1", "＋ เพิ่มช่องทาง"]]);
    expect(JSON.stringify(full({ walletChoices: [wallet(1)] }))).toContain(
      '{"type":"box","layout":"vertical","flex":1,"contents":[]}',
    );
  });

  it("the แนบรูป pill is wide and centred along the foot", () => {
    const out = json({ photoButton: true });
    expect(out).toContain('"text":"📎 แนบรูป"');
    expect(out).toContain('"height":"46px"');
    expect(out).not.toContain('"type":"filler"');
  });

  it("the chosen card theme still recolours the header and the pills", async () => {
    const { applyTheme } = await import("@/lib/personalize");
    const themed = JSON.stringify(
      applyTheme(
        [
          full({
            walletChoices: [{ id: "w1", label: "เงินสด", selected: true }],
            photoButton: true,
          }),
        ],
        "ocean",
      ),
    );
    expect(themed).not.toContain("#CCFBF1"); // the header, the chosen pill and the attach pill
    expect(themed).toContain("#E0F2FE");
  });
});
