import type { LineMessage } from "@/lib/types";

const API = "https://api.line.me/v2/bot";

export interface LineProfile {
  displayName?: string;
  pictureUrl?: string;
}

export function createLineClient(accessToken: string) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  return {
    /** Reply (max 5 messages). Throws with the HTTP status only — never the payload. */
    async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
      const res = await fetch(`${API}/message/reply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
      });
      if (!res.ok) throw new Error(`LINE reply failed: ${res.status}`);
    },

    /**
     * The "bot is typing" dots in a 1:1 chat. Free (no quota); LINE removes them as soon as the bot
     * replies, or after `seconds` (5-60). Best effort: a failure only means no dots.
     */
    async showLoading(lineUserId: string, seconds = 20): Promise<void> {
      const res = await fetch(`${API}/chat/loading/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatId: lineUserId, loadingSeconds: seconds }),
      });
      if (!res.ok) throw new Error(`LINE loading failed: ${res.status}`);
    },

    /** Push (outside a reply). Counts against the OA's monthly push quota — use sparingly. */
    async push(lineUserId: string, messages: LineMessage[]): Promise<void> {
      const res = await fetch(`${API}/message/push`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: lineUserId, messages: messages.slice(0, 5) }),
      });
      if (!res.ok) throw new Error(`LINE push failed: ${res.status}`);
    },

    /** A member's profile in a group (the person does not have to be a friend of the bot). */
    async getGroupMemberProfile(groupId: string, lineUserId: string): Promise<LineProfile | null> {
      const res = await fetch(
        `${API}/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(lineUserId)}`,
        { headers },
      );
      if (!res.ok) return null;
      return (await res.json()) as LineProfile;
    },

    /**
     * A group's name as its members see it, or null when LINE does not say (the bot left it). Gives up
     * after 3 seconds, since a page waits on it.
     */
    async getGroupName(groupId: string): Promise<string | null> {
      const res = await fetch(`${API}/group/${encodeURIComponent(groupId)}/summary`, {
        headers,
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { groupName?: string };
      return body.groupName ?? null;
    },

    /** How many members a group has (any account may ask), or null when LINE does not say. */
    async getGroupMemberCount(groupId: string): Promise<number | null> {
      const res = await fetch(`${API}/group/${encodeURIComponent(groupId)}/members/count`, {
        headers,
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { count?: number };
      return typeof body.count === "number" ? body.count : null;
    },

    /**
     * Every member id of a group. LINE allows this only for verified / premium accounts: for any other
     * (or when the call fails) it returns null and the caller carries on with the members it knows.
     */
    async listGroupMemberIds(groupId: string): Promise<string[] | null> {
      const ids: string[] = [];
      let start: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await fetch(
          `${API}/group/${encodeURIComponent(groupId)}/members/ids${start ? `?start=${encodeURIComponent(start)}` : ""}`,
          { headers },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { memberIds?: string[]; next?: string };
        ids.push(...(body.memberIds ?? []));
        if (!body.next) break;
        start = body.next;
      }
      return ids;
    },

    async getProfile(lineUserId: string): Promise<LineProfile | null> {
      const res = await fetch(`${API}/profile/${encodeURIComponent(lineUserId)}`, { headers });
      if (!res.ok) return null;
      return (await res.json()) as LineProfile;
    },
  };
}

export type LineClient = ReturnType<typeof createLineClient>;
