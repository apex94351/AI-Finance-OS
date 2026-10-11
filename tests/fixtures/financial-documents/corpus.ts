import type { ExtractionFieldStatus, ExtractedDocumentType } from "@/lib/ai/types";

export interface ExpectedField {
  status: ExtractionFieldStatus;
  value?: unknown;
}

export interface FinancialDocumentFixture {
  id: string;
  documentType: ExtractedDocumentType;
  pages: Array<{ pageNumber: number; text: string }>;
  expected: Record<string, ExpectedField>;
  expectedVatRates: number[];
  arithmeticConsistent: boolean;
  humanReviewReasons: string[];
}

export const financialDocumentCorpus: FinancialDocumentFixture[] = [
  {
    id: "synthetic-french-invoice",
    documentType: "invoice",
    pages: [{
      pageNumber: 1,
      text: `FACTURE
N° facture : SYN-2026-001
Date d'émission : 14/09/2026
Date d'échéance : 14 octobre 2026
Émetteur : Atelier Boréal Fictif
Adresse fournisseur : 1 rue Imaginaire, 69000 Lyon
Pays fournisseur : France
SIRET fournisseur : 123 456 789 00012
TVA fournisseur : FR12345678901
Destinataire : Société Démo Zéro
Total HT : 100,00 €
TVA 20% : montant 20,00
Total TVA : 20,00 €
Total TTC : 120,00 €
Devise : EUR
Conditions de paiement : 30 jours
Bon de commande n° : BC-SYN-9`,
    }],
    expected: {
      documentType: { status: "present", value: "invoice" },
      referenceNumber: { status: "present", value: "SYN-2026-001" },
      issueDate: { status: "present", value: "2026-09-14" },
      dueDate: { status: "present", value: "2026-10-14" },
      "issuer.name": { status: "present", value: "Atelier Boréal Fictif" },
      "issuer.role": { status: "present", value: "unknown" },
      "issuer.address": { status: "present", value: "1 rue Imaginaire, 69000 Lyon" },
      "issuer.country": { status: "present", value: "France" },
      "issuer.siret": { status: "present", value: "12345678900012" },
      "issuer.vatNumber": { status: "present", value: "FR12345678901" },
      "recipient.name": { status: "present", value: "Société Démo Zéro" },
      currency: { status: "present", value: "EUR" },
      "amounts.subtotalHT": { status: "present", value: 100 },
      "amounts.totalVAT": { status: "present", value: 20 },
      "amounts.totalTTC": { status: "present", value: 120 },
      "paymentTerms": { status: "present", value: "30 jours" },
      purchaseOrderReference: { status: "present", value: "BC-SYN-9" },
    },
    expectedVatRates: [20],
    arithmeticConsistent: true,
    humanReviewReasons: ["Règles déterministes non généralisables aux formats inconnus."],
  },
  {
    id: "synthetic-multi-rate-invoice",
    documentType: "invoice",
    pages: [{
      pageNumber: 1,
      text: `FACTURE
Facture n° : MIX-42
Date de facture : 2026-09-02
Émetteur : Studio Factice
Destinataire : Client Démo
Ligne: Conseil | q=2 | pu=100,00 | tva=20% | ht=200,00 | ttc=240,00
Ligne: Livre fictif | q=1 | pu=10,00 | tva=5,5% | ht=10,00 | ttc=10,55
Total HT : 210,00
TVA 20% : base 200,00; montant 40,00
TVA 5,5% : base 10,00; montant 0,55
Total TVA : 40,55
Total TTC : 250,55
Frais : 0,00
Remise : 0,00`,
    }],
    expected: {
      referenceNumber: { status: "present", value: "MIX-42" },
      issueDate: { status: "present", value: "2026-09-02" },
      "amounts.subtotalHT": { status: "present", value: 210 },
      "amounts.totalVAT": { status: "present", value: 40.55 },
      "amounts.totalTTC": { status: "present", value: 250.55 },
      "amounts.otherFees": { status: "present", value: 0 },
      "amounts.totalDiscounts": { status: "present", value: 0 },
      lines: { status: "present" },
    },
    expectedVatRates: [20, 5.5],
    arithmeticConsistent: true,
    humanReviewReasons: ["Vérifier que toutes les lignes et bases de TVA ont été repérées."],
  },
  {
    id: "synthetic-quote-no-final-vat",
    documentType: "quote",
    pages: [{
      pageNumber: 1,
      text: `DEVIS
Devis n° : OFFRE-7
Date d'émission : 03/10/2026
Émetteur : Atelier Démo
Destinataire : Association Fictive
Total HT : 80,50
TVA non applicable au devis
Total TTC : illisible`,
    }],
    expected: {
      documentType: { status: "present", value: "quote" },
      referenceNumber: { status: "present", value: "OFFRE-7" },
      issueDate: { status: "uncertain" },
      "amounts.subtotalHT": { status: "present", value: 80.5 },
      "amounts.totalVAT": { status: "missing" },
      "amounts.vatTreatment": { status: "present", value: "not_applicable" },
      "amounts.totalTTC": { status: "illegible" },
      dueDate: { status: "missing" },
      "issuer.siren": { status: "missing" },
    },
    expectedVatRates: [],
    arithmeticConsistent: true,
    humanReviewReasons: ["Le total TTC est illisible et le devis ne porte pas de TVA finale."],
  },
  {
    id: "synthetic-credit-note",
    documentType: "credit_note",
    pages: [{
      pageNumber: 1,
      text: `AVOIR
Avoir n° : AV-3
Date : 2026-09-20
Émetteur : Fabrique Imaginaire
Destinataire : Client Fictif
Total HT : -50.00
TVA 20% : -10.00
Total TVA : -10.00
Total TTC : -60.00`,
    }],
    expected: {
      documentType: { status: "present", value: "credit_note" },
      referenceNumber: { status: "present", value: "AV-3" },
      issueDate: { status: "present", value: "2026-09-20" },
      "amounts.subtotalHT": { status: "present", value: -50 },
      "amounts.totalVAT": { status: "present", value: -10 },
      "amounts.totalTTC": { status: "present", value: -60 },
    },
    expectedVatRates: [20],
    arithmeticConsistent: true,
    humanReviewReasons: ["Vérifier l'imputation et le rattachement de l'avoir à la facture initiale."],
  },
  {
    id: "synthetic-conflicting-reference-and-totals",
    documentType: "invoice",
    pages: [{
      pageNumber: 1,
      text: `FACTURE
N° facture : CONTRADICTOIRE-A
N° facture : CONTRADICTOIRE-B
Date d'émission : 01/10/2026
Émetteur : Société Inventée
Total HT : 100,00 €
TVA 20% : 20,00
Total TVA : 20,00
Total TTC : 150,00`,
    }],
    expected: {
      documentType: { status: "present", value: "invoice" },
      referenceNumber: { status: "uncertain" },
      issueDate: { status: "uncertain" },
      "amounts.subtotalHT": { status: "present", value: 100 },
      "amounts.totalVAT": { status: "present", value: 20 },
      "amounts.totalTTC": { status: "present", value: 150 },
      "issuer.siret": { status: "missing" },
      "issuer.vatNumber": { status: "missing" },
    },
    expectedVatRates: [20],
    arithmeticConsistent: false,
    humanReviewReasons: ["La date numérique et la référence sont ambiguës, et le total TTC ne concorde pas."],
  },
  {
    id: "synthetic-receipt-payment",
    documentType: "receipt",
    pages: [
      {
        pageNumber: 1,
        text: `REÇU
Référence de paiement : PAY-1
Mode de paiement : Carte
Montant payé : 12,00 €
SIRET fournisseur : illisible`,
      },
      {
        pageNumber: 2,
        text: `Date de paiement : 11 octobre 2026
Total TTC : 12,00 €`,
      },
    ],
    expected: {
      documentType: { status: "present", value: "receipt" },
      paymentDate: { status: "present", value: "2026-10-11" },
      "payment.reference": { status: "present", value: "PAY-1" },
      "payment.method": { status: "present", value: "Carte" },
      "amounts.amountPaid": { status: "present", value: 12 },
      "issuer.siret": { status: "illegible" },
      "issuer.vatNumber": { status: "missing" },
      issueDate: { status: "missing" },
    },
    expectedVatRates: [],
    arithmeticConsistent: true,
    humanReviewReasons: ["L'identifiant de l'émetteur est illisible et les totaux fiscaux ne sont pas indiqués."],
  },
];
