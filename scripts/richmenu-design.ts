/**
 * Rich Menu artwork for P'Hook: a painted picture (assets/richmenu-art.webp) cut and stretched to
 * the menu's 2500x1555 size. The tap areas are boxes laid over the tiles of the picture; they are
 * measured on the picture itself (ART_*) and carried over to the menu with the same crop and scale,
 * so changing the picture means changing the boxes below.
 *
 *   ┌─────┬─────┬───────────────────────────┐
 *   │ สรุป │ เตือน │   จดรายรับ-จ่าย (compose)     │
 *   ├─────┼─────┼─────────────┬─────────────┤
 *   │โน้ต/ไฟล์│ฮูก(AI)│  สแกนบิล    │  ชวนเพื่อน   │
 *   ├─────┼─────┼─────────────┴─────────────┤
 *   │ตั้งค่า│วิธีใช้│     อัปเกรด Pro · Elite       │
 *   └─────┴─────┴───────────────────────────┘
 *
 * Analytics, categories / budgets and the entries list are not on the menu any more: they open from
 * the summary page (and its bottom bar) or by chat commands.
 */
export const RICH_MENU_WIDTH = 2500;
export const RICH_MENU_HEIGHT = 1555;

/** The picture, in its own pixels. */
export const ART_FILE = "assets/richmenu-art.jpg";
export const ART_WIDTH = 2000;
export const ART_HEIGHT = 1244;
/** The menu has the picture's own proportions (1.608, LINE takes 1.45 and wider): nothing is cut. */
export const ART_CROP = { top: 0, height: ART_HEIGHT } as const;

/**
 * Optional toning of the painting (less colour, lighter, shadows lifted). The current picture is
 * already pastel, so this is neutral; the earlier picture used saturation 0.7, brightness 1.06,
 * contrast 0.86 and lift 26 (further than that washed out the labels).
 */
export const PASTEL = { saturation: 1, brightness: 1, contrast: 1, lift: 0 } as const;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TileKey =
  | "summary"
  | "remind"
  | "note"
  | "ask"
  | "settings"
  | "help"
  | "compose"
  | "scan"
  | "invite"
  | "upgrade";

export interface Tile {
  key: TileKey;
  label: string;
  bounds: Bounds;
}

/** A box measured on the picture, as left / top / right / bottom. */
type Box = readonly [left: number, top: number, right: number, bottom: number];

const SCALE_X = RICH_MENU_WIDTH / ART_WIDTH;
const SCALE_Y = RICH_MENU_HEIGHT / ART_CROP.height;

/** Carry a box from the picture over to the menu (crop, scale, round, keep inside the menu). */
export function toMenuBounds([left, top, right, bottom]: Box): Bounds {
  const x0 = Math.max(0, Math.round(left * SCALE_X));
  const y0 = Math.max(0, Math.round((top - ART_CROP.top) * SCALE_Y));
  const x1 = Math.min(RICH_MENU_WIDTH, Math.round(right * SCALE_X));
  const y1 = Math.min(RICH_MENU_HEIGHT, Math.round((bottom - ART_CROP.top) * SCALE_Y));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ── the tiles of the picture ──
const BOXES: { key: TileKey; label: string; box: Box }[] = [
  { key: "summary", label: "สรุป", box: [41, 42, 394, 428] },
  { key: "remind", label: "เตือน", box: [418, 42, 773, 428] },
  { key: "note", label: "โน้ต/ไฟล์", box: [41, 450, 394, 828] },
  { key: "ask", label: "ถามพี่ฮูก", box: [418, 450, 773, 828] },
  { key: "settings", label: "ตั้งค่า", box: [41, 852, 394, 1216] },
  { key: "help", label: "วิธีใช้งาน", box: [418, 852, 773, 1216] },
  { key: "compose", label: "จดรายรับ-จ่าย", box: [800, 38, 1954, 630] },
  { key: "scan", label: "สแกนบิล", box: [800, 643, 1366, 922] },
  { key: "invite", label: "ชวนเพื่อน", box: [1388, 643, 1954, 922] },
  // the owl's head rises above the card into the gap, so the box starts just under the tiles above
  { key: "upgrade", label: "อัปเกรด", box: [800, 926, 1954, 1216] },
];

export const TILES: Tile[] = BOXES.map(({ key, label, box }) => ({
  key,
  label,
  bounds: toMenuBounds(box),
}));
