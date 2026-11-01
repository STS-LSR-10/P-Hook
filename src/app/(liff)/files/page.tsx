import { redirect } from "next/navigation";

/** Files live in the vault now; the buttons on cards in the chat still arrive here. */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  redirect(`/vault?tab=file${open ? `&open=${encodeURIComponent(open)}` : ""}`);
}
