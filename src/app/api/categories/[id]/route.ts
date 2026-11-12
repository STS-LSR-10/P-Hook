import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { parseEmoji } from "@/lib/category-emoji";
import { requireFeature } from "@/lib/plan-server";
import { loadCategories } from "@/lib/repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_NAME = "อื่นๆ";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    keywords: z.array(z.string().trim().min(1).max(30)).max(30),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    emoji: z.string().max(16).nullable(),
    isHidden: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/categories/:id
 * - own category: any field
 * - system category: keywords / isHidden / sortOrder only (stored as a per-user override)
 */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบหมวดนี้", 404);
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const patch = parsed.data;

    const db = getAdminClient();
    const category = (await loadCategories(db, auth.userId)).find((c) => c.id === id);
    if (!category) return apiError("ไม่พบหมวดนี้", 404);

    if (category.name === FALLBACK_NAME && patch.isHidden === true) {
      return apiError('ซ่อนหมวด "อื่นๆ" ไม่ได้ เพราะใช้เป็นหมวดสำรอง', 400);
    }

    if (category.user_id === auth.userId) {
      // Changing what an own category is (name, words, colour, emoji) is Pro and above;
      // hiding and reordering it stay open to everyone.
      if (
        patch.name !== undefined ||
        patch.keywords !== undefined ||
        patch.color !== undefined ||
        patch.emoji !== undefined
      ) {
        const locked = await requireFeature(db, auth.userId, "customCategory");
        if (locked) return locked;
      }
      const row: Record<string, unknown> = {};
      if (patch.emoji !== undefined) {
        const emoji = parseEmoji(patch.emoji);
        if (!emoji.ok) return apiError("เลือกอีโมจิได้ตัวเดียวเท่านั้นนะ", 400);
        row.icon = emoji.emoji ?? "tag";
      }
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.keywords !== undefined) row.keywords = patch.keywords;
      if (patch.color !== undefined) row.color = patch.color;
      if (patch.isHidden !== undefined) row.is_hidden = patch.isHidden;
      if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
      const { error } = await db
        .from("categories")
        .update(row)
        .eq("id", id)
        .eq("user_id", auth.userId);
      if (error) {
        if (error.code === "23505") return apiError("มีหมวดชื่อนี้อยู่แล้ว", 409);
        throw new Error(`update category: ${error.message}`);
      }
      return json({ ok: true });
    }

    // System category: name and color are shared, so they cannot be changed per user.
    if (patch.name !== undefined || patch.color !== undefined || patch.emoji !== undefined) {
      return apiError("หมวดมาตรฐานแก้ชื่อหรือสีไม่ได้ แต่ปรับคำค้น ซ่อน และเรียงลำดับได้นะ", 400);
    }
    const override: Record<string, unknown> = { user_id: auth.userId, category_id: id };
    if (patch.keywords !== undefined) override.keywords = patch.keywords;
    if (patch.isHidden !== undefined) override.is_hidden = patch.isHidden;
    if (patch.sortOrder !== undefined) override.sort_order = patch.sortOrder;
    const { error } = await db
      .from("category_overrides")
      .upsert(override, { onConflict: "user_id,category_id" });
    if (error) throw new Error(`save override: ${error.message}`);
    return json({ ok: true });
  });
}

/** DELETE /api/categories/:id — own categories only; their entries move to "อื่นๆ". */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบหมวดนี้", 404);

    const db = getAdminClient();
    const all = await loadCategories(db, auth.userId);
    const category = all.find((c) => c.id === id);
    if (!category) return apiError("ไม่พบหมวดนี้", 404);
    if (category.user_id !== auth.userId) {
      return apiError("หมวดมาตรฐานลบไม่ได้ แต่ซ่อนได้นะ", 400);
    }

    const fallback = all
      .filter((c) => c.type === category.type && c.name === FALLBACK_NAME)
      .sort((a, b) => Number(b.user_id !== null) - Number(a.user_id !== null))[0];

    const moved = await db
      .from("transactions")
      .update({ category_id: fallback?.id ?? null })
      .eq("user_id", auth.userId)
      .eq("category_id", id);
    if (moved.error) throw new Error(`move transactions: ${moved.error.message}`);

    const { error } = await db.from("categories").delete().eq("id", id).eq("user_id", auth.userId);
    if (error) throw new Error(`delete category: ${error.message}`);
    return json({ ok: true });
  });
}
