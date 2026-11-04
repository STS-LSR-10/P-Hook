import { currentLocale, t } from "@/lib/i18n";

/** LINE's own link that brings the app to the front, where the chat is. */
export const BACK_TO_LINE_URL = "https://line.me/R/";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * A small page in the phone's own browser, for the steps of signing in with Google (they cannot
 * happen inside LINE). Plain HTML, in พี่ฮูก's colours, readable at 360px, light and dark.
 */
export function googlePage(input: {
  title: string;
  message: string;
  /** The main button. */
  action: { label: string; href: string };
  ok?: boolean;
  status?: number;
}): Response {
  const icon = input.ok === false ? "⚠️" : "📅";
  const html = `<!doctype html>
<html lang="${currentLocale()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(input.title)}</title>
<style>
:root{--bg:#F4FBF8;--card:#fff;--text:#0F2A24;--muted:#4B635D;--primary:#0F766E}
@media (prefers-color-scheme:dark){:root{--bg:#0B1513;--card:#13211E;--text:#E6F2EF;--muted:#9FB5AF;--primary:#2DD4BF}}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Noto Sans Thai",sans-serif}
main{max-width:420px;margin:0 auto;padding:48px 16px}
section{background:var(--card);border-radius:24px;padding:24px 20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.icon{font-size:40px}h1{font-size:20px;margin:12px 0 8px}p{color:var(--muted);font-size:15px;line-height:1.6;margin:0 0 20px}
a.btn{display:block;background:var(--primary);color:#fff;text-decoration:none;font-weight:600;border-radius:16px;padding:14px}
</style></head>
<body><main><section>
<div class="icon" aria-hidden="true">${icon}</div>
<h1>${escape(input.title)}</h1>
<p>${escape(input.message)}</p>
<a class="btn" href="${escape(input.action.href)}">${escape(input.action.label)}</a>
</section></main></body></html>`;
  return new Response(html, {
    status: input.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}

/** Back to the chat. */
export const backToLine = () => ({ label: t("กลับไปที่ไลน์"), href: BACK_TO_LINE_URL });
