import { forDark, mixHex } from "@/lib/colour";
import { THEMES, type ThemeId } from "@/lib/personalize";
import type { ShareCardModel } from "@/lib/share-card";

/** The size of the picture: a story (9:16), which also fits a post when cropped. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

interface Theme {
  top: string;
  bottom: string;
  ink: string;
  muted: string;
  primary: string;
  /** Text on the primary colour (the line about the month). */
  onPrimary: string;
  card: string;
  track: string;
  /** The faint circles in the background. */
  deco: string;
  /** The dark squares of the QR code. */
  qr: string;
}

const MINT: Theme = {
  top: "#F0FDF4",
  bottom: "#CCFBF1",
  ink: "#0F172A",
  muted: "#475569",
  primary: "#047857",
  onPrimary: "#FFFFFF",
  card: "#FFFFFF",
  track: "#E2E8F0",
  deco: "rgba(4,120,87,0.07)",
  qr: "#064E3B",
};

const NIGHT: Theme = {
  top: "#0B1220",
  bottom: "#1E293B",
  ink: "#F8FAFC",
  muted: "#CBD5E1",
  primary: "#5EEAD4",
  onPrimary: "#0F172A",
  card: "#1F2A3C",
  track: "#334155",
  deco: "rgba(94,234,212,0.07)",
  qr: "#0F172A",
};

/** The colours of the card for a card theme (the same themes the chat cards have). */
export function themeFor(id: ThemeId): Theme {
  if (id === "mint") return MINT;
  if (id === "night") return NIGHT;
  const p = THEMES[id].palette;
  return {
    top: mixHex(p.soft, "#FFFFFF", 0.55),
    bottom: p.soft,
    ink: "#0F172A",
    muted: p.bodySub,
    primary: p.primary,
    onPrimary: "#FFFFFF",
    card: "#FFFFFF",
    track: "#E2E8F0",
    deco: `${p.primary}12`,
    qr: p.bodyDeep,
  };
}

export interface DrawInput {
  model: ShareCardModel;
  /** The person's referral code, printed on the card (null: none). */
  code: string | null;
  /** Where the QR code leads (null: no QR). */
  link: string | null;
  /** The font family to draw with (the page's own, so Thai looks like the app). */
  fontFamily: string;
  /** The card theme (default: mint). */
  theme?: ThemeId;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** Draw `text` at (x, y) in one line, shrinking the font until it fits `maxWidth`. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  weight: number,
  size: number,
  family: string,
  align: CanvasTextAlign = "left",
): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 20 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/** Break `text` into lines no wider than `maxWidth` (Thai has no spaces, so it breaks by letters). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of graphemes(text)) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

/** The letters of `text` as a reader sees them (a Thai vowel or tone mark stays with its letter, an emoji whole). */
function graphemes(text: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => { segment(input: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (!Segmenter) return [...text];
  return [...new Segmenter("th", { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

async function qrImage(link: string, dark: string): Promise<HTMLImageElement | null> {
  try {
    const QRCode = (await import("qrcode")).default;
    const url = await QRCode.toDataURL(link, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark, light: "#FFFFFF" },
    });
    return await loadImage(url);
  } catch {
    return null;
  }
}

/** Draw the card and return it as a PNG. */
export async function drawShareCard(input: DrawInput): Promise<Blob> {
  const { model, code, link, fontFamily: f } = input;
  const th = themeFor(input.theme ?? "mint");
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");

  try {
    await document.fonts.load(`700 40px ${f}`);
    await document.fonts.load(`400 40px ${f}`);
  } catch {
    // the system font draws Thai as well
  }
  const [logo, qr] = await Promise.all([
    loadImage("/phook-icon.png"),
    link ? qrImage(link, th.qr) : Promise.resolve(null),
  ]);

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  bg.addColorStop(0, th.top);
  bg.addColorStop(1, th.bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = th.deco;
  ctx.beginPath();
  ctx.arc(980, 120, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(60, 1500, 260, 0, Math.PI * 2);
  ctx.fill();

  // brand
  if (logo) ctx.drawImage(logo, 80, 90, 96, 96);
  ctx.fillStyle = th.primary;
  fitText(ctx, "พี่ฮูก P'Hook", logo ? 196 : 80, 154, 600, 700, 52, f);

  // title
  ctx.fillStyle = th.ink;
  fitText(ctx, model.title, 80, 330, 920, 700, 96, f);
  ctx.fillStyle = th.muted;
  fitText(ctx, model.subtitle, 80, 398, 920, 400, 40, f);

  // the big figure
  ctx.fillStyle = th.card;
  roundRect(ctx, 80, 460, 920, 440, 56);
  ctx.shadowColor = "rgba(15,23,42,0.10)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = th.muted;
  fitText(ctx, model.heroLabel, 540, 560, 800, 400, 44, f, "center");
  ctx.fillStyle = th.primary;
  fitText(ctx, model.heroValue, 540, 700, 820, 700, 128, f, "center");
  ctx.fillStyle = th.track;
  ctx.fillRect(140, 745, 800, 3);
  model.stats.forEach((s, i) => {
    const cx = i === 0 ? 340 : 740;
    ctx.fillStyle = th.muted;
    fitText(ctx, s.label, cx, 808, 360, 400, 36, f, "center");
    ctx.fillStyle = th.ink;
    fitText(ctx, s.value, cx, 868, 360, 700, 50, f, "center");
  });

  // the biggest categories
  let y = 975;
  if (model.top.length > 0) {
    ctx.fillStyle = th.ink;
    fitText(ctx, "ใช้จ่ายหมวดไหนมากสุด", 80, y, 920, 700, 48, f);
    y += 35;
    for (const row of model.top) {
      const color =
        input.theme === "night" ? forDark(row.color, th.primary) : (row.color ?? th.primary);
      ctx.fillStyle = `${color}2E`;
      ctx.beginPath();
      ctx.arc(140, y + 50, 50, 0, Math.PI * 2);
      ctx.fill();
      if (row.emoji) {
        ctx.fillStyle = th.ink;
        ctx.font = `400 52px ${f}, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(row.emoji, 140, y + 68);
      }
      ctx.fillStyle = th.ink;
      fitText(ctx, row.name, 220, y + 36, row.amount ? 420 : 560, 700, 40, f);
      if (row.amount) {
        ctx.fillStyle = th.muted;
        fitText(ctx, row.amount, 220, y + 84, 420, 400, 34, f);
      }
      // the bar: the share of all spending
      ctx.fillStyle = th.track;
      roundRect(ctx, 220, y + (row.amount ? 100 : 66), 580, 22, 11);
      ctx.fill();
      ctx.fillStyle = color;
      roundRect(
        ctx,
        220,
        y + (row.amount ? 100 : 66),
        Math.max(22, (580 * row.percent) / 100),
        22,
        11,
      );
      ctx.fill();
      ctx.fillStyle = th.ink;
      fitText(ctx, `${row.percent}%`, 1000, y + 72, 170, 700, 48, f, "right");
      y += 135;
    }
  } else {
    ctx.fillStyle = th.muted;
    ctx.font = `400 44px ${f}`;
    ctx.textAlign = "center";
    ctx.fillText("เห็นเงินชัด ๆ แค่พิมพ์ในไลน์", 540, y + 70);
  }

  // the line about it
  y = 1440;
  ctx.fillStyle = th.primary;
  roundRect(ctx, 80, y, 920, 130, 40);
  ctx.fill();
  ctx.fillStyle = th.onPrimary;
  ctx.font = `700 44px ${f}`;
  const lines = wrap(ctx, model.headline, 820).slice(0, 2);
  lines.forEach((ln, i) => {
    ctx.textAlign = "center";
    ctx.fillText(ln, 540, y + (lines.length === 1 ? 82 : 58 + i * 52));
  });

  // the invitation
  const fy = 1600;
  ctx.fillStyle = th.card;
  roundRect(ctx, 80, fy, 920, 260, 48);
  ctx.fill();
  const textX = qr ? 400 : 120;
  if (qr) {
    // a white plate, so the code reads on a dark card too
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, 104, fy + 12, 236, 236, 24);
    ctx.fill();
    ctx.drawImage(qr, 112, fy + 20, 220, 220);
  }
  ctx.fillStyle = th.ink;
  fitText(ctx, "จดง่าย เห็นเงินชัด", textX, fy + 78, 570, 700, 52, f);
  ctx.fillStyle = th.muted;
  fitText(ctx, "เพิ่มเพื่อนพี่ฮูกใน LINE แล้วจดได้เลย", textX, fy + 132, 570, 400, 34, f);
  if (code) {
    ctx.fillStyle = th.primary;
    fitText(ctx, `พิมพ์ “ใช้รหัส ${code}”`, textX, fy + 190, 570, 700, 40, f);
    ctx.fillStyle = th.muted;
    fitText(ctx, "ทั้งคู่ได้โบนัสฮูกคอยน์", textX, fy + 232, 570, 400, 30, f);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"),
  );
}
