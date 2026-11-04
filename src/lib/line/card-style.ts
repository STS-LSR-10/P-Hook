import { COLOR } from "./flex";

/** The soft look shared by the report cards (summary, categories, comparison, insight, forecast). */
export const TINT = {
  header: "#CCFBF1",
  headerTitle: "#0B4F43",
  headerSub: "#3F6B63",
  body: "#FFFFFF",
  strong: "#0B3C4F",
  track: "#E7E7F0",
  good: "#059669",
  goodSoft: "#DDF7E8",
  bad: "#E11D48",
  badSoft: "#FDE4E8",
  neutralSoft: "#ECEEF2",
  warm: "#FEF3C7",
  cool: "#E4EEFF",
  lavender: "#EDE5FB",
  peach: "#FDEBDD",
} as const;

/** Bar colours handed out one per row, in order (purple, orange, pink, blue, olive, coral). */
export const BAR_COLORS = [
  "#A583E0",
  "#FB923C",
  "#F472B6",
  "#60A5FA",
  "#CBD35B",
  "#FB8E80",
] as const;
export const barColor = (index: number) => BAR_COLORS[index % BAR_COLORS.length] as string;

/** Title, a line or two under it, and a big emoji on the right. */
export function cardHeader(title: string, subtitles: string[], icon: string) {
  return {
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    backgroundColor: TINT.header,
    paddingAll: "12px",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: title,
            weight: "bold",
            size: "lg",
            color: TINT.headerTitle,
            wrap: true,
          },
          ...subtitles.map((s) => ({
            type: "text",
            text: s,
            size: "xs",
            color: TINT.headerSub,
            wrap: true,
          })),
        ],
      },
      { type: "text", text: icon, size: "lg", flex: 0, align: "end" },
    ],
  };
}

/**
 * The short card's header, as the reminder card has it: one row, the title and a few words at the
 * right. These cards are narrow (kilo): a title, a few rows and a small button.
 */
export function compactHeader(title: string, right?: string) {
  return {
    type: "box",
    layout: "horizontal",
    backgroundColor: TINT.header,
    paddingAll: "12px",
    contents: [
      {
        type: "text",
        text: title,
        weight: "bold",
        size: "md",
        color: TINT.headerTitle,
        wrap: true,
        flex: 1,
      },
      ...(right
        ? [
            {
              type: "text",
              text: right,
              size: "sm",
              color: TINT.headerTitle,
              align: "end",
              gravity: "center",
              flex: 0,
            },
          ]
        : []),
    ],
  };
}

/** An outlined, rounded button. */
export function outlinePill(label: string, action: Record<string, unknown>, color = "#334155") {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    cornerRadius: "20px",
    borderWidth: "1px",
    borderColor: "#CBD5E1",
    paddingAll: "8px",
    action,
    contents: [{ type: "text", text: label, align: "center", size: "sm", weight: "bold", color }],
  };
}

/** The one outlined button along the foot of a short card; left out unless the link is https. */
export function compactFooter(label: string, uri: string | undefined) {
  if (!uri?.startsWith("https://")) return undefined;
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "12px",
    paddingTop: "0px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [outlinePill(label, { type: "uri", label: actionLabel(label), uri })],
      },
    ],
  };
}

/** The button's label without the emoji at its end (LINE shows it in some places, 20 characters at most). */
const actionLabel = (label: string) =>
  label.replace(/[\s\p{Extended_Pictographic}\u{FE0F}➡→]+$/u, "").slice(0, 20) ||
  label.slice(0, 20);

/** The rounded teal button along the foot of a card; left out unless the link is https. */
export function pillFooter(label: string, uri: string | undefined) {
  if (!uri?.startsWith("https://")) return undefined;
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: TINT.body,
    paddingStart: "12px",
    paddingEnd: "12px",
    paddingBottom: "12px",
    paddingTop: "4px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0F766E",
        cornerRadius: "26px",
        paddingAll: "12px",
        action: { type: "uri", label: actionLabel(label), uri },
        contents: [
          {
            type: "text",
            text: label,
            color: "#FFFFFF",
            weight: "bold",
            size: "md",
            align: "center",
          },
        ],
      },
    ],
  };
}

/** A track with a thick rounded bar inside (percent 0-100; a sliver still shows). */
export function bar(percent: number, color: string, height = "10px") {
  return {
    type: "box",
    layout: "vertical",
    height,
    cornerRadius: "6px",
    backgroundColor: TINT.track,
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${Math.min(100, Math.max(3, Math.round(percent)))}%`,
        height,
        cornerRadius: "6px",
        backgroundColor: color,
        contents: [],
      },
    ],
  };
}

/** A small rounded tag ("ใหม่", "▲ 25%") with its own tint. */
export function badge(text: string, color: string, bg: string) {
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    cornerRadius: "10px",
    backgroundColor: bg,
    paddingTop: "2px",
    paddingBottom: "2px",
    paddingStart: "9px",
    paddingEnd: "9px",
    contents: [{ type: "text", text, size: "xs", weight: "bold", color }],
  };
}

export const mutedText = (text: string, size: "xs" | "sm" = "xs") => ({
  type: "text",
  text,
  size,
  color: COLOR.muted,
  wrap: true,
});
