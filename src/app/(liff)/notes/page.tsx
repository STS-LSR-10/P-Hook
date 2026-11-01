import { redirect } from "next/navigation";

/** Notes live in the vault now; the Rich Menu and links in the chat still arrive here. */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(`/vault?tab=note${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}
