import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/commands";
import { parseGroupCommand } from "@/lib/group";
import { applyTheme } from "@/lib/personalize";
import {
  buildGroupHelpCard,
  buildGroupWelcomeCard,
  buildHelpPrompt,
  buildHelpTopicCard,
  buildWelcomeCard,
  HELP_TOPICS,
  isHelpTopic,
} from "./help-flex";

const json = (m: unknown) => JSON.stringify(m);

/** Commands that only show something: safe to run from a button. */
const READ_ONLY = new Set([
  "summary",
  "category-spend",
  "recent",
  "year-summary",
  "compare-months",
  "forecast",
  "wallets",
  "cards",
  "debts",
  "daily-budget",
  "points",
  "my-code",
  "bills",
  "goals",
  "remind-list",
  "owl-start",
  "open-page",
]);

describe("help topics", () => {
  const all = HELP_TOPICS.flatMap((t) => t.items.map((item) => ({ topic: t, item })));

  it("fit LINE: chips within the limits, cards short enough for a phone", () => {
    const prompt = buildHelpPrompt() as unknown as {
      quickReply: { items: { action: { label: string } }[] };
    };
    const labels = prompt.quickReply.items.map((i) => i.action.label);
    expect(labels).toHaveLength(HELP_TOPICS.length);
    expect(labels.length).toBeLessThanOrEqual(13);
    for (const label of labels) expect(label.length, label).toBeLessThanOrEqual(20);
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length);
    for (const topic of HELP_TOPICS) {
      expect(topic.items.length, topic.id).toBeLessThanOrEqual(6);
      for (const item of topic.items) {
        expect(item.cmd.length, item.cmd).toBeLessThanOrEqual(40);
        expect(item.desc.length, item.desc).toBeGreaterThan(3);
        expect(item.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it("every topic card has the chips under it, so they stay on screen", () => {
    for (const topic of HELP_TOPICS) {
      const card = buildHelpTopicCard({ topic: topic.id, plan: "free", appUrl: "https://x.test" });
      const text = json(card.quickReply);
      for (const t of HELP_TOPICS) expect(text).toContain(`a=help&t=${t.id}`);
      expect(json(card).length).toBeLessThan(50_000);
    }
  });

  it("every button sends a real read-only command (and never a recording or deleting one)", () => {
    for (const { item } of all) {
      if (!item.send) continue;
      const command = parseCommand(item.send);
      expect(command, `"${item.send}" is not a command`).not.toBeNull();
      expect(READ_ONLY.has(command!.kind), `${item.send} is ${command!.kind}`).toBe(true);
    }
    for (const cmd of [
      "กาแฟ 30",
      "ลบล่าสุด",
      "แก้ล่าสุด 45",
      "ใช้รหัส ABCD1234",
      "งบวัน 500",
      "ออม เที่ยวญี่ปุ่น 2000",
    ]) {
      const found = all.find((x) => x.item.cmd === cmd);
      expect(found, cmd).toBeDefined();
      expect(found!.item.send, cmd).toBeUndefined();
    }
  });

  it("only what the plan has can be tapped", () => {
    const taps = (plan: "free" | "plus" | "ultimate") =>
      HELP_TOPICS.reduce(
        (n, t) =>
          n +
          (json(buildHelpTopicCard({ topic: t.id, plan })).match(/"type":"message"/g) ?? []).length,
        0,
      );
    expect(taps("free")).toBeGreaterThan(0);
    expect(taps("plus")).toBeGreaterThan(taps("free"));
    expect(taps("ultimate")).toBeGreaterThan(taps("plus"));

  });

  it("is a plain, narrow page: a one-row header with its icon, rows of a command and a short line", () => {
    for (const topic of HELP_TOPICS) {
      const card = buildHelpTopicCard({ topic: topic.id, plan: "free", appUrl: "https://x.test" }) as unknown as {
        contents: { size: string; header: { contents: { text?: string }[] }; footer?: unknown };
      };
      expect(card.contents.size, topic.id).toBe("kilo");
      expect(card.contents.header.contents[0]?.text).toBe(`${topic.icon} ${topic.title}`);
      // no plan badges, no coloured tiles, no logo or closing line at the foot
      const out = json(card.contents);
      expect(out, topic.id).not.toMatch(/"(Pro|Elite)( ✓)?"/);
      expect(out, topic.id).not.toMatch(/#FDECEF|#E8F8EF|#E8F1FD|#EFEBFD|#E3F7F4|#FFF1E5|#F1F5F9/);
      expect(out, topic.id).not.toContain("logo.png");
      expect(card.contents.footer, topic.id).toBeUndefined();
    }
  });

  it("every line is short", () => {
    for (const { item } of all) expect(item.desc.length, item.desc).toBeLessThanOrEqual(28);
  });

  it("a Free user cannot tap a Pro command (it would only bounce)", () => {
    const sends = (j: string, text: string) =>
      j.includes(`"type":"message","label":"${text}","text":"${text}"`);
    const freeSummary = json(buildHelpTopicCard({ topic: "summary", plan: "free" }));
    expect(sends(freeSummary, "สรุปปี")).toBe(false);
    expect(sends(freeSummary, "สรุปวันนี้")).toBe(true);
    expect(sends(json(buildHelpTopicCard({ topic: "summary", plan: "plus" })), "สรุปปี")).toBe(
      true,
    );
  });

  it("the shortcuts card opens the app pages, or says where the menu is when the URL is unknown", () => {
    expect(
      json(buildHelpTopicCard({ topic: "shortcuts", plan: "free", appUrl: "https://x.test" })),
    ).toContain("https://x.test/upgrade");
    const none = json(buildHelpTopicCard({ topic: "shortcuts", plan: "free" }));
    expect(none).not.toContain("undefined");
    expect(none).toContain("เมนูด้านล่าง");
  });

  it("an unknown topic id falls back to the first topic", () => {
    expect(isHelpTopic("record")).toBe(true);
    expect(isHelpTopic("nope")).toBe(false);
    expect(isHelpTopic(null)).toBe(false);
  });

  it("follows the person's colour theme", () => {
    const themed = json(
      applyTheme([buildHelpTopicCard({ topic: "record", plan: "plus" })], "ocean"),
    );
    expect(themed).toContain("#E0F2FE");
    expect(themed).not.toContain("#CCFBF1");
  });
});

describe("the question", () => {
  it("has its own wording for each manner of the bot (never the sample's)", () => {
    const wording = (["polite", "friendly", "strict", "cheer"] as const).map(
      (p) => (buildHelpPrompt(p) as unknown as { text: string }).text,
    );
    expect(new Set(wording).size).toBe(4);
    for (const text of wording) {
      expect(text).not.toContain("สงสัยตรงไหน");
      expect(text).not.toContain("คะลูก");
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

describe("welcome and group cards", () => {
  it("the welcome card shows examples and a button to the full guide", () => {
    const card = json(buildWelcomeCard({ appUrl: "https://x.test" }));
    expect(card).toContain("กาแฟ 30");
    expect(card).toContain('"text":"วิธีใช้งาน"');
    expect(card).toContain("https://x.test/summary");
    expect(json(buildWelcomeCard({}))).not.toContain("undefined");
  });

  it("the group card lists the commands in the same look as the private ones, with no buttons that talk in the group", () => {
    const card = json(buildGroupHelpCard());
    expect(card).toContain('"text":"👥 วิธีใช้สมุดกลุ่ม"'); // the same plain header
    expect(card).toContain('"size":"kilo"');
    expect(card).not.toContain("logo.png");
    expect(card).toContain("เริ่มทริป");
    expect(card).toContain("จด ข้าวเที่ยง 350");
    expect(card).toContain("ปิดสมุดกลุ่ม");
    expect(card).not.toContain('"type":"message"');
  });
});

describe("group welcome card, small and swipeable", () => {
  const bubbles = (m: unknown) =>
    (m as { contents: { type: string; contents: { size: string }[] } }).contents.contents;

  it("is three small cards in a carousel (not one tall one)", () => {
    const card = buildGroupWelcomeCard({
      appUrl: "https://x.test",
      openUrl: "https://liff.line.me/1/group-open",
    });
    expect((card.contents as { type: string }).type).toBe("carousel");
    expect(bubbles(card)).toHaveLength(3);
    for (const b of bubbles(card)) expect(b.size).toBe("kilo");
  });

  it("the buttons are on the first card, so they show without swiping", () => {
    const first = json(
      bubbles(buildGroupWelcomeCard({ openUrl: "https://liff.line.me/1/group-open" }))[0],
    );
    expect(first).toContain("เปิดสมุดกลุ่ม");
    expect(first).toContain('"text":"วิธีใช้งาน"');
    const others = bubbles(buildGroupWelcomeCard({}))
      .slice(1)
      .map((b) => json(b))
      .join("");
    expect(others).not.toContain('"type":"button"');
  });

  it("'เปิดสมุดกลุ่ม' opens the LIFF page (which checks the friend) instead of typing in the group", () => {
    const card = json(buildGroupWelcomeCard({ openUrl: "https://liff.line.me/1/group-open" }));
    expect(card).toContain('"uri":"https://liff.line.me/1/group-open"');
    expect(card).not.toContain('"text":"เปิดสมุดกลุ่ม"');
  });

  it("without a LIFF address it still works by typing the command", () => {
    const card = json(buildGroupWelcomeCard({}));
    expect(card).toContain('"text":"เปิดสมุดกลุ่ม"');
    expect(card).not.toContain("undefined");
  });

  it("each small card is short (the first one fits a phone without scrolling)", () => {
    for (const b of bubbles(
      buildGroupWelcomeCard({
        appUrl: "https://x.test",
        openUrl: "https://liff.line.me/1/group-open",
      }),
    )) {
      expect(json(b).length).toBeLessThan(6_000);
    }
  });
});

describe("group welcome card", () => {
  it("says who it is for, three steps, and has the two buttons that type the commands", () => {
    const card = json(buildGroupWelcomeCard({ appUrl: "https://x.test" }));
    expect(card).toContain("ครอบครัว");
    expect(card).toContain("เริ่มใช้ใน 3 ขั้น");
    expect(card).toContain('"label":"📒 เปิดสมุดกลุ่ม"');
    expect(card).toContain('"label":"📖 วิธีใช้งาน","text":"วิธีใช้งาน"');
    expect(card).toContain("https://x.test/logo.png");
    expect(card).toContain("Elite"); // the opener must be Elite; the rest are free
    expect(card.length).toBeLessThan(50_000);
  });

  it("works without a public address (no logo, nothing undefined)", () => {
    const card = json(buildGroupWelcomeCard({}));
    expect(card).not.toContain("logo.png");
    expect(card).not.toContain("undefined");
  });

  it("the typed commands are ones the group understands", () => {
    expect(parseGroupCommand("เปิดสมุดกลุ่ม")?.kind).toBeDefined();
    expect(parseGroupCommand("วิธีใช้งาน")?.kind).toBe("help");
  });
});
