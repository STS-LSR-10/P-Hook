import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, readJson } from "./api";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/x", { method: "POST", body, headers });

describe("readJson", () => {
  it("reads an ordinary JSON body", async () => {
    expect(await readJson(post(JSON.stringify({ a: 1, ไทย: "ข้อความ" })))).toEqual({
      a: 1,
      ไทย: "ข้อความ",
    });
  });

  it("refuses a body that says it is too large, without reading it", async () => {
    const req = post("{}", { "content-length": String(MAX_JSON_BYTES + 1) });
    expect(await readJson(req)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it("refuses a body that is too large whatever its header says", async () => {
    const big = JSON.stringify({ items: "x".repeat(MAX_JSON_BYTES) });
    // a stream has no Content-Length, like a chunked upload
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(big);
        for (let i = 0; i < bytes.length; i += 16_384)
          controller.enqueue(bytes.slice(i, i + 16_384));
        controller.close();
      },
    });
    const req = new Request("https://app.example.com/api/x", {
      method: "POST",
      body: stream,
      // @ts-expect-error a streamed body needs this in Node
      duplex: "half",
    });
    expect(await readJson(req)).toBeNull();
  });

  it("takes its own smaller limit", async () => {
    expect(await readJson(post(JSON.stringify({ a: "x".repeat(200) })), 100)).toBeNull();
    expect(await readJson(post(JSON.stringify({ a: 1 })), 100)).toEqual({ a: 1 });
  });

  it("is null for no body and for something that is not JSON", async () => {
    expect(
      await readJson(new Request("https://app.example.com/api/x", { method: "POST" })),
    ).toBeNull();
    expect(await readJson(post("not json"))).toBeNull();
  });
});
