import { afterEach, describe, expect, it, vi } from "vitest";
import { createLineClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("showLoading", () => {
  it("starts the typing dots for the chat", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await createLineClient("tok").showLoading("U1", 20);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/chat/loading/start");
    expect(JSON.parse(String(init.body))).toEqual({ chatId: "U1", loadingSeconds: 20 });
  });
  it("throws with the status only when LINE refuses", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 400 }));
    await expect(createLineClient("tok").showLoading("U1")).rejects.toThrow("400");
  });
});

describe("getGroupName", () => {
  it("asks for the group's summary, and gives up on a slow LINE", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ groupName: "บ้านเรา" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createLineClient("tok").getGroupName("C1")).resolves.toBe("บ้านเรา");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/group/C1/summary");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("is null when LINE does not say", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    await expect(createLineClient("tok").getGroupName("C1")).resolves.toBeNull();
  });
});
