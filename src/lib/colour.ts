/** A colour 0..1 of the way from `a` to `b` (both #RRGGBB). */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
  return `#${[0, 1, 2].map((i) => part(i).toString(16).padStart(2, "0")).join("")}`;
}

/** A category's colour for a dark background: lighter, so a bar stays visible (#RRGGBB only). */
export function forDark(color: string | null, fallback: string): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? mixHex(color, "#FFFFFF", 0.4) : fallback;
}
