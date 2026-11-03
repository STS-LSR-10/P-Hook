import { currentLocale } from "@/lib/i18n";
import { EN } from "@/lib/i18n-en";
import type { LineMessage } from "@/lib/types";

/** Words the person reads: these fields of a message or card, when they are text. */
const SHOWN = new Set(["text", "altText", "label", "displayText", "title"]);

/**
 * What the bot sends, in the person's language, just before it goes to LINE. In Thai nothing
 * changes. In English, any words the dictionary knows become English: the fixed phrases written as
 * constants (they are made when the code loads, before anyone's language is known); phrases with
 * values are already English from t(). What comes back to the bot stays as it is: a message
 * button's text (a command it reads in Thai), postback data and links.
 */
export function localizeMessages(messages: LineMessage[]): LineMessage[] {
  if (currentLocale() !== "en") return messages;
  return messages.map((m) => walk(m, false) as LineMessage);
}

function walk(node: unknown, isMessageAction: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(n, false));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const messageAction = obj.type === "message" && "text" in obj && "label" in obj;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const keep = key === "text" && (messageAction || isMessageAction);
      out[key] = SHOWN.has(key) && !keep ? (EN[value] ?? value) : value;
    } else {
      out[key] = walk(value, messageAction);
    }
  }
  return out;
}
