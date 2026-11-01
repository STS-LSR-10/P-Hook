import { normalizeThaiDigits } from "@/lib/parse/thai-number";

const SECRET_WORD_RE = /รหัส|พาสเวิร์ด|password|passcode|\bpin\b|\botp\b|\bpwd\b/i;
/** A national ID (13 digits) or a card number (16 digits), with or without separators. */
const ID_NUMBER_RE = /(?<!\d)(?:\d{13}|\d{16})(?!\d)/;

/** Text that may hold a password or an ID number: it stays away from the AI. */
export function looksSecret(text: string): boolean {
  const normalized = normalizeThaiDigits(text);
  if (SECRET_WORD_RE.test(normalized)) return true;
  return ID_NUMBER_RE.test(normalized.replace(/(?<=\d)[\s-]+(?=\d)/g, ""));
}
