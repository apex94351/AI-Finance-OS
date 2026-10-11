import {
  INVOICE_ANALYSIS_SCHEMA_VERSION,
  invoiceAnalysisSchema,
} from "@/lib/ai/schemas";
import type {
  ExtractedField,
  ExtractedDocumentType,
  ExtractedInvoiceLine,
  ExtractedParty,
  ExtractedVatBreakdown,
  ExtractedVatTreatment,
  ExtractionSource,
  InvoiceAnalysisInput,
  InvoiceAnalysisResult,
  InvoiceExtractionEngine,
  InvoiceExtractionOutput,
} from "@/lib/ai/types";
import { validateInvoiceAnalysis } from "@/services/invoice-validation";

export const INVOICE_RULE_ENGINE_ID = "invoice-rules";
export const INVOICE_RULE_ENGINE_VERSION = "0.1.0";
export const RULE_EXTRACTION_MAX_PAGES = 100;
export const RULE_EXTRACTION_MAX_CHARACTERS = 100_000;

interface TextLine {
  page: number;
  text: string;
}

interface Candidate<T> {
  value: T;
  source: ExtractionSource;
}

interface NormalizedLine {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
}

const frenchMonths: Record<string, string> = {
  janvier: "01",
  février: "02",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  août: "08",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  décembre: "12",
  decembre: "12",
};

function normalized(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
}

function normalizeWithOffsets(value: string): NormalizedLine {
  let text = "";
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  let offset = 0;
  for (const character of value) {
    const start = offset;
    offset += character.length;
    const normalizedCharacter = normalized(character);
    text += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      originalStarts.push(start);
      originalEnds.push(offset);
    }
  }
  return { text, originalStarts, originalEnds };
}

function matchLine(pattern: RegExp, line: TextLine): string[] | null {
  pattern.lastIndex = 0;
  const directMatch = pattern.exec(line.text);
  pattern.lastIndex = 0;
  if (directMatch) return Array.from(directMatch);

  const normalizedLine = normalizeWithOffsets(line.text);
  const normalizedPattern = new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""));
  const normalizedMatch = normalizedPattern.exec(normalizedLine.text);
  if (!normalizedMatch) return null;

  const mapped = Array.from(normalizedMatch);
  mapped[0] = line.text;
  for (let group = 1; group < mapped.length; group += 1) {
    const capture = normalizedMatch[group];
    if (!capture) continue;
    const start = normalizedMatch.index + normalizedMatch[0].lastIndexOf(capture);
    const end = start + capture.length;
    const originalStart = normalizedLine.originalStarts[start];
    const originalEnd = normalizedLine.originalEnds[end - 1];
    if (originalStart !== undefined && originalEnd !== undefined) {
      mapped[group] = line.text.slice(originalStart, originalEnd);
    }
  }
  return mapped;
}

function sourceFor(line: TextLine, excerpt = line.text): ExtractionSource {
  return {
    page: line.page,
    excerpt: excerpt.trim().slice(0, 500) || null,
    boundingBox: null,
  };
}

function field<T>(value: T | null = null, status: ExtractedField<T>["status"] = "missing"): ExtractedField<T> {
  return { status, value };
}

function present<T>(candidate: Candidate<T>): ExtractedField<T> {
  return {
    status: "present",
    value: candidate.value,
    source: candidate.source,
    confidence: 0.9,
  };
}

function collectCandidates<T>(
  lines: TextLine[],
  pattern: RegExp,
  parse: (raw: string) => T | null,
): Candidate<T>[] {
  const candidates: Candidate<T>[] = [];
  for (const line of lines) {
    const match = matchLine(pattern, line);
    if (!match?.[1]?.trim()) continue;
    const raw = match[1].trim();
    const value = parse(raw);
    if (value !== null) candidates.push({ value, source: sourceFor(line, match[0]) });
  }
  return candidates;
}

function fromCandidates<T>(
  candidates: Candidate<T>[],
  warnings: string[],
  label: string,
  equals: (left: T, right: T) => boolean = Object.is,
): ExtractedField<T> {
  if (!candidates.length) return field();
  const distinct = candidates.filter((candidate, index) =>
    candidates.findIndex((other) => equals(candidate.value, other.value)) === index,
  );
  if (distinct.length > 1) {
    warnings.push(`${label} apparaît avec plusieurs valeurs; vérification humaine nécessaire.`);
    return { status: "uncertain", value: null, source: distinct[0]?.source ?? null };
  }
  return present(distinct[0]!);
}

function labelledField<T>(
  lines: TextLine[],
  patterns: RegExp[],
  parse: (raw: string) => T | null,
  warnings: string[],
  label: string,
  equals?: (left: T, right: T) => boolean,
): ExtractedField<T> {
  for (const line of lines) {
    if (patterns.some((pattern) => matchLine(pattern, line) && /(?:illisible|illise|[?]{3,})/iu.test(normalized(line.text)))) {
      return { status: "illegible", value: null, source: sourceFor(line) };
    }
  }
  return fromCandidates(
    patterns.flatMap((pattern) => collectCandidates(lines, pattern, parse)),
    warnings,
    label,
    equals,
  );
}

function parseDate(raw: string): string | null {
  const value = raw.trim().replace(/[.,;]$/, "");
  let match = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(value);
  if (match) return makeDate(match[3]!, match[2]!, match[1]!);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return makeDate(match[1]!, match[2]!, match[3]!);
  match = /^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})$/iu.exec(value);
  if (match) {
    const month = frenchMonths[normalized(match[2]!)];
    return month ? makeDate(match[3]!, month, match[1]!) : null;
  }
  return null;
}

function hasAmbiguousNumericDate(raw: string): boolean {
  const match = /^(\d{1,2})[/. -](\d{1,2})[/. -]\d{4}$/.exec(raw.trim());
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second;
}

function dateField(
  lines: TextLine[],
  patterns: RegExp[],
  warnings: string[],
  label: string,
): ExtractedField<string> {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = matchLine(pattern, line);
      if (match?.[1] && parseDate(match[1]) && hasAmbiguousNumericDate(match[1])) {
        warnings.push(`${label} utilise un format numérique ambigu; vérification humaine nécessaire.`);
        return { status: "uncertain", value: null, source: sourceFor(line) };
      }
    }
  }
  return labelledField(lines, patterns, parseDate, warnings, label);
}

function makeDate(year: string, month: string, day: string): string | null {
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function parseMoney(raw: string): number | null {
  let value = raw
    .replace(/[\s\u00a0\u202f]/gu, "")
    .replace(/[€$£]/gu, "")
    .replace(/(?:EUR|USD|GBP)\.?/giu, "")
    .replace(/[’']/gu, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    value = value.replace(/[,.]/gu, (separator) => separator === decimal ? "." : "");
  } else if (comma >= 0) {
    value = value.replace(",", ".");
  }
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? (negative ? -amount : amount) : null;
}

function parseRate(raw: string): number | null {
  const rate = Number(raw.replace(",", "."));
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null;
}

function valuePatterns(labels: string[]): RegExp[] {
  return labels.map((label) => new RegExp(`^\\s*(?:${label})\\s*[:=\\-]\\s*(.*?)\\s*$`, "iu"));
}

function parseDocumentType(lines: TextLine[], warnings: string[]): ExtractedField<ExtractedDocumentType> {
  const recognized: Candidate<ExtractedDocumentType>[] = [];
  for (const line of lines) {
    const text = normalized(line.text);
    let value: ExtractedDocumentType | null = null;
    if (/\b(?:avoir|credit note)\b/u.test(text)) value = "credit_note";
    else if (/\bdevis\b/u.test(text)) value = "quote";
    else if (/\b(?:recu|receipt)\b/u.test(text)) value = "receipt";
    else if (/\bfacture\b/u.test(text)) {
      if (/\bfacture\s+(?:fournisseur|achat)\b/u.test(text)) value = "supplier_invoice";
      else if (/\bfacture\s+(?:client|vente)\b/u.test(text)) value = "customer_invoice";
      else value = "invoice";
    }
    if (value) recognized.push({ value, source: sourceFor(line) });
  }
  return fromCandidates(recognized, warnings, "Le type de document");
}

function createParty(): ExtractedParty {
  return {
    role: field("unknown", "present"),
    name: field(),
    address: field(),
    country: field(),
    email: field(),
    phone: field(),
    siren: field(),
    siret: field(),
    vatNumber: field(),
  };
}

function matchPartyField(
  lines: TextLine[],
  owner: "issuer" | "recipient",
  kind: "name" | "address" | "country" | "email" | "phone" | "siren" | "siret" | "vat",
  warnings: string[],
): ExtractedField<string> {
  const labels: Record<typeof kind, string[]> = {
    name: owner === "issuer"
      ? ["(?:emetteur|vendeur|fournisseur|nom de l.?emetteur)"]
      : ["(?:destinataire|acheteur|client|nom du destinataire)"],
    address: owner === "issuer"
      ? ["adresse (?:emetteur|vendeur|fournisseur)"]
      : ["adresse (?:destinataire|client|acheteur)"],
    country: owner === "issuer" ? ["pays (?:emetteur|fournisseur)"] : ["pays (?:destinataire|client)"],
    email: owner === "issuer" ? ["(?:email|courriel) (?:emetteur|fournisseur)"] : ["(?:email|courriel) (?:destinataire|client)"],
    phone: owner === "issuer" ? ["telephone (?:emetteur|fournisseur)"] : ["telephone (?:destinataire|client)"],
    siren: owner === "issuer" ? ["siren (?:emetteur|fournisseur)"] : ["siren (?:destinataire|client)"],
    siret: owner === "issuer" ? ["siret (?:emetteur|fournisseur)"] : ["siret (?:destinataire|client)"],
    vat: owner === "issuer" ? ["(?:tva|numero de tva) (?:emetteur|fournisseur)"] : ["(?:tva|numero de tva) (?:destinataire|client)"],
  };
  const valuePattern = new RegExp(`^\\s*(?:${labels[kind].join("|")})\\s*[:=\\-]\\s*(.*?)\\s*$`, "iu");
  const parse = (raw: string): string | null => {
    if (/^(?:illisible|[?]{3,})$/iu.test(raw)) return null;
    if (kind === "siren" || kind === "siret") {
      const digits = raw.replace(/\D/gu, "");
      return (kind === "siren" ? digits.length === 9 : digits.length === 14) ? digits : null;
    }
    if (kind === "vat") {
      const vat = raw.replace(/[\s.]/gu, "").toUpperCase();
      return /^[A-Z]{2}[A-Z0-9]{2,13}$/u.test(vat) ? vat : null;
    }
    if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(raw) ? raw : null;
    return raw.trim() || null;
  };
  const illegible = lines.find((line) => matchLine(valuePattern, line) && /(?:illisible|[?]{3,})/iu.test(normalized(line.text)));
  if (illegible) return { status: "illegible", value: null, source: sourceFor(illegible) };
  return fromCandidates(collectCandidates(lines, valuePattern, parse), warnings, `${kind} ${owner}`);
}

function parseLines(lines: TextLine[], warnings: string[]): ExtractedField<ExtractedInvoiceLine[]> {
  const extracted: ExtractedInvoiceLine[] = [];
  for (const line of lines) {
    const match = /^\s*Ligne\s*:\s*(.+?)\s*\|\s*q(?:uantite)?\s*=\s*([^|]+)\s*\|\s*pu\s*=\s*([^|]+)\s*\|\s*(?:remise\s*=\s*([^|]+)\s*\|\s*)?tva\s*=\s*([\d.,]+)\s*%\s*\|\s*ht\s*=\s*([^|]+)(?:\s*\|\s*ttc\s*=\s*([^|]+))?\s*$/iu.exec(line.text);
    if (!match) continue;
    const description = match[1]!.trim();
    const quantity = parseMoney(match[2]!);
    const unitPrice = parseMoney(match[3]!);
    const discountAmount = match[4] ? parseMoney(match[4]) : null;
    const vatRate = parseRate(match[5]!);
    const subtotalHT = parseMoney(match[6]!);
    const totalTTC = match[7] ? parseMoney(match[7]) : null;
    if (quantity === null || unitPrice === null || vatRate === null || subtotalHT === null) {
      warnings.push("Une ligne détaillée est ambiguë ou incomplète; vérification humaine nécessaire.");
      continue;
    }
    extracted.push({
      description: { ...field(description, "present"), source: sourceFor(line), confidence: 0.8 },
      quantity: { ...field(quantity, "present"), source: sourceFor(line), confidence: 0.8 },
      unit: field(),
      unitPrice: { ...field(unitPrice, "present"), source: sourceFor(line), confidence: 0.8 },
      discountAmount: match[4]
        ? discountAmount === null ? field<number>(null, "uncertain") : { ...field(discountAmount, "present"), source: sourceFor(line) }
        : field(),
      discountRate: field(),
      vatRate: { ...field(vatRate, "present"), source: sourceFor(line), confidence: 0.8 },
      subtotalHT: { ...field(subtotalHT, "present"), source: sourceFor(line), confidence: 0.8 },
      totalTTC: totalTTC === null ? field() : { ...field(totalTTC, "present"), source: sourceFor(line), confidence: 0.8 },
    });
  }
  return extracted.length ? field(extracted, "present") : field();
}

function parseVatBreakdowns(lines: TextLine[], warnings: string[]): ExtractedField<ExtractedVatBreakdown[]> {
  const items: ExtractedVatBreakdown[] = [];
  const pattern = /^\s*(?:tva|vat)\s*([\d.,]+)\s*%\s*[:=]\s*(?:base(?:\s*ht)?\s*[:=]?\s*([^;|]+?)\s*[,;|]\s*)?(?:montant\s*[:=]?\s*)?([^;|]+?)\s*$/iu;
  const simplePattern = /^\s*(?:tva|vat)\s*([\d.,]+)\s*%\s*[:=]\s*([^;|]+?)\s*$/iu;
  for (const line of lines) {
    const match = pattern.exec(line.text) ?? simplePattern.exec(line.text);
    if (!match) continue;
    const rate = parseRate(match[1]!);
    let base: number | null = null;
    let amount: number | null = null;
    if (match[3] !== undefined) {
      base = parseMoney(match[2] ?? "");
      amount = parseMoney(match[3]);
    } else {
      amount = parseMoney(match[2]!);
    }
    if (rate === null || amount === null) {
      warnings.push("Une ventilation de TVA est ambiguë; vérification humaine nécessaire.");
      continue;
    }
    items.push({
      rate: { ...field(rate, "present"), source: sourceFor(line) },
      taxableBase: base === null ? field() : { ...field(base, "present"), source: sourceFor(line) },
      amount: { ...field(amount, "present"), source: sourceFor(line) },
    });
  }
  return items.length ? field(items, "present") : field();
}

function extractFromLines(lines: TextLine[]): { analysis: InvoiceAnalysisResult; warnings: string[] } {
  const warnings: string[] = [];
  const issuer = createParty();
  const recipient = createParty();
  issuer.name = matchPartyField(lines, "issuer", "name", warnings);
  issuer.address = matchPartyField(lines, "issuer", "address", warnings);
  issuer.country = matchPartyField(lines, "issuer", "country", warnings);
  issuer.email = matchPartyField(lines, "issuer", "email", warnings);
  issuer.phone = matchPartyField(lines, "issuer", "phone", warnings);
  issuer.siren = matchPartyField(lines, "issuer", "siren", warnings);
  issuer.siret = matchPartyField(lines, "issuer", "siret", warnings);
  issuer.vatNumber = matchPartyField(lines, "issuer", "vat", warnings);
  recipient.name = matchPartyField(lines, "recipient", "name", warnings);
  recipient.address = matchPartyField(lines, "recipient", "address", warnings);
  recipient.country = matchPartyField(lines, "recipient", "country", warnings);
  recipient.email = matchPartyField(lines, "recipient", "email", warnings);
  recipient.phone = matchPartyField(lines, "recipient", "phone", warnings);
  recipient.siren = matchPartyField(lines, "recipient", "siren", warnings);
  recipient.siret = matchPartyField(lines, "recipient", "siret", warnings);
  recipient.vatNumber = matchPartyField(lines, "recipient", "vat", warnings);

  const reference = labelledField(
    lines,
    valuePatterns(["(?:facture|devis|avoir)\\s*(?:n[°ºo]|numero|num\\.)", "n[°ºo]\\s*(?:facture|devis|avoir)"]),
    (raw) => raw.trim().replace(/[.;,]$/u, "") || null,
    warnings,
    "La référence",
  );
  const issueDate = dateField(
    lines,
    valuePatterns(["(?:date d.?emission|date de facture|emis(?:e)? le|date)"]),
    warnings,
    "La date d'émission",
  );
  const dueDate = dateField(
    lines,
    valuePatterns(["(?:date d.?echeance|echeance|a payer avant le|date limite de paiement)"]),
    warnings,
    "La date d'échéance",
  );
  const paymentDate = dateField(
    lines,
    valuePatterns(["(?:date de paiement|paye(?:e)? le|regle(?:e)? le)"]),
    warnings,
    "La date de paiement",
  );
  const money = (labels: string[], label: string) => labelledField(
    lines,
    valuePatterns(labels),
    parseMoney,
    warnings,
    label,
    (left, right) => Math.abs(left - right) < 0.005,
  );
  const subtotalHT = money(["(?:total|montant)\\s*ht", "net a payer ht"], "Le total HT");
  const totalVAT = money(["(?:total|montant)\\s*tva", "tva totale"], "Le total TVA");
  const totalTTC = money(["(?:total|montant)\\s*ttc", "total a payer"], "Le total TTC");
  const totalDiscounts = money(["(?:total )?remises?", "remise globale"], "Les remises");
  const otherFees = money(["(?:frais|frais annexes|port)"], "Les frais");
  const deposits = money(["(?:acompte|acompte verse)"], "Les acomptes");
  const amountPaid = money(["(?:montant paye|deja paye|regle)"], "Le montant payé");
  const balanceDue = money(["(?:solde du|reste a payer|net a payer)"], "Le solde dû");

  const fullText = normalized(lines.map(({ text }) => text).join("\n"));
  const explicitTaxTreatment = fullText.includes("autoliquidation")
    ? "reverse_charge"
    : fullText.includes("exonere") || fullText.includes("exempte")
      ? "exempt"
      : fullText.includes("tva non applicable") || fullText.includes("sans tva")
        ? "not_applicable"
      : null;
  const vatBreakdowns = parseVatBreakdowns(lines, warnings);
  const vatTreatment: ExtractedField<ExtractedVatTreatment> = explicitTaxTreatment
    ? field<ExtractedVatTreatment>(explicitTaxTreatment, "present")
    : vatBreakdowns.status === "present"
      ? field<ExtractedVatTreatment>("taxable", "present")
      : field<ExtractedVatTreatment>(null);
  const documentType = parseDocumentType(lines, warnings);
  const parseCurrency = (raw: string): string | null => {
    const value = raw.trim().toUpperCase();
    if (value === "€" || value === "EUR") return "EUR";
    if (value === "$" || value === "USD") return "USD";
    if (value === "£" || value === "GBP") return "GBP";
    return /^[A-Z]{3}$/u.test(value) ? value : null;
  };
  const currencyCandidates = [
    ...collectCandidates(lines, /^\s*(?:devise|monnaie)\s*[:=]\s*(.*?)\s*$/iu, parseCurrency),
    ...collectCandidates(lines, /(€|\bEUR\b|\bUSD\b|\bGBP\b|\$|£)/giu, parseCurrency),
  ];
  const currency = fromCandidates(currencyCandidates, warnings, "La devise");

  const analysis: InvoiceAnalysisResult = {
    documentType,
    referenceNumber: reference,
    issueDate,
    dueDate,
    paymentDate,
    currency,
    purchaseOrderReference: labelledField(
      lines,
      valuePatterns(["(?:bon de commande|commande)\\s*(?:n[°ºo]|numero|reference)?"]),
      (raw) => raw.trim() || null,
      warnings,
      "La référence de commande",
    ),
    paymentTerms: labelledField(
      lines,
      valuePatterns(["(?:conditions de paiement|conditions|modalites de paiement)"]),
      (raw) => raw.trim() || null,
      warnings,
      "Les conditions de paiement",
    ),
    issuer,
    recipient,
    amounts: {
      subtotalHT,
      totalVAT,
      vatTreatment,
      vatBreakdowns,
      totalTTC,
      totalDiscounts,
      otherFees,
      deposits,
      amountPaid,
      balanceDue,
    },
    lines: parseLines(lines, warnings),
    payment: {
      iban: labelledField(
        lines,
        valuePatterns(["iban"]),
        (raw) => /^[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}$/iu.test(raw.trim()) ? raw.replace(/\s/gu, "").toUpperCase() : null,
        warnings,
        "L'IBAN",
      ),
      bic: labelledField(
        lines,
        valuePatterns(["bic", "swift"]),
        (raw) => /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/iu.test(raw.trim()) ? raw.trim().toUpperCase() : null,
        warnings,
        "Le BIC",
      ),
      method: labelledField(
        lines,
        valuePatterns(["(?:mode|moyen) de paiement"]),
        (raw) => raw.trim() || null,
        warnings,
        "Le mode de paiement",
      ),
      reference: labelledField(
        lines,
        valuePatterns(["(?:reference|ref) de paiement"]),
        (raw) => raw.trim() || null,
        warnings,
        "La référence de paiement",
      ),
    },
    warnings,
  };

  return { analysis, warnings };
}

export class InvoiceRuleExtractionEngine implements InvoiceExtractionEngine {
  readonly id = INVOICE_RULE_ENGINE_ID;
  readonly version = INVOICE_RULE_ENGINE_VERSION;

  async extract(input: InvoiceAnalysisInput): Promise<InvoiceExtractionOutput> {
    if (input.pages.length === 0 || input.pages.length > RULE_EXTRACTION_MAX_PAGES) {
      throw new Error("Invalid extraction input.");
    }
    if (input.pages.some((page) => !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== "string")
      || input.pages.reduce((total, page) => total + page.text.length, 0) > RULE_EXTRACTION_MAX_CHARACTERS) {
      throw new Error("Invalid extraction input.");
    }

    const lines = input.pages.flatMap((page) => page.text.split(/\r?\n/u)
      .map((text) => ({ page: page.pageNumber, text: text.trim() }))
      .filter(({ text }) => text.length > 0));
    const { analysis } = extractFromLines(lines);
    const parsed = invoiceAnalysisSchema.safeParse(analysis);
    if (!parsed.success) throw new Error("The deterministic extraction result did not match its schema.");

    return {
      engineId: this.id,
      engineVersion: this.version,
      schemaVersion: INVOICE_ANALYSIS_SCHEMA_VERSION,
      analysis: parsed.data,
      validation: validateInvoiceAnalysis(parsed.data),
      reviewRequired: true,
    };
  }
}

export const invoiceRuleExtractionEngine = new InvoiceRuleExtractionEngine();
