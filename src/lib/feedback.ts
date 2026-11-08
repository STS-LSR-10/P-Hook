/** What a user may send to the admin as a suggestion or comment. */
export const MAX_FEEDBACK_LENGTH = 1000;

export type FeedbackSource = "line" | "app";

/** The text the way it is kept: no control characters, no long runs of blank lines, trimmed. */
export function cleanFeedback(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
