export interface InvoiceAnalysisInput {
  fileName: string;
  mimeType: string;
  content: Uint8Array;
}

export interface InvoiceAnalysisResult {
  documentType: "invoice" | "credit_note" | "other" | "unknown";
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  supplier: {
    name: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    siret: string | null;
    vatNumber: string | null;
  };
  client: {
    name: string | null;
    address: string | null;
    siret: string | null;
    vatNumber: string | null;
  };
  amounts: {
    subtotal: number | null;
    vat: number | null;
    vatRate: number | null;
    discount: number | null;
    otherFees: number | null;
    total: number | null;
  };
  payment: {
    iban: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
  };
  category: string | null;
  summary: string | null;
  missingInformation: string[];
  warnings: string[];
  recommendedActions: string[];
  confidence: number;
}
