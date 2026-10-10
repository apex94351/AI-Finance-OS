import { AppShell } from "@/database/components/app-shell";
import { ContactWorkspace } from "@/database/components/contacts/contact-workspace";
import { loadContactWorkspace } from "@/app/contacts/data";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const data = await loadContactWorkspace("suppliers", contact ?? null);
  return (
    <AppShell pageTitle="suppliers">
      <ContactWorkspace kind="suppliers" {...data} selectedContactId={contact ?? null} />
    </AppShell>
  );
}
