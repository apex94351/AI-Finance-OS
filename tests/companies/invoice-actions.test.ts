import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { deleteInvoice, markInvoiceSettled, saveInvoice, updateInvoicePaymentStatus } from "@/app/invoices/actions";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const invoiceId = "123e4567-e89b-42d3-a456-426614174002";

function invoiceForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    companyId,
    invoiceNumber: "FAC-2026-001",
    clientName: "Client Exemple",
    description: "Prestation de conseil",
    subtotal: "100",
    vatRate: "20",
    issueDate: "2026-10-01",
    dueDate: "2026-10-30",
    status: "pending",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function setup({
  membership = { data: { company_id: companyId }, error: null },
  invoiceResult = { data: { id: invoiceId }, error: null },
  contactResult = { data: { id: "123e4567-e89b-42d3-a456-426614174003", name: "Client Exemple" }, error: null },
  documentResult = { data: null, error: null },
  duplicateResult,
}: {
  membership?: { data: { company_id: string } | null; error: { code: string } | null };
  invoiceResult?: { data: { id: string } | null; error: { code: string } | null };
  contactResult?: { data: { id: string; name: string } | null; error: { code: string } | null };
  documentResult?: { data: { id: string; company_id: string; category: string; deleted_at: string | null } | null; error: { code: string } | null };
  duplicateResult?: { data: { id: string } | null; error: { code: string } | null };
} = {}) {
  const membershipQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  membershipQuery.maybeSingle.mockResolvedValue(membership);

  const companyQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  companyQuery.select.mockReturnValue(companyQuery);
  companyQuery.eq.mockReturnValue(companyQuery);
  companyQuery.maybeSingle.mockResolvedValue({ data: { currency: "EUR" }, error: null });

  const contactQuery = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn() };
  contactQuery.select.mockReturnValue(contactQuery);
  contactQuery.eq.mockReturnValue(contactQuery);
  contactQuery.is.mockReturnValue(contactQuery);
  contactQuery.maybeSingle.mockResolvedValue(contactResult);

  const documentQuery = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn() };
  documentQuery.select.mockReturnValue(documentQuery);
  documentQuery.eq.mockReturnValue(documentQuery);
  documentQuery.is.mockReturnValue(documentQuery);
  documentQuery.maybeSingle.mockResolvedValue(documentResult);

  const invoiceQuery = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  invoiceQuery.insert.mockReturnValue(invoiceQuery);
  invoiceQuery.update.mockReturnValue(invoiceQuery);
  invoiceQuery.delete.mockReturnValue(invoiceQuery);
  invoiceQuery.eq.mockReturnValue(invoiceQuery);
  invoiceQuery.neq.mockReturnValue(invoiceQuery);
  invoiceQuery.in.mockReturnValue(invoiceQuery);
  invoiceQuery.is.mockReturnValue(invoiceQuery);
  invoiceQuery.select.mockReturnValue(invoiceQuery);
  if (duplicateResult) {
    invoiceQuery.maybeSingle.mockResolvedValueOnce(duplicateResult).mockResolvedValueOnce(invoiceResult);
  } else {
    invoiceQuery.maybeSingle.mockResolvedValue(invoiceResult);
  }

  from.mockImplementation((table: string) => {
    if (table === "company_members") return membershipQuery;
    if (table === "companies") return companyQuery;
    if (table === "customers" || table === "suppliers") return contactQuery;
    if (table === "documents") return documentQuery;
    return invoiceQuery;
  });
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from },
    user: { id: "123e4567-e89b-42d3-a456-426614174001" },
  });
  return { membershipQuery, companyQuery, contactQuery, documentQuery, invoiceQuery };
}

describe("invoice actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects incoherent invoice dates before Supabase access", async () => {
    const result = await saveInvoice({}, invoiceForm({ issueDate: "2026-10-30", dueDate: "2026-10-01" }));

    expect(result.error).toContain("ne peut pas précéder");
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
  });

  it("inserts computed amounts only after checking company membership", async () => {
    const { membershipQuery, companyQuery, invoiceQuery } = setup();

    const result = await saveInvoice({}, invoiceForm());

    expect(getAuthenticatedSupabase).toHaveBeenCalledWith("/invoices");
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(1, "company_id", companyId);
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(companyQuery.eq).toHaveBeenCalledWith("id", companyId);
    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: companyId,
      document_id: null,
      subtotal_ht: 100,
      vat_amount: 20,
      total_ttc: 120,
      status: "pending",
    }));
    expect(result.success).toContain("enregistrée");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
  });

  it("persists a manually selected overdue status before the due date", async () => {
    const { invoiceQuery } = setup();

    const result = await saveInvoice({}, invoiceForm({
      dueDate: "2026-12-30",
      status: "overdue",
    }));

    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "overdue" }));
    expect(result.success).toContain("enregistrée");
  });

  it("automatically persists overdue for an unpaid invoice past its due date", async () => {
    const { invoiceQuery } = setup();

    const result = await saveInvoice({}, invoiceForm({
      issueDate: "2019-12-01",
      dueDate: "2020-01-01",
      status: "pending",
    }));

    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "overdue" }));
    expect(result.success).toContain("enregistrée");
  });

  it("creates a personal invoice owned by the authenticated user without checking company membership", async () => {
    const { invoiceQuery, membershipQuery } = setup();

    const result = await saveInvoice({}, invoiceForm({ companyId: "", currency: "EUR" }));

    expect(membershipQuery.maybeSingle).not.toHaveBeenCalled();
    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: null,
      user_id: "123e4567-e89b-42d3-a456-426614174001",
      currency: "EUR",
    }));
    expect(result.success).toContain("enregistrée");
  });

  it("creates a personal invoice with a required number and persists calculated totals", async () => {
    const { invoiceQuery } = setup();

    const result = await saveInvoice({}, invoiceForm({
      companyId: "",
      currency: "EUR",
      invoiceNumber: "FAC-2026-005",
      status: "pending",
      subtotal: "0.05",
      vatRate: "10",
    }));

    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: null,
      user_id: "123e4567-e89b-42d3-a456-426614174001",
      invoice_number: "FAC-2026-005",
      subtotal_ht: 0.05,
      vat_amount: 0.01,
      total_ttc: 0.06,
      status: "pending",
    }));
    expect(result.success).toContain("enregistrée");
  });

  it("links an invoice to a verified same-company customer and uses the database contact name", async () => {
    const { contactQuery, invoiceQuery } = setup();

    const result = await saveInvoice({}, invoiceForm({
      customerId: "123e4567-e89b-42d3-a456-426614174003",
      clientName: "Nom falsifié côté navigateur",
    }));

    expect(contactQuery.select).toHaveBeenCalledWith("id, name");
    expect(contactQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(contactQuery.is).toHaveBeenCalledWith("user_id", null);
    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: "123e4567-e89b-42d3-a456-426614174003",
      supplier_id: null,
      client_name: "Client Exemple",
    }));
    expect(result.success).toContain("enregistrée");
  });

  it("creates a supplier invoice linked to a verified source document", async () => {
    const documentId = "123e4567-e89b-42d3-a456-426614174004";
    const supplierId = "123e4567-e89b-42d3-a456-426614174005";
    const { documentQuery, contactQuery, invoiceQuery } = setup({
      contactResult: { data: { id: supplierId, name: "Fournisseur Exemple" }, error: null },
      documentResult: {
        data: { id: documentId, company_id: companyId, category: "supplier_invoice", deleted_at: null },
        error: null,
      },
      duplicateResult: { data: null, error: null },
    });

    const result = await saveInvoice({}, invoiceForm({
      supplierId,
      clientName: "Nom falsifié côté navigateur",
      documentId,
    }));

    expect(documentQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(contactQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(invoiceQuery.eq).toHaveBeenCalledWith("document_id", documentId);
    expect(invoiceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      document_id: documentId,
      supplier_id: supplierId,
      client_name: "Fournisseur Exemple",
    }));
    expect(result.success).toContain("enregistrée");
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("rejects a source document from another company before inserting", async () => {
    const { invoiceQuery } = setup({
      documentResult: { data: null, error: null },
    });

    const result = await saveInvoice({}, invoiceForm({
      customerId: "123e4567-e89b-42d3-a456-426614174003",
      documentId: "123e4567-e89b-42d3-a456-426614174004",
    }));

    expect(result.error).toContain("introuvable, archivé ou inaccessible");
    expect(invoiceQuery.insert).not.toHaveBeenCalled();
  });

  it("refuses to create a second invoice for a source document", async () => {
    const documentId = "123e4567-e89b-42d3-a456-426614174004";
    const { invoiceQuery } = setup({
      documentResult: {
        data: { id: documentId, company_id: companyId, category: "customer_invoice", deleted_at: null },
        error: null,
      },
      duplicateResult: { data: { id: invoiceId }, error: null },
    });

    const result = await saveInvoice({}, invoiceForm({
      customerId: "123e4567-e89b-42d3-a456-426614174003",
      documentId,
    }));

    expect(result.error).toContain("déjà liée");
    expect(invoiceQuery.insert).not.toHaveBeenCalled();
  });

  it("requires the counterparty type to match the document classification", async () => {
    const documentId = "123e4567-e89b-42d3-a456-426614174004";
    const { invoiceQuery } = setup({
      documentResult: {
        data: { id: documentId, company_id: companyId, category: "supplier_invoice", deleted_at: null },
        error: null,
      },
    });

    const result = await saveInvoice({}, invoiceForm({
      customerId: "123e4567-e89b-42d3-a456-426614174003",
      documentId,
    }));

    expect(result.error).toContain("Associez un client ou un fournisseur correspondant");
    expect(invoiceQuery.insert).not.toHaveBeenCalled();
  });

  it("rejects a counterparty from another owner scope before writing", async () => {
    const { invoiceQuery } = setup({ contactResult: { data: null, error: null } });

    const result = await saveInvoice({}, invoiceForm({
      customerId: "123e4567-e89b-42d3-a456-426614174003",
    }));

    expect(result.error).toContain("n’est pas accessible");
    expect(invoiceQuery.insert).not.toHaveBeenCalled();
  });

  it("does not associate legacy invoices unless a party was explicitly selected", async () => {
    const { invoiceQuery } = setup();

    await saveInvoice({}, invoiceForm({ customerId: "", supplierId: "" }));

    const payload = invoiceQuery.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("customer_id");
    expect(payload).not.toHaveProperty("supplier_id");
  });

  it("does not write invoices for a company without a user membership", async () => {
    const { invoiceQuery } = setup({ membership: { data: null, error: null } });

    const result = await saveInvoice({}, invoiceForm());

    expect(result.error).toContain("n’est pas associée");
    expect(invoiceQuery.insert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates only the invoice id within the selected company", async () => {
    const { invoiceQuery } = setup();
    const formData = invoiceForm({ dueDate: "2026-10-20" });
    formData.set("invoiceId", invoiceId);

    const result = await saveInvoice({}, formData);

    expect(invoiceQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      company_id: companyId,
      due_date: "2026-10-20",
      total_ttc: 120,
    }));
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(1, "id", invoiceId);
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(2, "company_id", companyId);
    expect(invoiceQuery.is).toHaveBeenCalledWith("user_id", null);
    expect(result.success).toContain("enregistrée");
  });

  it("deletes only the selected invoice inside the selected company", async () => {
    const { invoiceQuery } = setup();

    const result = await deleteInvoice(companyId, invoiceId);

    expect(invoiceQuery.delete).toHaveBeenCalled();
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(1, "id", invoiceId);
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(2, "company_id", companyId);
    expect(invoiceQuery.is).toHaveBeenCalledWith("user_id", null);
    expect(result.success).toContain("supprimée");
    expect(revalidatePath).toHaveBeenCalledWith("/invoices");
  });

  it("updates only the personal invoice owned by the authenticated user", async () => {
    const { invoiceQuery } = setup();
    const formData = invoiceForm({ companyId: "", currency: "EUR", dueDate: "2026-10-20" });
    formData.set("invoiceId", invoiceId);

    const result = await saveInvoice({}, formData);

    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(1, "id", invoiceId);
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(invoiceQuery.is).toHaveBeenCalledWith("company_id", null);
    expect(result.success).toContain("enregistrée");
  });

  it("deletes only the personal invoice owned by the authenticated user", async () => {
    const { invoiceQuery } = setup();

    const result = await deleteInvoice(null, invoiceId);

    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(1, "id", invoiceId);
    expect(invoiceQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(invoiceQuery.is).toHaveBeenCalledWith("company_id", null);
    expect(result.success).toContain("supprimée");
  });

  it("settles a company invoice only after membership and restricts the eligible statuses", async () => {
    const { membershipQuery, invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "pending", due_date: "2026-10-30" },
      error: null,
    });

    const result = await markInvoiceSettled(companyId, invoiceId);

    expect(membershipQuery.maybeSingle).toHaveBeenCalled();
    expect(invoiceQuery.update).toHaveBeenCalledWith({ status: "paid" });
    expect(invoiceQuery.eq).toHaveBeenCalledWith("id", invoiceId);
    expect(invoiceQuery.eq).toHaveBeenCalledWith("status", "pending");
    expect(invoiceQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(invoiceQuery.is).toHaveBeenCalledWith("user_id", null);
    expect(result.success).toContain("mis à jour");
    expect(revalidatePath).toHaveBeenCalledWith("/due-dates");
  });

  it("settles a personal invoice only for the authenticated owner", async () => {
    const { membershipQuery, invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "overdue", due_date: "2026-10-01" },
      error: null,
    });

    await markInvoiceSettled(null, invoiceId);

    expect(membershipQuery.maybeSingle).not.toHaveBeenCalled();
    expect(invoiceQuery.eq).toHaveBeenCalledWith("user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(invoiceQuery.is).toHaveBeenCalledWith("company_id", null);
  });

  it("marks an overdue invoice as paid so it is no longer overdue", async () => {
    const { invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "overdue", due_date: "2026-10-01" },
      error: null,
    });

    const result = await markInvoiceSettled(companyId, invoiceId);

    expect(invoiceQuery.update).toHaveBeenCalledWith({ status: "paid" });
    expect(invoiceQuery.eq).toHaveBeenCalledWith("status", "overdue");
    expect(result.success).toContain("mis à jour");
  });

  it("persists a manual overdue choice even when its due date is in the future", async () => {
    const { invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "pending", due_date: "2026-12-30" },
      error: null,
    });

    const result = await updateInvoicePaymentStatus(companyId, invoiceId, "overdue");

    expect(invoiceQuery.update).toHaveBeenCalledWith({ status: "overdue" });
    expect(invoiceQuery.eq).toHaveBeenCalledWith("status", "pending");
    expect(result.success).toContain("mis à jour");
  });

  it("reopens a paid supplier invoice and recalculates the overdue status", async () => {
    const { invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "paid", due_date: "2026-10-01" },
      error: null,
    });

    const result = await updateInvoicePaymentStatus(companyId, invoiceId, "pending");

    expect(invoiceQuery.update).toHaveBeenCalledWith({ status: "overdue" });
    expect(invoiceQuery.eq).toHaveBeenCalledWith("status", "paid");
    expect(result.success).toContain("mis à jour");
  });

  it("reopens a paid invoice as pending when its due date has not passed", async () => {
    const { invoiceQuery } = setup();
    invoiceQuery.maybeSingle.mockResolvedValue({
      data: { status: "paid", due_date: "2026-12-30" },
      error: null,
    });

    const result = await updateInvoicePaymentStatus(companyId, invoiceId, "pending");

    expect(invoiceQuery.update).toHaveBeenCalledWith({ status: "pending" });
    expect(result.success).toContain("mis à jour");
  });
});
