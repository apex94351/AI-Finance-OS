export interface InvoiceAnalysisInput {
  pages: Array<{ pageNumber: number; text: string }>;
}

export interface InvoiceExtractionEngine {
  readonly id: string;
  readonly version: string;
  extract(input: InvoiceAnalysisInput): Promise<InvoiceExtractionOutput>;
}

export interface InvoiceExtractionOutput {
  engineId: string;
  engineVersion: string;
  schemaVersion: string;
  analysis: InvoiceAnalysisResult;
  validation: {
    consistent: boolean;
    reviewRequired: true;
    issues: Array<{ code: string; message: string }>;
    warnings: string[];
  };
  reviewRequired: true;
}

export type ExtractionFieldStatus = "present" | "missing" | "illegible" | "uncertain";
export type ExtractionCoordinateSystem = "normalized" | "page_pixels";

export interface ExtractionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: ExtractionCoordinateSystem;
}

export interface ExtractionSource {
  page: number | null;
  excerpt: string | null;
  boundingBox: ExtractionBoundingBox | null;
}

export interface ExtractedField<T> {
  status: ExtractionFieldStatus;
  value: T | null;
  source?: ExtractionSource | null;
  /** A heuristic score only; it is not a calibrated probability. */
  confidence?: number | null;
  correction?: {
    value: T | null;
    correctedAt?: string | null;
  } | null;
}

export type ExtractedDocumentType =
  | "invoice"
  | "supplier_invoice"
  | "customer_invoice"
  | "credit_note"
  | "quote"
  | "receipt"
  | "supporting_document"
  | "other"
  | "unknown";

export type ExtractedPartyRole = "supplier" | "customer" | "other" | "unknown";
export type ExtractedVatTreatment = "taxable" | "exempt" | "reverse_charge" | "not_applicable" | "unknown";

export interface ExtractedParty {
  role: ExtractedField<ExtractedPartyRole>;
  name: ExtractedField<string>;
  address: ExtractedField<string>;
  country: ExtractedField<string>;
  email: ExtractedField<string>;
  phone: ExtractedField<string>;
  siren: ExtractedField<string>;
  siret: ExtractedField<string>;
  vatNumber: ExtractedField<string>;
}

export interface ExtractedInvoiceLine {
  description: ExtractedField<string>;
  quantity: ExtractedField<number>;
  unit: ExtractedField<string>;
  unitPrice: ExtractedField<number>;
  discountAmount: ExtractedField<number>;
  discountRate: ExtractedField<number>;
  vatRate: ExtractedField<number>;
  subtotalHT: ExtractedField<number>;
  totalTTC: ExtractedField<number>;
}

export interface ExtractedVatBreakdown {
  rate: ExtractedField<number>;
  taxableBase: ExtractedField<number>;
  amount: ExtractedField<number>;
}

export interface InvoiceAnalysisResult {
  documentType: ExtractedField<ExtractedDocumentType>;
  referenceNumber: ExtractedField<string>;
  issueDate: ExtractedField<string>;
  dueDate: ExtractedField<string>;
  paymentDate: ExtractedField<string>;
  currency: ExtractedField<string>;
  purchaseOrderReference: ExtractedField<string>;
  paymentTerms: ExtractedField<string>;
  issuer: ExtractedParty;
  recipient: ExtractedParty;
  amounts: {
    subtotalHT: ExtractedField<number>;
    totalVAT: ExtractedField<number>;
    vatTreatment: ExtractedField<ExtractedVatTreatment>;
    vatBreakdowns: ExtractedField<ExtractedVatBreakdown[]>;
    totalTTC: ExtractedField<number>;
    totalDiscounts: ExtractedField<number>;
    otherFees: ExtractedField<number>;
    deposits: ExtractedField<number>;
    amountPaid: ExtractedField<number>;
    balanceDue: ExtractedField<number>;
  };
  lines: ExtractedField<ExtractedInvoiceLine[]>;
  payment: {
    iban: ExtractedField<string>;
    bic: ExtractedField<string>;
    method: ExtractedField<string>;
    reference: ExtractedField<string>;
  };
  warnings: string[];
}
