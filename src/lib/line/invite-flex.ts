import { THEMES } from "@/lib/personalize";
import { t } from "@/lib/i18n";
import type { LineMessage } from "@/lib/types";

/** Plain-text version of the invitation: the text-link fallback and the card's alt text. */
export const inviteText = (code: string, link: string): string =>
  `${t(
    'มาจดรายรับรายจ่ายง่าย ๆ ในไลน์กับพี่ฮูก (P\'Hook) ด้วยกันนะ เพิ่มเพื่อนแล้วพิมพ์ "ใช้รหัส {0}" ทั้งคู่ได้โบนัสฮูกคอยน์',
    code,
  )}\n${link}`;

/**
 * The invitation as a Flex card for the share picker: the owl on top, the code, and an add-friend
 * button. The whole card opens the add-friend page too, so a tap anywhere gets the friend there.
 */
export function buildInviteFlex(input: {
  code: string;
  addFriendLink: string;
  /** Public https address of the picture. */
  imageUrl: string;
}): LineMessage {
  const p = THEMES.mint.palette;
  const open = { type: "uri", uri: input.addFriendLink };
  return {
    type: "flex",
    altText: inviteText(input.code, input.addFriendLink),
    contents: {
      type: "bubble",
      size: "mega",
      action: open,
      hero: {
        type: "image",
        url: input.imageUrl,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
        backgroundColor: "#FFFFFF",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: t("มาจดรายรับรายจ่ายกับพี่ฮูกด้วยกัน"),
            weight: "bold",
            size: "lg",
            wrap: true,
            color: p.bodyDeep,
          },
          {
            type: "text",
            text: t("เพิ่มเพื่อนแล้วพิมพ์ “ใช้รหัส {0}” ทั้งคู่ได้โบนัสฮูกคอยน์", input.code),
            size: "sm",
            wrap: true,
            color: p.bodySub,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: p.primary,
            action: { ...open, label: t("เพิ่มเพื่อนพี่ฮูก") },
          },
        ],
      },
    },
  };
}
