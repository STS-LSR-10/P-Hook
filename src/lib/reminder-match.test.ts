import { describe, expect, it } from "vitest";
import { matchReminders } from "./reminder-match";

const r = (body: string) => ({
  id: body,
  body,
  remindAt: "2026-11-02T11:00:00Z",
  repeat: null,
  status: "active" as const,
  category: null,
});

describe("matchReminders", () => {
  it("finds a reminder containing the query", () => {
    const found = matchReminders([r("กินยาเย็น"), r("จ่ายค่าไฟ")], "กินยา");
    expect(found.map((x) => x.body)).toEqual(["กินยาเย็น"]);
  });

  it("finds it when the query is the longer one", () => {
    expect(matchReminders([r("กินยา")], "กินยาเย็น")).toHaveLength(1);
  });

  it("ignores case and spacing", () => {
    expect(matchReminders([r("Call Mom")], "callmom")).toHaveLength(1);
  });

  it("returns all the matches", () => {
    expect(matchReminders([r("กินยาเช้า"), r("กินยาเย็น")], "กินยา")).toHaveLength(2);
  });

  it("returns nothing for an empty query", () => {
    expect(matchReminders([r("กินยา")], "  ")).toEqual([]);
  });
});
