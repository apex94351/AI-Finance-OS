import { AppShell } from "@/database/components/app-shell";
import { ContactWorkspace } from "@/database/components/contacts/contact-workspace";
import { loadContactWorkspace } from "@/app/contacts/data";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { contact } = await searchParams;
  const data = await loadContactWorkspace("customers", contact ?? null, "/clients");
  return (
    <AppShell pageTitle="customers">
      <ContactWorkspace
        kind="customers"
        {...data}
        selectedContactId={contact ?? null}
        routeBase="/clients"
      />
    </AppShell>
  );
}
