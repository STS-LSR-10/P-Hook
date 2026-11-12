import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { loadCategories } from "@/lib/repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

/** POST /api/categories/reorder { ids } — ids in the desired display order. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const { ids } = parsed.data;
    if (new Set(ids).size !== ids.length) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const db = getAdminClient();
    const visible = new Map((await loadCategories(db, auth.userId)).map((c) => [c.id, c]));
    if (ids.some((id) => !visible.has(id))) return apiError("ไม่พบหมวดบางรายการ", 404);

    for (const [index, id] of ids.entries()) {
      const sortOrder = index + 1;
      const category = visible.get(id);
      if (!category) continue;
      if (category.user_id === auth.userId) {
        const { error } = await db
          .from("categories")
          .update({ sort_order: sortOrder })
          .eq("id", id)
          .eq("user_id", auth.userId);
        if (error) throw new Error(`reorder: ${error.message}`);
      } else {
        const { error } = await db
          .from("category_overrides")
          .upsert(
            { user_id: auth.userId, category_id: id, sort_order: sortOrder },
            { onConflict: "user_id,category_id" },
          );
        if (error) throw new Error(`reorder override: ${error.message}`);
      }
    }
    return json({ ok: true });
  });
}
