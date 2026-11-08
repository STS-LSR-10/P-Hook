"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/admin/access";
import { deleteFeedback } from "@/lib/feedback-repo";
import { getAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "/admin/feedback";

/**
 * Delete one suggestion (the form's `id`) and go back to the list the admin was on (`back`). Checked
 * again here, not only by hiding the button: a server action is a public address, so anyone but the
 * admin gets a 404. `back` is only ever the feedback list, with whatever filters and page it had.
 */
export async function deleteFeedbackAction(form: FormData): Promise<void> {
  if (!(await isAdminRequest(await headers()))) notFound();

  const id = String(form.get("id") ?? "");
  const back = String(form.get("back") ?? "");
  const to = back === LIST || back.startsWith(`${LIST}?`) ? back : LIST;
  if (UUID.test(id)) {
    await deleteFeedback(getAdminClient(), id);
    revalidatePath(LIST);
  }
  redirect(to);
}
