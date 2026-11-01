import type { FileDto } from "@/lib/file";
import { formatBytes } from "@/lib/file";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

const MAX_LISTED = 5;

function card(input: {
  altText: string;
  title: string;
  lines: string[];
  hint?: string;
  button?: { label: string; uri: string };
}): LineMessage {
  return {
    type: "flex",
    altText: input.altText,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "14px",
        contents: [
          { type: "text", text: input.title, weight: "bold", size: "lg", color: "#0B5D4F" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          ...input.lines.map((line) => ({
            type: "text",
            text: line,
            size: "sm",
            color: COLOR.text,
            wrap: true,
          })),
          ...(input.hint
            ? [{ type: "text", text: input.hint, size: "xs", color: COLOR.muted, wrap: true }]
            : []),
        ],
      },
      ...(input.button
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              backgroundColor: COLOR.surface,
              contents: [
                {
                  type: "button",
                  style: "primary",
                  height: "sm",
                  color: COLOR.primary,
                  action: { type: "uri", ...input.button },
                },
              ],
            },
          }
        : {}),
    },
  };
}

/** Found files, one card each. The card opens the file through the signed-in page. */
export function buildFileResults(
  files: FileDto[],
  openUrl: (id: string) => string | undefined,
): LineMessage {
  return {
    type: "flex",
    altText: `พบ ${files.length} ไฟล์`,
    contents: {
      type: "carousel",
      contents: files.slice(0, MAX_LISTED).map((file) => {
        const uri = openUrl(file.id);
        return {
          type: "bubble",
          size: "micro",
          body: {
            type: "box",
            layout: "vertical",
            backgroundColor: COLOR.surface,
            spacing: "xs",
            contents: [
              { type: "text", text: file.name, weight: "bold", size: "sm", wrap: true },
              {
                type: "text",
                text: `${formatBytes(file.sizeBytes)} · ${formatThaiDate(new Date(file.createdAt))}`,
                size: "xxs",
                color: COLOR.muted,
                wrap: true,
              },
            ],
          },
          ...(uri
            ? {
                footer: {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: COLOR.surface,
                  contents: [
                    {
                      type: "button",
                      style: "primary",
                      height: "sm",
                      color: COLOR.primary,
                      action: { type: "uri", label: "เปิดไฟล์", uri },
                    },
                  ],
                },
              }
            : {}),
        };
      }),
    },
  };
}

/** "Kept": one file with a button that opens it, or a short list with a button to all of them. */
export function buildFilesSavedCard(input: {
  files: FileDto[];
  openUrl: (id: string) => string | undefined;
  listUrl: string | undefined;
  hint?: string;
}): LineMessage {
  const { files } = input;
  const [only] = files;
  const single = files.length === 1 && only;
  const uri = single ? input.openUrl(only.id) : input.listUrl;
  const title = single ? "เก็บไฟล์แล้ว 📁" : `เก็บแล้ว ${files.length} ไฟล์ 📁`;
  return card({
    altText: title,
    title,
    lines: files.slice(0, MAX_LISTED).map((f) => `${f.name} (${formatBytes(f.sizeBytes)})`),
    hint: input.hint,
    button: uri ? { label: single ? "เปิดไฟล์" : "ดูไฟล์ทั้งหมด", uri } : undefined,
  });
}
