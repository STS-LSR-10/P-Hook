import { describe, expect, it } from "vitest";
import {
  cleanFileName,
  contentDisposition,
  defaultFileName,
  extensionOfType,
  fileCapacity,
  fileDayLimit,
  formatBytes,
  isBlockedFile,
  MAX_FILE_BYTES,
  MAX_NAME_LENGTH,
  withExtensionOf,
} from "./file";

describe("contentDisposition", () => {
  it("keeps a Thai name", () => {
    expect(contentDisposition("สัญญา.pdf")).toContain("filename*=UTF-8''%E0%B8%AA");
  });
  it("has a plain name for old clients", () => {
    expect(contentDisposition("สัญญา.pdf")).toMatch(/^attachment; filename="[\x20-\x7e]+";/);
  });
  it("cannot break the header", () => {
    const value = contentDisposition('a"\r\nX: y.pdf');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.split(";")[1]).not.toContain('a"');
  });
  it("encodes quotes in the long form", () => {
    expect(contentDisposition("it's.pdf")).toContain("it%27s.pdf");
  });
});

describe("extensionOfType", () => {
  it.each([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
    ["video/mp4", ".mp4"],
    ["video/quicktime", ".mov"],
    ["application/octet-stream", ""],
  ])("%s gives %s", (type, ext) => expect(extensionOfType(type)).toBe(ext));
});

describe("formatBytes", () => {
  it.each([
    [512 * 1024, "512 KB"],
    [12 * 1024 * 1024, "12 MB"],
    [1.5 * 1024 ** 3, "1.5 GB"],
    [500 * 1024 * 1024, "500 MB"],
    [10, "1 KB"],
  ])("%d is %s", (n, label) => expect(formatBytes(n)).toBe(label));
});

describe("withExtensionOf", () => {
  it("adds the extension of the real file", () => {
    expect(withExtensionOf("สัญญา", "a.pdf")).toBe("สัญญา.pdf");
  });
  it("leaves a name that has one", () => {
    expect(withExtensionOf("สัญญา.PDF", "a.pdf")).toBe("สัญญา.PDF");
  });
  it("leaves a name when the file has none", () => {
    expect(withExtensionOf("บัตร", "รูป 1 พ.ย. 2569 19:30")).toBe("บัตร");
  });
});

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
