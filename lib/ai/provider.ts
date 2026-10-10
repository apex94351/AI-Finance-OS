import type { InvoiceAnalysisInput, InvoiceAnalysisResult } from "@/lib/ai/types";

export interface AIProvider {
  analyzeInvoice(input: InvoiceAnalysisInput): Promise<InvoiceAnalysisResult>;
}

export class UnconfiguredAIProvider implements AIProvider {
  async analyzeInvoice(): Promise<InvoiceAnalysisResult> {
    throw new Error("AI provider is not configured");
  }
}
