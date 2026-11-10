import { describe, expect, it } from "vitest";
import { buildShareCard, type ShareSummary } from "@/lib/share-card";
import { buildShareFlex } from "./share-flex";

const summary: ShareSummary = {
  range: { from: "2026-10-31T17:00:00Z", to: "2026-11-30T17:00:00Z" },
  cycle: "monthly",
  incomeSatang: 3_000_000,
  expenseSatang: 1_200_000,
  balanceSatang: 1_800_000,
  count: 42,
  budgetSatang: null,
  categories: [
    { name: "อาหาร", color: "#0F766E", icon: "utensils", totalSatang: 600_000 },
    { name: "เดินทาง", color: "#0369A1", icon: "bus", totalSatang: 300_000 },
  ],
};
const link = "https://liff.line.me/1234-abc";
const flex = (hide: boolean, theme?: "mint" | "night") =>
  buildShareFlex(buildShareCard(summary, null, { hideAmounts: hide }), {
    link,
    code: "ABCD1234",
    theme,
  });
const texts = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    return [...(typeof o.text === "string" ? [o.text] : []), ...Object.values(o).flatMap(texts)];
  }
  return [];
};

describe("buildShareFlex", () => {
  it("is a flex bubble with an alt text that says what it is", () => {
    const m = flex(true);
    expect(m.type).toBe("flex");
    expect((m.altText as string).length).toBeLessThanOrEqual(400);
    expect(m.altText).toContain("พฤศจิกายนของฉัน");
  });

  it("with amounts hidden carries no baht figure anywhere", () => {
    const all = texts(flex(true)).join("\n");
    expect(all).not.toMatch(/฿|\d,\d{3}/);
    expect(all).toContain("50%"); // the share of the biggest category
  });

  it("with amounts shown says them", () => {
    const all = texts(flex(false)).join("\n");
    expect(all).toContain("฿18,000");
    expect(all).toContain("฿6,000");
  });

  it("has the invitation: the referral code, and a button to the app", () => {
    const all = JSON.stringify(flex(true));
    expect(all).toContain("ใช้รหัส ABCD1234");
    expect(all).toContain(`"uri":"${link}"`);
    expect(all).toContain("เริ่มจดกับพี่ฮูก");
  });

  it("without a link there is no button, without a code no line about it", () => {
    const m = buildShareFlex(buildShareCard(summary, null, { hideAmounts: true }), {
      link: null,
      code: null,
    });
    expect(JSON.stringify(m)).not.toContain('"type":"button"');
    expect(JSON.stringify(m)).not.toContain("ใช้รหัส");
    expect((m.contents as Record<string, unknown>).footer).toBeUndefined();
  });

  it("each category bar is as wide as its share, never wider than the track", () => {
    const widths = [...JSON.stringify(flex(true)).matchAll(/"width":"(\d+)%"/g)].map((x) =>
      Number(x[1]),
    );
    expect(widths).toEqual([50, 25]);
  });

  it("on the dark theme the button is darker (LINE draws its label white) and the bars lighter", () => {
    const night = JSON.stringify(flex(true, "night"));
    expect(night).toContain('"color":"#0F766E"'); // the button
    expect(night).not.toContain('"backgroundColor":"#0F766E"'); // the bar of อาหาร is lightened
    const mint = JSON.stringify(flex(true));
    expect(mint).toContain('"backgroundColor":"#0F766E"'); // unchanged on the light themes
  });

  it("the night theme is dark with light text", () => {
    const s = JSON.stringify(flex(true, "night"));
    expect(s).toContain("#0F172A"); // page
    expect(s).toContain("#F8FAFC"); // text
  });
});
