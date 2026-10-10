import type { InvoiceAnalysisResult } from "@/lib/ai/types";

export type InvoiceStatus = "draft" | "pending" | "paid" | "overdue" | "receivable" | "cancelled";

export interface InvoiceRecord {
  id: string;
  userId: string | null;
  companyId: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  documentId: string | null;
  invoiceNumber: string | null;
  clientName: string | null;
  description: string | null;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  total: number | null;
  currency: string | null;
  status: InvoiceStatus;
  category: string | null;
  analysis: InvoiceAnalysisResult | null;
  createdAt: string;
  updatedAt: string;
}

export type ContactKind = "customers" | "suppliers";

export interface ContactRecord {
  id: string;
  kind: ContactKind;
  userId: string | null;
  companyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceCompany {
  id: string;
  name: string;
  currency: string;
}
