import { describe, expect, it } from "vitest";
import {
  fetchLineFile,
  fetchLinePdf,
  fetchLinePreview,
  ImageError,
  inspectPdf,
  MAX_PDF_BYTES,
} from "./content";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("inspectPdf", () => {
  it("accepts a plain PDF", () => {
    expect(inspectPdf(bytes("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF"))).toBeNull();
  });
  it("rejects what is not a PDF", () => {
    expect(inspectPdf(bytes("PK\u0003\u0004 zip"))).toBe("not_pdf");
  });
  it("spots a password-protected file", () => {
    expect(inspectPdf(bytes("%PDF-1.6\ntrailer << /Encrypt 12 0 R >>"))).toBe("locked");
  });
  it("counts pages but not the /Pages tree, and refuses long files", () => {
    const page = "<< /Type /Page >>\n";
    expect(inspectPdf(bytes(`%PDF-1.4\n<< /Type /Pages >>\n${page.repeat(10)}`))).toBeNull();
    expect(inspectPdf(bytes(`%PDF-1.4\n<< /Type /Pages >>\n${page.repeat(11)}`))).toBe(
      "too_many_pages",
    );
  });
});

describe("fetchLinePdf", () => {
  it("downloads the file", async () => {
    const f = (async () => new Response(bytes("%PDF-1.4"), { status: 200 })) as typeof fetch;
    expect((await fetchLinePdf("t", "m1", f)).byteLength).toBe(8);
  });
  it("refuses a file over the limit by its declared size", async () => {
    const f = (async () =>
      new Response(bytes("%PDF"), {
        status: 200,
        headers: { "content-length": String(MAX_PDF_BYTES + 1) },
      })) as typeof fetch;
    await expect(fetchLinePdf("t", "m1", f)).rejects.toMatchObject({ reason: "too_large" });
  });
  it("fails on a bad status", async () => {
    const f = (async () => new Response("no", { status: 404 })) as typeof fetch;
    await expect(fetchLinePdf("t", "m1", f)).rejects.toBeInstanceOf(ImageError);
  });
});

describe("fetchLineFile", () => {
  const respond = (body: BodyInit | null, init: ResponseInit = {}) =>
    (async () => new Response(body, init)) as unknown as typeof fetch;

  it("refuses a declared size over 20 MB before reading", async () => {
    const res = respond("x", { headers: { "content-length": String(21 * 1024 * 1024) } });
    await expect(fetchLineFile("t", "m", res)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("refuses an actual size over 20 MB", async () => {
    const res = respond(new Uint8Array(20 * 1024 * 1024 + 1));
    await expect(fetchLineFile("t", "m", res)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("falls back to application/octet-stream", async () => {
    const res = (async () => {
      const r = new Response(new Uint8Array([1]));
      r.headers.delete("content-type");
      return r;
    }) as unknown as typeof fetch;
    await expect(fetchLineFile("t", "m", res)).resolves.toMatchObject({
      mimeType: "application/octet-stream",
    });
  });

  it("keeps the type without its parameters", async () => {
    const res = respond("x", { headers: { "content-type": "text/plain; charset=utf-8" } });
    await expect(fetchLineFile("t", "m", res)).resolves.toMatchObject({ mimeType: "text/plain" });
  });

  it("fails on an empty file", async () => {
    await expect(fetchLineFile("t", "m", respond(""))).rejects.toMatchObject({
      reason: "download_failed",
    });
  });

  it.each([404, 410])("says gone when LINE answers %i", async (status) => {
    await expect(fetchLineFile("t", "m", respond(null, { status }))).rejects.toMatchObject({
      reason: "gone",
    });
  });

  it("is a plain failure on another error", async () => {
    await expect(fetchLineFile("t", "m", respond(null, { status: 500 }))).rejects.toMatchObject({
      reason: "download_failed",
    });
  });
});

describe("fetchLinePreview", () => {
  it("asks LINE for the preview of the message", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    await expect(fetchLinePreview("t", "m1", f)).resolves.toEqual(new Uint8Array([1]));
    expect(urls[0]).toBe("https://api-data.line.me/v2/bot/message/m1/content/preview");
  });

  it("refuses what is not a picture", async () => {
    const f = (async () =>
      new Response("<svg>", {
        headers: { "content-type": "image/svg+xml" },
      })) as unknown as typeof fetch;
    await expect(fetchLinePreview("t", "m1", f)).rejects.toThrow();
  });

  it("refuses a preview over 1 MB", async () => {
    const f = (async () =>
      new Response(new Uint8Array(1024 * 1024 + 1), {
        headers: { "content-type": "image/jpeg" },
      })) as unknown as typeof fetch;
    await expect(fetchLinePreview("t", "m1", f)).rejects.toThrow();
  });

  it("fails on an error from LINE", async () => {
    const f = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await expect(fetchLinePreview("t", "m1", f)).rejects.toThrow();
  });
});
