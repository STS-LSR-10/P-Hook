import { describe, expect, it } from "vitest";
import {
  cleanFileName,
  defaultFileName,
  fileCapacity,
  fileDayLimit,
  isBlockedFile,
  MAX_FILE_BYTES,
  MAX_NAME_LENGTH,
} from "./file";

describe("file rules", () => {
  it.each(["setup.exe", "APP.APK", "x.msi", "run.bat", "a.b.sh", " tool.exe "])("blocks %s", (n) =>
    expect(isBlockedFile(n)).toBe(true),
  );
  it.each(["สัญญาเช่า.pdf", "photo.jpg", "exe", "notes.exe.txt"])("allows %s", (n) =>
    expect(isBlockedFile(n)).toBe(false),
  );

  it("allows 20 MB a file", () => expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024));

  it("gives each plan its space", () => {
    expect(fileCapacity("free")).toBe(500 * 1024 * 1024);
    expect(fileCapacity("plus")).toBe(5 * 1024 ** 3);
    expect(fileCapacity("ultimate")).toBe(50 * 1024 ** 3);
  });

  it("gives each plan its daily number", () => {
    expect((["free", "plus", "ultimate"] as const).map(fileDayLimit)).toEqual([20, 100, 200]);
  });

  it("tidies a name", () => expect(cleanFileName('  a\n"b"\t.pdf  ')).toBe('a "b" .pdf'));

  it("keeps the extension when cutting a long name", () => {
    const n = cleanFileName(`${"ก".repeat(300)}.pdf`);
    expect(n).toHaveLength(MAX_NAME_LENGTH);
    expect(n.endsWith(".pdf")).toBe(true);
  });

  it("names a picture by its time in Bangkok", () => {
    expect(defaultFileName("image", new Date("2026-11-01T12:30:00Z"))).toBe(
      "รูป 1 พ.ย. 2569 19:30",
    );
  });

  it("names a video and a file by kind", () => {
    const at = new Date("2026-11-01T12:30:00Z");
    expect(defaultFileName("video", at)).toMatch(/^วิดีโอ /);
    expect(defaultFileName("file", at)).toMatch(/^ไฟล์ /);
  });
});
