import { jwtVerify, SignJWT } from "jose";
import { EXPORT_LINK_TTL_SECONDS } from "@/lib/config";
import { COLUMN_GROUPS, type ColumnGroup } from "@/lib/export/columns";
import { txFilterSchema, type TxFilters } from "@/lib/tx-query";

const ISSUER = "jodtang";
const AUDIENCE = "jodtang-export";

export type ExportFormat = "csv" | "xlsx" | "pdf";
const FORMATS: readonly string[] = ["csv", "xlsx", "pdf"];

export interface ExportClaims {
  userId: string;
  format: ExportFormat;
  filters: TxFilters;
  /** The column groups to keep (all when absent). */
  groups?: ColumnGroup[];
  /** Pack the slip pictures and photos of the entries into a zip with the file. */
  attachments?: boolean;
  /** The person's time zone: the file's dates and times are in it. */
  tz?: string;
}

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * A short-lived, single-purpose token that is the whole "credential" of an export link.
 * Needed because the LINE in-app browser cannot download files, so the link is opened in the
 * phone's own browser, which has no Authorization header. It carries the user and the filters
 * (signed, so neither can be changed) and expires in two minutes.
 */
export async function signExportToken(
  claims: ExportClaims,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    fmt: claims.format,
    f: claims.filters,
    g: claims.groups,
    att: claims.attachments === true ? 1 : undefined,
    tz: claims.tz,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + EXPORT_LINK_TTL_SECONDS)
    .sign(keyOf(secret));
}

export async function verifyExportToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<ExportClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.fmt !== "string" || !FORMATS.includes(payload.fmt)) return null;
    const filters = txFilterSchema.safeParse(payload.f ?? {});
    if (!filters.success) return null;
    let groups: ColumnGroup[] | undefined;
    if (payload.g !== undefined && payload.g !== null) {
      if (
        !Array.isArray(payload.g) ||
        !payload.g.every((g) => (COLUMN_GROUPS as readonly unknown[]).includes(g))
      ) {
        return null;
      }
      groups = payload.g as ColumnGroup[];
    }
    return {
      userId: payload.sub,
      format: payload.fmt as ExportFormat,
      filters: filters.data,
      groups,
      attachments: payload.att === 1 ? true : undefined,
      tz: typeof payload.tz === "string" ? payload.tz : undefined,
    };
  } catch {
    return null;
  }
}
