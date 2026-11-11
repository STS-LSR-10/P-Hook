import { forDark } from "@/lib/colour";
import { THEMES, type ThemeId } from "@/lib/personalize";
import type { ShareCardModel } from "@/lib/share-card";
import type { LineMessage } from "@/lib/types";

/**
 * The summary card as a Flex message, to send into a LINE chat with the share picker (a picture would
 * need a public address; this carries its own words and bars). It has the same figures as the picture,
 * so the hidden-amounts choice holds here too, and a button to start using พี่ฮูก.
 */
export function buildShareFlex(
  model: ShareCardModel,
  input: { link: string | null; code: string | null; theme?: ThemeId },
): LineMessage {
  const p = THEMES[input.theme ?? "mint"].palette;
  const dark = input.theme === "night";
  const ink = dark ? "#F8FAFC" : p.bodyDeep;
  const muted = dark ? "#CBD5E1" : p.bodySub;
  const accent = dark ? "#5EEAD4" : p.primary;
  const page = dark ? "#0F172A" : p.soft;
  const panel = dark ? "#1E293B" : "#FFFFFF";

  const rows = model.top.map((row) => ({
    type: "box",
    layout: "vertical",
    margin: "md",
    spacing: "xs",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: `${row.emoji ? `${row.emoji} ` : ""}${row.name}`,
            size: "sm",
            weight: "bold",
            color: ink,
            flex: 5,
            wrap: false,
          },
          {
            type: "text",
            text: row.amount ? `${row.amount} · ${row.percent}%` : `${row.percent}%`,
            size: "sm",
            weight: "bold",
            color: ink,
            align: "end",
            flex: 4,
          },
        ],
      },
      {
        type: "box",
        layout: "vertical",
        height: "6px",
        cornerRadius: "3px",
        backgroundColor: dark ? "#334155" : "#E2E8F0",
        contents: [
          {
            type: "box",
            layout: "vertical",
            width: `${Math.max(4, Math.min(100, row.percent))}%`,
            height: "6px",
            cornerRadius: "3px",
            backgroundColor: dark ? forDark(row.color, accent) : (row.color ?? accent),
            contents: [],
          },
        ],
      },
    ],
  }));

  const hero = {
    type: "box",
    layout: "vertical",
    backgroundColor: panel,
    cornerRadius: "16px",
    paddingAll: "12px",
    spacing: "xs",
    contents: [
      { type: "text", text: model.heroLabel, size: "xs", color: muted, align: "center" },
      {
        type: "text",
        text: model.heroValue,
        size: "lg",
        weight: "bold",
        color: accent,
        align: "center",
        wrap: true,
      },
      { type: "separator", margin: "md", color: dark ? "#334155" : "#E2E8F0" },
      {
        type: "box",
        layout: "horizontal",
        margin: "md",
        contents: model.stats.map((s) => ({
          type: "box",
          layout: "vertical",
          flex: 1,
          contents: [
            { type: "text", text: s.label, size: "xs", color: muted, align: "center" },
            {
              type: "text",
              text: s.value,
              size: "md",
              weight: "bold",
              color: ink,
              align: "center",
            },
          ],
        })),
      },
    ],
  };

  const footer: Record<string, unknown>[] = [];
  if (input.code) {
    footer.push({
      type: "text",
      text: `พิมพ์ "ใช้รหัส ${input.code}" ทั้งคู่ได้โบนัสฮูกคอยน์`,
      size: "xs",
      color: muted,
      align: "center",
      wrap: true,
    });
  }
  if (input.link) {
    footer.push({
      type: "button",
      style: "primary",
      color: dark ? "#0F766E" : accent,
      height: "sm",
      action: { type: "uri", label: "เริ่มจดกับพี่ฮูก", uri: input.link },
    });
  }

  return {
    type: "flex",
    altText: `${model.title} · ${model.heroLabel} ${model.heroValue}`,
    contents: {
      type: "bubble",
      size: "mega",
      styles: { body: { backgroundColor: page }, footer: { backgroundColor: page } },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "พี่ฮูก P'Hook", size: "sm", weight: "bold", color: accent },
          { type: "text", text: model.title, size: "lg", weight: "bold", color: ink, wrap: true },
          { type: "text", text: model.subtitle, size: "xs", color: muted },
          hero,
          ...rows,
          {
            type: "text",
            text: model.headline,
            size: "sm",
            weight: "bold",
            color: accent,
            wrap: true,
            margin: "lg",
          },
        ],
      },
      ...(footer.length > 0
        ? { footer: { type: "box", layout: "vertical", spacing: "sm", contents: footer } }
        : {}),
    },
  };
}
