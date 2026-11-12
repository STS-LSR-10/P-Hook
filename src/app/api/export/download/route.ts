import { tokenSecrets } from "@/lib/auth/keys";
import { verifyExportToken } from "@/lib/auth/export-token";
import { MAX_EXPORT_ROWS } from "@/lib/config";
import { TX_SELECT, toTxDto } from "@/lib/dto";
import { buildZip, collectAttachments, type AttachmentSource } from "@/lib/export/attachments";
import { toCsv } from "@/lib/export/csv";
import { buildPdf } from "@/lib/export/pdf";
import { exportDate, type ExportRow } from "@/lib/export/rows";
import { buildXlsx } from "@/lib/export/xlsx";
import { can } from "@/lib/plan";
import { loadCategories } from "@/lib/repo";
import { formatThaiDate } from "@/lib/thai-date";
import { getPlanInfo } from "@/lib/plan-server";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyTxFilters } from "@/lib/tx-query";
import { DEFAULT_WALLET_NAME } from "@/lib/wallet";
import { listWallets } from "@/lib/wallet-repo";
import { listTransfers } from "@/lib/transfer-repo";
import { log } from "@/lib/log";
import { enterCurrency, enterZone, withZoneScope } from "@/lib/zone-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TYPE_OF = {
  csv: "text/csv; charset=utf-8",
  xlsx: XLSX_TYPE,
  pdf: "application/pdf",
} as const;

/** GET /api/export/download?t=<token> — the file itself. The signed token is the credential. */
export async function GET(request: Request): Promise<Response> {
  // the file's dates are in the zone of the person who asked for it (carried by the link)
  return withZoneScope(() => download(request));
}

async function download(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return new Response("ลิงก์ไม่ถูกต้อง", { status: 400 });

  try {
    const claims = await verifyExportToken(token, tokenSecrets());
    if (!claims) {
      return new Response("ลิงก์หมดอายุแล้ว กลับไปกดส่งออกใหม่อีกครั้งนะ", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    enterZone(claims.tz);
    enterCurrency(claims.cur);
    const db = getAdminClient();
    const wallets = await listWallets(db, claims.userId);
    const defaultWallet = wallets.find((w) => w.isDefault);
    const query = applyTxFilters(
      db
        .from("transactions")
        .select(TX_SELECT)
        .eq("user_id", claims.userId)
        .eq("status", "confirmed"),
      claims.filters,
      { defaultAccountId: defaultWallet?.id ?? null },
    )
      .order("occurred_at", { ascending: true })
      .limit(MAX_EXPORT_ROWS);
    const { data, error } = await query;
    if (error) throw new Error(`export query: ${error.message}`);

    const raw = (data ?? []) as {
      id: string;
      slip_id: string | null;
      photo_path: string | null;
    }[];
    const rows: ExportRow[] = raw.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = toTxDto(r as any);
      return {
        date: new Date(tx.occurredAt),
        type: tx.type,
        title: tx.title,
        categoryName: tx.categoryName,
        amountSatang: tx.amountSatang,
        source: tx.source,
        // an entry with no wallet is in the main wallet
        walletName: tx.accountName ?? defaultWallet?.name ?? DEFAULT_WALLET_NAME,
        origCurrency: tx.origCurrency,
        origAmountMinor: tx.origAmountMinor,
        fxRate: tx.fxRate,
      };
    });

    const now = new Date();
    const stamp = exportDate(now).replaceAll("-", "");
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const f = claims.filters;
    const { plan } = await getPlanInfo(db, claims.userId);

    // the link was signed a moment ago, but the plan is checked again: PDF is for Elite only
    if (claims.format === "pdf" && !can(plan, "pdfExport")) {
      return new Response("pdf export needs the Elite plan", { status: 403, headers });
    }

    let main: { name: string; bytes: Uint8Array };
    if (claims.format === "csv") {
      main = {
        name: `phook-${stamp}.csv`,
        bytes: new TextEncoder().encode(toCsv(rows, claims.groups)),
      };
    } else if (claims.format === "pdf") {
      const categories = f.categoryId ? await loadCategories(db, claims.userId) : [];
      const notes = [
        f.type ? `ประเภท: ${f.type === "income" ? "รายรับ" : "รายจ่าย"}` : null,
        f.categoryId
          ? `หมวด: ${categories.find((c) => c.id === f.categoryId)?.name ?? "ที่เลือก"}`
          : null,
        f.accountId
          ? `กระเป๋า: ${wallets.find((w) => w.id === f.accountId)?.name ?? "ที่เลือก"}`
          : null,
        f.q ? `ค้นหา: ${f.q}` : null,
      ].filter((n): n is string => n !== null);
      main = {
        name: `phook-${stamp}.pdf`,
        bytes: new Uint8Array(
          await buildPdf(rows, {
            groups: claims.groups,
            periodLabel:
              f.from || f.to
                ? `${f.from ? formatThaiDate(new Date(f.from)) : "เริ่มต้น"} – ${
                    f.to ? formatThaiDate(new Date(new Date(f.to).getTime() - 1)) : "ปัจจุบัน"
                  }`
                : "ทุกช่วงเวลา",
            notes,
            generatedAt: now,
          }),
        ),
      };
    } else {
      // The plan is checked now (not trusted from the token): Plus adds the summary sheets.
      // transfers have no type/category/tag/text/wallet, so those filters leave them out
      const transfers =
        f.type || f.categoryId || f.q || f.tag || f.accountId
          ? []
          : (await listTransfers(db, claims.userId, MAX_EXPORT_ROWS)).filter(
              (t) =>
                (!f.from || new Date(t.occurredAt) >= new Date(f.from)) &&
                (!f.to || new Date(t.occurredAt) < new Date(f.to)),
            );
      const file = await buildXlsx(rows, {
        advanced: can(plan, "advancedExport"),
        transfers,
        groups: claims.groups,
      });
      main = { name: `phook-${stamp}.xlsx`, bytes: new Uint8Array(file) };
    }

    // the slip pictures and photos go in a zip with the file (the plan is checked again here)
    if (claims.attachments && can(plan, "advancedExport")) {
      const sources: AttachmentSource[] = raw.map((r, i) => ({
        date: (rows[i] as ExportRow).date,
        title: (rows[i] as ExportRow).title,
        slipId: r.slip_id,
        photoPath: r.photo_path,
      }));
      const { files, skipped } = await collectAttachments(db, claims.userId, sources);
      const zip = buildZip({ name: main.name, data: main.bytes }, files, skipped);
      return new Response(new Uint8Array(zip), {
        headers: {
          ...headers,
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="phook-${stamp}.zip"`,
        },
      });
    }

    return new Response(new Uint8Array(main.bytes), {
      headers: {
        ...headers,
        "Content-Type": TYPE_OF[claims.format],
        "Content-Disposition": `attachment; filename="${main.name}"`,
      },
    });
  } catch (error) {
    log.error("export_failed", error);
    return new Response("ส่งออกไม่สำเร็จ ลองใหม่อีกครั้งนะ", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
