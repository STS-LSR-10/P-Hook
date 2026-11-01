import type { Plan } from "@/lib/plan";

export const MAX_NOTE_LENGTH = 2000;

/** Notes a plan may keep (a cost / bloat guard; reading and deleting never need a plan). */
const NOTE_LIMIT: Record<Plan, number> = { free: 30, plus: 500, ultimate: 2000 };
export const noteCapacity = (plan: Plan): number => NOTE_LIMIT[plan];

/** A note as the web app receives it. */
export interface NoteDto {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const URL_RE = /https?:\/\/[^\s<>"'()]+/i;

/** The first web link in a note. Only http and https, so opening one can never run anything. */
export const firstUrl = (body: string): string | null =>
  URL_RE.exec(body)?.[0]?.replace(/[.,;:!?]+$/, "") ?? null;

/** Tidy what was typed: normalised line breaks, no trailing spaces, no blank edges. */
export function cleanNoteBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First line, shortened: what a list shows as the note's title. */
export function noteTitle(body: string, max = 40): string {
  const first = (body.split("\n")[0] ?? "").trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
