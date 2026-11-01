import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps the app movable between hosts (Cloudflare Workers today, Vercel before; either can host it): server code
 * may only use the Node modules that Workers' Node compatibility supports, and nothing from Vercel.
 * See docs/CLOUDFLARE-MIGRATION.md. If a new import fails here, check it against the Workers Node.js
 * compatibility list before adding it to ALLOWED_NODE.
 */
const ALLOWED_NODE = new Set(["node:crypto"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = sourceFiles(join(process.cwd(), "src"));

describe("the app stays portable", () => {
  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("uses only Node modules that Cloudflare Workers supports", () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /from\s+["'](node:[a-z/_]+)["']|require\(["'](node:[a-z/_]+)["']\)/g,
      )) {
        const mod = m[1] ?? m[2] ?? "";
        if (!ALLOWED_NODE.has(mod)) bad.push(`${file}: ${mod}`);
      }
      // bare names of core modules (no "node:" prefix)
      for (const m of text.matchAll(
        /from\s+["'](fs|path|child_process|zlib|os|net|http|https|stream|worker_threads)["']/g,
      )) {
        bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has nothing tied to Vercel and no edge-runtime-only routes", () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/@vercel\/|process\.env\.VERCEL|VERCEL_URL|edge-config/.test(text)) bad.push(file);
      if (/export const runtime\s*=\s*["']edge["']/.test(text)) bad.push(`${file}: edge runtime`);
    }
    expect(bad).toEqual([]);
  });
});
