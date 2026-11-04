import type { FileDto } from "@/lib/file";
import { formatBytes } from "@/lib/file";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

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
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: input.title, weight: "bold", size: "lg", color: "#0B5D4F" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
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

/** "ไฟล์ของฉัน": no list, one button to the files page. */
export function buildFilesPageCard(filesUrl: string | undefined): LineMessage {
  return card({
    altText: t("ไฟล์ของฉัน"),
    title: t("ไฟล์ของฉัน 📁"),
    lines: [t("ดู ค้นหา และจัดการไฟล์ที่เก็บไว้ได้ที่หน้าไฟล์")],
    button: filesUrl?.startsWith("https://")
      ? { label: t("เปิดหน้าไฟล์"), uri: filesUrl }
      : undefined,
  });
}

/** Found files, one card each. The card opens the file through the signed-in page. */
export function buildFileResults(
  files: FileDto[],
  openUrl: (id: string) => string | undefined,
): LineMessage {
  return {
    type: "flex",
    altText: t("พบ {0} ไฟล์", files.length),
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
                size: "xs",
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
  const title = single ? t("เก็บไฟล์แล้ว 📁") : t("เก็บแล้ว {0} ไฟล์ 📁", files.length);
  return card({
    altText: title,
    title,
    lines: files.slice(0, MAX_LISTED).map((f) => `${f.name} (${formatBytes(f.sizeBytes)})`),
    hint: input.hint,
    button: uri ? { label: single ? t("เปิดไฟล์") : t("ดูไฟล์ทั้งหมด"), uri } : undefined,
  });
}
