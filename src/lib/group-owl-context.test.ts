import { describe, expect, it } from "vitest";
import { renderGroupOwlContext } from "./group-owl-context";

describe("renderGroupOwlContext", () => {
  it("names who paid, from the group's own ledger only", () => {
    const text = renderGroupOwlContext({
      today: new Date("2026-10-18T05:00:00Z"),
      month: [{ lineUserId: "Uanna", totalSatang: 45000, entries: 3 }],
      recent: [
        {
          id: "e1",
          payerLineUserId: "Uanna",
          title: "หมูกระทะ",
          amountSatang: 45000,
          occurredAt: "2026-10-17T12:00:00Z",
        },
      ],
      trip: null,
      bills: [],
      names: new Map([["Uanna", "แอน"]]),
    });
    expect(text).toContain("แอน จ่าย");
    expect(text).toContain("หมูกระทะ");
  });
});
