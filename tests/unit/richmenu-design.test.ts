import { describe, expect, it } from "vitest";
import {
  RICH_MENU_HEIGHT,
  RICH_MENU_WIDTH,
  TILES,
  toMenuBounds,
  type Bounds,
} from "../../scripts/richmenu-design";

const overlap = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the Rich Menu tap areas", () => {
  it("every tile is there, with its place in the menu", () => {
    const keys = new Set(TILES.map((t) => t.key));
    for (const k of [
      "summary",
      "remind",
      "note",
      "ask",
      "settings",
      "help",
      "compose",
      "scan",
      "invite",
      "upgrade",
    ]) {
      expect(keys.has(k as never)).toBe(true);
    }
    expect(TILES).toHaveLength(10);
  });

  it("stay inside the 2500x1555 menu and have a size", () => {
    for (const { bounds: b, key } of TILES) {
      expect(b.width, key).toBeGreaterThan(100);
      expect(b.height, key).toBeGreaterThan(100);
      expect(b.x, key).toBeGreaterThanOrEqual(0);
      expect(b.y, key).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, key).toBeLessThanOrEqual(RICH_MENU_WIDTH);
      expect(b.y + b.height, key).toBeLessThanOrEqual(RICH_MENU_HEIGHT);
    }
  });

  it("never overlap one another (LINE refuses overlapping areas)", () => {
    for (let i = 0; i < TILES.length; i++) {
      for (let j = i + 1; j < TILES.length; j++) {
        expect(
          overlap(TILES[i]!.bounds, TILES[j]!.bounds),
          `${TILES[i]!.key} / ${TILES[j]!.key}`,
        ).toBe(false);
      }
    }
  });

  it("a box of the picture is carried over with the same crop and scale", () => {
    // the whole picture is the whole menu
    expect(toMenuBounds([0, 0, 2000, 1244])).toEqual({
      x: 0,
      y: 0,
      width: RICH_MENU_WIDTH,
      height: RICH_MENU_HEIGHT,
    });
    // what lies above or beyond the cut is clamped, not negative
    const b = toMenuBounds([-50, 0, 2000, 2000]);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.x + b.width).toBe(RICH_MENU_WIDTH);
    expect(b.y + b.height).toBe(RICH_MENU_HEIGHT);
  });
});
