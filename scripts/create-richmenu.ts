/**
 * Create and publish the P'Hook Rich Menu.
 *
 *   pnpm richmenu --dry-run     render assets/richmenu.jpg only (no network)
 *   pnpm richmenu               create the menu, upload the image, set it as default
 *   pnpm richmenu --replace     same, but first delete earlier "phook-main" / "jodtang-main" / "meetang-main" menus
 *
 * Reads LINE_CHANNEL_ACCESS_TOKEN and NEXT_PUBLIC_LIFF_ID from .env.local (or the environment).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  ART_CROP,
  ART_FILE,
  ART_WIDTH,
  PASTEL,
  RICH_MENU_HEIGHT,
  RICH_MENU_WIDTH,
  TILES,
  type TileKey,
} from "./richmenu-design";

const MENU_NAME = "phook-main";
// --replace also removes menus published before the rename.
const REPLACEABLE_NAMES = new Set([MENU_NAME, "jodtang-main", "meetang-main"]);
const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";
const IMAGE_PATH = resolve("assets/richmenu.jpg");

// Tiles that open a LIFF page: tile key -> path (LIFF appends it to the endpoint URL)
const LIFF_PAGES: Partial<Record<TileKey, string>> = {
  summary: "summary",
  remind: "reminders",
  note: "notes",
  settings: "settings",
  invite: "invite",
  upgrade: "upgrade",
};

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function renderImage(): Promise<Buffer> {
  // the picture, cut to the menu's proportions and brought to its size (LINE takes up to 1 MB)
  const jpg = await sharp(resolve(ART_FILE))
    .extract({ left: 0, top: ART_CROP.top, width: ART_WIDTH, height: ART_CROP.height })
    .resize(RICH_MENU_WIDTH, RICH_MENU_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .modulate({ saturation: PASTEL.saturation, brightness: PASTEL.brightness })
    .linear(PASTEL.contrast, PASTEL.lift)
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  if (jpg.length > 1_000_000) fail(`image is ${jpg.length} bytes; LINE's limit is 1 MB`);
  await mkdir(dirname(IMAGE_PATH), { recursive: true });
  await writeFile(IMAGE_PATH, jpg);
  console.log(`✓ rendered ${IMAGE_PATH} (${Math.round(jpg.length / 1024)} KB)`);
  return jpg;
}

async function line(
  token: string,
  url: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body });
  if (!res.ok) {
    // LINE error bodies describe the request, not secrets
    fail(`${init.method ?? "GET"} ${new URL(url).pathname} → ${res.status} ${await res.text()}`);
  }
  return res;
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on variables already in the environment
  }
  const args = new Set(process.argv.slice(2));
  const image = await renderImage();
  if (args.has("--dry-run")) return;

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!token) fail("LINE_CHANNEL_ACCESS_TOKEN is not set (.env.local)");
  if (!liffId) fail("NEXT_PUBLIC_LIFF_ID is not set (.env.local)");
  // A real token is plain ASCII with no spaces; anything else is usually a leftover placeholder.
  if (!/^[\x21-\x7E]+$/.test(token)) {
    fail(
      "LINE_CHANNEL_ACCESS_TOKEN has spaces or non-ASCII characters — is it still a placeholder?",
    );
  }
  if (!/^[\x21-\x7E]+$/.test(liffId)) {
    fail("NEXT_PUBLIC_LIFF_ID has spaces or non-ASCII characters — is it still a placeholder?");
  }

  if (args.has("--replace")) {
    const list = (await (await line(token, `${API}/richmenu/list`)).json()) as {
      richmenus: { richMenuId: string; name: string }[];
    };
    for (const m of list.richmenus.filter((r) => REPLACEABLE_NAMES.has(r.name))) {
      await line(token, `${API}/richmenu/${m.richMenuId}`, { method: "DELETE" });
      console.log(`✓ deleted old menu ${m.richMenuId}`);
    }
  }

  const compose = {
    type: "postback",
    label: "จดรายการ",
    // Silent postback (no displayText): the bot answers with the how-to card, whose button opens
    // the keyboard. Nothing is prefilled in the input box.
    data: "a=compose",
  };
  const liffUrl = `https://liff.line.me/${liffId}`;

  const actionFor = (key: TileKey, label: string): Record<string, unknown> => {
    const page = LIFF_PAGES[key];
    if (page) return { type: "uri", label, uri: `${liffUrl}/${page}` };
    switch (key) {
      case "compose":
        return compose;
      case "scan":
        // opens the phone camera at once; the picture then arrives as an ordinary image message and
        // the bot checks the plan (Free: 3 a week, then the upgrade card)
        return { type: "uri", label, uri: "line://nv/camera/" };
      case "help":
        // sends "วิธีใช้งาน" as the user's message; the bot asks what they want to know (topic chips)
        return { type: "message", label, text: "วิธีใช้งาน" };
      case "ask":
        // sends "ถามพี่ฮูก" as the user's message; the bot opens the ask mode (example questions)
        return { type: "message", label, text: "ถามพี่ฮูก" };
      default:
        return { type: "uri", label, uri: `${liffUrl}/summary` };
    }
  };

  const areas = TILES.map((tile) => ({
    bounds: tile.bounds,
    action: actionFor(tile.key, tile.label),
  }));

  const created = (await (
    await line(token, `${API}/richmenu`, {
      method: "POST",
      json: {
        size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
        selected: true,
        name: MENU_NAME,
        chatBarText: "เมนู",
        areas,
      },
    })
  ).json()) as { richMenuId: string };
  console.log(`✓ created ${created.richMenuId}`);

  await line(token, `${API_DATA}/richmenu/${created.richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(image),
  });
  console.log("✓ uploaded image");

  await line(token, `${API}/user/all/richmenu/${created.richMenuId}`, { method: "POST" });
  console.log("✓ set as default Rich Menu for all users");
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : "unknown error"));
