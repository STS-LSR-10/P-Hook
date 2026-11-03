import { currentLocale, loadTimePhrases } from "@/lib/i18n";
import { EN } from "@/lib/i18n-en";
import type { LineMessage } from "@/lib/types";
import { WALLET_KIND_LABEL } from "@/lib/wallet";

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
      out[key] = SHOWN.has(key) && !keep ? translated(key, value) : value;
    } else {
      out[key] = walk(value, messageAction);
    }
  }
  return out;
}

/**
 * Words that are also names people keep: a wallet is created with its kind's name ("เงินสด"), and
 * typed back as @name, so it is never translated.
 */
const NAMES = new Set<string>(Object.values(WALLET_KIND_LABEL));

/** A label LINE accepts: 20 characters in a quick reply, 40 on a button (its longest). */
const LABEL_MAX = 20;

/**
 * The English for one field. Shown text is translated only when it is one of the app's own fixed
 * phrases (made when the code loaded): a wallet, a category or an entry's title the person wrote stays
 * as written even when it happens to match a phrase. A label is the app's own, kept short for LINE.
 */
function translated(key: string, value: string): string {
  if ((key === "text" || key === "altText") && (!loadTimePhrases.has(value) || NAMES.has(value))) {
    return value;
  }
  const en = EN[value] ?? value;
  return key === "label" && en !== value ? [...en].slice(0, LABEL_MAX).join("") : en;
}
