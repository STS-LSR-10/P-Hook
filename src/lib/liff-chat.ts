/** The parts of the LIFF SDK the check needs. */
interface LiffLike {
  isInClient: () => boolean;
  getContext: () => { type: string } | null;
}

/**
 * Whether the page can write into the chat it was opened from (liff.sendMessages): in LINE, opened
 * from a 1:1 chat, a group or a room. Not `liff.isApiAvailable("sendMessages")`: the SDK does not know
 * that name and throws "Unexpected API name.".
 */
export function canSendToChat(liff: LiffLike): boolean {
  if (!liff.isInClient()) return false;
  const type = liff.getContext()?.type;
  return type === "utou" || type === "group" || type === "room";
}
