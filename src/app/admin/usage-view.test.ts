import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@/lib/admin/activity";
import { UsageView } from "./usage-view";

// the view is compiled with the classic JSX runtime under vitest
(globalThis as { React?: typeof React }).React = React;

const rows: ActivityRow[] = [
  { grp: "reminder", kind: null, uses: 12, people: 5 },
  { grp: "reminder", kind: "reminder_chat", uses: 10, people: 4 },
  { grp: "reminder", kind: "reminder_page", uses: 2, people: 1 },
  { grp: "note", kind: null, uses: 1200, people: 30 },
];

describe("UsageView", () => {
  const html = renderToStaticMarkup(
    createElement(UsageView, {
      period: { month: "2026-11", year: "2026" },
      columns: [rows, rows, rows],
      feedbackTotal: null,
    }),
  );

  it("shows uses and people for the month, the year and everything", () => {
    expect(html).toContain("พ.ย. 2569");
    expect(html).toContain("ปี 2569");
    expect(html).toContain("1,200");
    expect(html).toMatch(/12<\/span><span[^>]*> ครั้ง · 5 คน/);
  });

  it("lists only the ways that were used, and zero for groups not used", () => {
    expect(html).toContain("แชท");
    expect(html).toContain("หน้าเว็บ");
    expect(html).not.toContain("ก่อนเริ่มแยกช่องทาง");
    expect(html).toContain("เก็บรูป");
  });

  it("says so when it could not load", () => {
    const failed = renderToStaticMarkup(
      createElement(UsageView, {
        period: { month: "2026-11", year: "2026" },
        columns: null,
        feedbackTotal: null,
      }),
    );
    expect(failed).toContain("โหลดจำนวนการใช้งานไม่สำเร็จ");
  });
});
