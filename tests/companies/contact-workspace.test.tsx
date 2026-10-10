// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, refresh, createContact, updateContact, deleteContact } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/app/contacts/actions", () => ({ createContact, updateContact, deleteContact }));

import { ContactWorkspace } from "@/database/components/contacts/contact-workspace";
import type { ContactRecord } from "@/types/invoice";
import type { ExpenseRecord } from "@/services/expenses";

const contact: ContactRecord = {
  id: "123e4567-e89b-42d3-a456-426614174010",
  kind: "customers",
  userId: "123e4567-e89b-42d3-a456-426614174011",
  companyId: null,
  name: "Client Exemple",
  email: "client@example.com",
  phone: null,
  address: "1 rue du Test",
  notes: "Compte fidèle",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const props = {
  kind: "customers" as const,
  contacts: [contact],
  companies: [],
  selectedContactId: contact.id,
  loadError: null,
  invoicesByContact: {
    [contact.id]: [{
      id: "123e4567-e89b-42d3-a456-426614174012",
      invoiceNumber: "FAC-CLIENT-1",
      clientName: "Client Exemple",
      issueDate: "2026-10-01",
      dueDate: "2026-10-20",
      total: 125,
      currency: "EUR",
      status: "receivable" as const,
    }],
  },
};

describe("contact workspace", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    deleteContact.mockResolvedValue({ success: "Le tiers a été supprimé." });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows real contact details, associated invoices, totals, and invoice links", () => {
    render(<ContactWorkspace {...props} />);

    expect(screen.getAllByText("Client Exemple").length).toBeGreaterThan(0);
    expect(screen.getByText("Compte fidèle")).toBeTruthy();
    expect(screen.getAllByText(/125,00/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: /FAC-CLIENT-1/ }).getAttribute("href"))
      .toBe("/invoices#invoice-123e4567-e89b-42d3-a456-426614174012");
    expect(screen.getByRole("link", { name: "Créer une facture liée" }).getAttribute("href"))
      .toBe(`/invoices?partyType=customer&partyId=${contact.id}`);
  });

  it("filters the contact list using the search field", () => {
    render(<ContactWorkspace {...props} selectedContactId={null} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher un client" }), { target: { value: "absent" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });

  it("keeps the client route for client detail links and allows sorting", () => {
    const secondClient = { ...contact, id: "second-client", name: "Autre client", createdAt: "2026-10-02T00:00:00.000Z" };
    render(<ContactWorkspace {...props} contacts={[contact, secondClient]} selectedContactId={null} routeBase="/clients" />);

    expect(screen.getByRole("link", { name: /Client Exemple/ }).getAttribute("href")).toBe(`/clients?contact=${contact.id}`);
    fireEvent.change(screen.getByRole("combobox", { name: "Trier les clients" }), { target: { value: "created-desc" } });
    const rows = document.querySelectorAll(".contact-list-item");
    expect(rows[0]?.textContent).toContain("Autre client");
  });

  it("confirms deletion and refreshes without claiming success when the action fails", async () => {
    deleteContact.mockResolvedValue({ error: "La suppression a échoué." });
    render(<ContactWorkspace {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Supprimer Client Exemple" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("factures associées seront conservées"));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("suppression a échoué"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("provides a clear empty state and an explicit error state", () => {
    const { rerender } = render(
      <ContactWorkspace {...props} contacts={[]} selectedContactId={null} invoicesByContact={{}} />,
    );
    expect(screen.getByText("Aucun client enregistré")).toBeTruthy();

    rerender(
      <ContactWorkspace {...props} contacts={[]} selectedContactId={null} invoicesByContact={{}} loadError="Chargement impossible." />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible.");
    expect(screen.getByRole("button", { name: /Nouveau client/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows supplier expenses only when explicitly linked and reports an unavailable expense table", () => {
    const supplier: ContactRecord = { ...contact, id: "supplier-1", kind: "suppliers", name: "Fournisseur Exemple" };
    const expense: ExpenseRecord = {
      id: "expense-1",
      userId: "123e4567-e89b-42d3-a456-426614174011",
      companyId: null,
      label: "Hébergement",
      amount: 49.9,
      currency: "EUR",
      expenseDate: "2026-10-09",
      category: "Logiciel",
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "paid",
      notes: null,
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    };
    const supplierProps = {
      ...props,
      kind: "suppliers" as const,
      contacts: [supplier],
      selectedContactId: supplier.id,
      invoicesByContact: {},
    };
    const { rerender } = render(
      <ContactWorkspace {...supplierProps} expensesBySupplier={{ [supplier.id]: [expense] }} />,
    );
    expect(screen.getByText("Dépenses associées")).toBeTruthy();
    expect(screen.getByText("Hébergement")).toBeTruthy();
    expect(screen.getByText("Payée")).toBeTruthy();
    expect(screen.getByText((value) => value.includes("49,90"))).toBeTruthy();

    rerender(
      <ContactWorkspace
        {...supplierProps}
        expensesWarning="La migration 009_expenses.sql n’est peut-être pas appliquée."
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("migration 009_expenses.sql");
    expect(screen.getAllByText("Fournisseur Exemple").length).toBeGreaterThan(0);
  });
});
