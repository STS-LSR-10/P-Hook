import { describe, expect, it } from "vitest";
import { PRICES } from "@/lib/pricing";
import { buildUpsellCard } from "./upsell-flex";

const AFTER = new Date("2027-02-01T00:00:00Z");

const json = (m: unknown) => JSON.stringify(m);

describe("upgrade card", () => {
  it("backdate: names the feature, the price, the trial and the 'as today' button", () => {
    const card = json(
      buildUpsellCard({
        feature: "backdate",
        trialAvailable: true,
        now: AFTER,
        upgradeUrl: "https://x.test/upgrade",
        retryText: "เมื่อวาน ข้าวผัด 60",
      }),
    );
    expect(card).toContain("เมื่อวาน");
    expect(card).toContain(`฿${PRICES.starter.monthly}/เดือน`); // the cheapest way in
    expect(card).toContain("a=trial&p=plus");
    expect(card).toContain("https://x.test/upgrade");
    expect(card).toContain(`a=bdt&t=${encodeURIComponent("เมื่อวาน ข้าวผัด 60")}`);
  });

  it("slip: shows Starter and Pro with their real numbers, and no 'as today' button", () => {
    const card = json(buildUpsellCard({ feature: "slip", trialAvailable: true, now: AFTER }));
    expect(card).toContain(`฿${PRICES.starter.monthly}`);
    expect(card).toContain(`฿${PRICES.plus.monthly}`);
    expect(card).toContain("60 ใบ/เดือน");
    expect(card).toContain("250 ใบ/เดือน");
    expect(card).not.toContain("a=bdt");
  });

  it("there is no launch price to show for now", () => {
    const card = json(buildUpsellCard({ feature: "slip", trialAvailable: true, now: AFTER }));
    expect(card).not.toContain("ราคาเปิดตัว");
  });

  it("voice: names the Starter and Pro allowances", () => {
    const card = json(buildUpsellCard({ feature: "voice", trialAvailable: true, now: AFTER }));
    expect(card).toContain("30 ครั้ง/เดือน");
    expect(card).toContain("200 ครั้ง/เดือน");
    expect(card).toContain("a=trial&p=plus");
  });

  it("no trial button once the trial was used, and a too-long text drops the 'as today' button", () => {
    const card = json(
      buildUpsellCard({
        feature: "backdate",
        trialAvailable: false,
        upgradeUrl: "https://x.test/upgrade",
        retryText: "เมื่อวาน " + "ก".repeat(200),
      }),
    );
    expect(card).not.toContain("a=trial");
    expect(card).not.toContain("a=bdt");
    expect(card).toContain("https://x.test/upgrade");
  });
});

describe("the AI quota card", () => {
  it("pitches the one 'ถาม AI' quota with its real numbers", () => {
    const out = JSON.stringify(
      buildUpsellCard({
        feature: "owl",
        trialAvailable: true,
        now: new Date("2026-11-04T03:00:00Z"),
      }),
    );
    expect(out).toContain("ถาม AI");
    expect(out).toContain("600");
    expect(out).toContain("1,500");
  });
});
