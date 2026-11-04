import { describe, expect, it } from "vitest";
import { later, withLater } from "./later";

describe("later", () => {
  it("in a webhook's scope, the work waits until the event is answered", async () => {
    const order: string[] = [];
    await withLater(async () => {
      await later(async () => {
        order.push("google");
      });
      order.push("reply");
    });
    expect(order).toEqual(["reply", "google"]);
  });

  it("a failure there is swallowed", async () => {
    await expect(
      withLater(async () => {
        await later(async () => {
          throw new Error("down");
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("outside a scope it runs now", async () => {
    let ran = false;
    await later(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe("the webhook", () => {
  it("answers each event before keeping Google in step", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/line/process.ts", "utf8");
    expect(src).toMatch(/withLater\(\(\) => handleEvent\(raw, deps\)\)/);
  });
});
