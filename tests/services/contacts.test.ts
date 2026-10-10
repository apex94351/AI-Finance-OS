import { describe, expect, it } from "vitest";
import { contactInputSchema, contactKindSchema, filterContacts } from "@/services/contacts";
import type { ContactRecord } from "@/types/invoice";

const sampleContacts: ContactRecord[] = [
  {
    id: "a", kind: "customers", userId: "u1", companyId: "co1", name: "Alpha",
    email: "alpha@example.com", phone: null, address: null, notes: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "b", kind: "customers", userId: "u1", companyId: null, name: "Zeta",
    email: null, phone: "0102030405", address: null, notes: null,
    createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z",
  },
];

describe("contact validation", () => {
  it("trims required names and normalizes optional fields", () => {
    expect(contactInputSchema.parse({
      name: "  Atelier Alpha ",
      email: "",
      phone: "  ",
      address: "  2 rue des Lilas ",
      notes: "",
    })).toEqual({
      name: "Atelier Alpha",
      email: null,
      phone: null,
      address: "2 rue des Lilas",
      notes: null,
    });
  });

  it("rejects blank names, invalid emails, and oversized notes", () => {
    expect(contactInputSchema.safeParse({
      name: "  ",
      email: "",
      phone: "",
      address: "",
      notes: "",
    }).success).toBe(false);
    expect(contactInputSchema.safeParse({
      name: "Client",
      email: "not-an-email",
      phone: "",
      address: "",
      notes: "",
    }).success).toBe(false);
    expect(contactInputSchema.safeParse({
      name: "Client",
      email: "",
      phone: "",
      address: "",
      notes: "x".repeat(2001),
    }).success).toBe(false);
  });

  it("accepts only customer and supplier table identifiers", () => {
    expect(contactKindSchema.safeParse("customers").success).toBe(true);
    expect(contactKindSchema.safeParse("suppliers").success).toBe(true);
    expect(contactKindSchema.safeParse("invoices").success).toBe(false);
  });

  it("searches by the owning company and sorts by name or creation date", () => {
    const companyNames = new Map([["co1", "Atelier Nova"]]);
    expect(filterContacts(sampleContacts, "atelier nova", "all", companyNames, "name-asc").map(({ id }) => id)).toEqual(["a"]);
    expect(filterContacts(sampleContacts, "", "all", companyNames, "name-asc").map(({ id }) => id)).toEqual(["a", "b"]);
    expect(filterContacts(sampleContacts, "", "all", companyNames, "created-desc").map(({ id }) => id)).toEqual(["b", "a"]);
    expect(filterContacts(sampleContacts, "absent", "all", companyNames, "name-asc")).toEqual([]);
  });
});
