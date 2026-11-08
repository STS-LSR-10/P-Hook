import { describe, expect, it } from "vitest";
import { feedbackHref } from "./feedback-view";

describe("feedbackHref", () => {
  it("leaves out filters that are 'all' and the first page", () => {
    expect(feedbackHref({ source: "all", plan: "all", page: 1 })).toBe("/admin/feedback");
  });
  it("keeps what narrows the list, and the page past the first", () => {
    expect(feedbackHref({ source: "line", plan: "all", page: 1 })).toBe(
      "/admin/feedback?source=line",
    );
    expect(feedbackHref({ source: "app", plan: "ultimate", page: 3 })).toBe(
      "/admin/feedback?source=app&plan=ultimate&page=3",
    );
  });
});
