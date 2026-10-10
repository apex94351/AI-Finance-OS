import { z } from "zod";
import type { ContactKind, ContactRecord } from "@/types/invoice";

export const contactKindSchema = z.enum(["customers", "suppliers"]);
export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Saisissez un nom ou une raison sociale.").max(200),
  email: z.union([z.literal(""), z.email("Saisissez une adresse e-mail valide.")]).transform((value) => value || null),
  phone: z.string().trim().max(60).transform((value) => value || null),
  address: z.string().trim().max(500).transform((value) => value || null),
  notes: z.string().trim().max(2000).transform((value) => value || null),
});

export type ContactInput = z.input<typeof contactInputSchema>;

export const contactRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export function mapContact(row: z.infer<typeof contactRowSchema>, kind: ContactKind): ContactRecord {
  return {
    id: row.id,
    kind,
    userId: row.user_id,
    companyId: row.company_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const contactInvoiceSchema = z.object({
  id: z.uuid(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  issue_date: z.string().nullable(),
  due_date: z.string().nullable(),
  total_ttc: z.union([
    z.number(),
    z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
  ]).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
});

export function contactPath(kind: ContactKind) {
  return `/${kind}`;
}

export type ContactSort = "name-asc" | "created-desc";

export function filterContacts(
  contacts: readonly ContactRecord[],
  query: string,
  scope: string,
  companyNames: ReadonlyMap<string, string>,
  sort: ContactSort,
): ContactRecord[] {
  const normalized = query.trim().toLocaleLowerCase("fr");
  return contacts.filter((contact) => {
    const matchesQuery = !normalized || [
      contact.name,
      contact.email,
      contact.phone,
      contact.companyId ? companyNames.get(contact.companyId) : null,
    ].some((value) => value?.toLocaleLowerCase("fr").includes(normalized));
    const matchesScope = scope === "all"
      || (scope === "personal" ? contact.companyId === null : contact.companyId === scope);
    return matchesQuery && matchesScope;
  }).sort((left, right) => sort === "name-asc"
    ? left.name.localeCompare(right.name, "fr")
    : right.createdAt.localeCompare(left.createdAt));
}
