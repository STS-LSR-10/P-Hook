import type { LineMessage } from "@/lib/types";

/** A person tagged in a group message ("@แอน"), or everyone ("@All"), by the text that tags them. */
export interface Mention {
  label: string;
  userId?: string;
  all?: boolean;
}

/** What LINE says about each tag in a text message. */
export interface LineMentionee {
  index: number;
  length: number;
  type: string;
  userId?: string;
  isSelf?: boolean;
}

/**
 * The text of a group message with a tag of พี่ฮูก in front taken off ("@พี่ฮูก เตือน …" is read as
 * "เตือน …"), the people it tags (พี่ฮูก itself never counts), and whether พี่ฮูก was tagged at all
 * (`called`: the message is for the bot, wherever the tag stands).
 */
export function readMentions(
  text: string,
  mentionees: LineMentionee[] | undefined,
): { text: string; mentions: Mention[]; called: boolean } {
  const fits = (m: LineMentionee) =>
    Number.isInteger(m.index) && m.index >= 0 && m.length > 0 && m.index + m.length <= text.length;
  const tags = (mentionees ?? []).filter(fits);
  const mentions: Mention[] = tags
    .filter((m) => !m.isSelf)
    .flatMap((m): Mention[] => {
      const label = text.slice(m.index, m.index + m.length);
      if (m.type === "all") return [{ label, all: true }];
      return m.type === "user" && m.userId ? [{ label, userId: m.userId }] : [];
    });
  const self = tags.find((m) => m.isSelf && m.index === 0);
  return {
    text: self ? text.slice(self.length).trim() : text,
    mentions,
    called: tags.some((m) => m.isSelf),
  };
}

/**
 * A message that tags each person where their name stands in `text` (the first place not already
 * taken). Braces people typed become full-width, so they are never read as a tag. A plain text
 * message when no name is found.
 */
export function mentionedMessage(text: string, mentions: Mention[]): LineMessage {
  let out = text.replace(/\{/g, "｛").replace(/\}/g, "｝");
  const substitution: Record<string, unknown> = {};
  let from = 0;
  mentions.forEach((m, i) => {
    const at = out.indexOf(m.label, from);
    if (at < 0) return;
    const key = `m${i}`;
    out = `${out.slice(0, at)}{${key}}${out.slice(at + m.label.length)}`;
    from = at + key.length + 2;
    substitution[key] = {
      type: "mention",
      mentionee: m.all ? { type: "all" } : { type: "user", userId: m.userId },
    };
  });
  if (Object.keys(substitution).length === 0) return { type: "text", text };
  return { type: "textV2", text: out, substitution };
}
