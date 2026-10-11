import { describe, expect, it } from "vitest";
import { invoiceAnalysisSchema } from "@/lib/ai/schemas";
import type { ExtractedField, InvoiceAnalysisResult } from "@/lib/ai/types";
import { invoiceRuleExtractionEngine } from "@/services/invoice-rule-extraction";
import { financialDocumentCorpus } from "@/tests/fixtures/financial-documents/corpus";

type FieldGroup = "dates" | "amounts" | "businessIdentifiers" | "other";

const datePaths = ["issueDate", "dueDate", "paymentDate"];
const amountPaths = [
  "amounts.subtotalHT",
  "amounts.totalVAT",
  "amounts.totalTTC",
  "amounts.totalDiscounts",
  "amounts.otherFees",
  "amounts.deposits",
  "amounts.amountPaid",
  "amounts.balanceDue",
];
const identifierPaths = [
  "issuer.siren",
  "issuer.siret",
  "issuer.vatNumber",
  "recipient.siren",
  "recipient.siret",
  "recipient.vatNumber",
];

function valueAt(result: InvoiceAnalysisResult, path: string): ExtractedField<unknown> | undefined {
  return path.split(".").reduce<unknown>((value, key) => (
    typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined
  ), result) as ExtractedField<unknown> | undefined;
}

function equalValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) < 0.005;
  }
  return Object.is(actual, expected);
}

describe("deterministic financial document extraction", () => {
  it("extracts the synthetic annotated corpus with field-level metrics", async () => {
    const evaluated = await Promise.all(financialDocumentCorpus.map(async (fixture) => ({
      fixture,
      output: await invoiceRuleExtractionEngine.extract({ pages: fixture.pages }),
    })));

    const groupPaths: Record<FieldGroup, string[]> = {
      dates: datePaths,
      amounts: amountPaths,
      businessIdentifiers: identifierPaths,
      other: [],
    };
    const counts = Object.fromEntries(
      (Object.keys(groupPaths) as FieldGroup[]).map((group) => [group, { correct: 0, annotated: 0 }]),
    ) as Record<FieldGroup, { correct: number; annotated: number }>;
    let exactFieldsCorrect = 0;
    let exactFieldsAnnotated = 0;
    let falsePopulated = 0;
    let dateErrors = 0;
    let dateComparisons = 0;
    let amountErrorsCents = 0;
    let amountMismatches = 0;
    let amountComparisons = 0;
    let arithmeticCorrect = 0;
    let arithmeticComparisons = 0;
    let reviewsCorrect = 0;
    let truePositiveVatRates = 0;
    let falsePositiveVatRates = 0;
    let falseNegativeVatRates = 0;
    const mismatches: Array<{ fixture: string; path: string; expected: unknown; actual: unknown }> = [];

    for (const { fixture, output } of evaluated) {
      expect(output.engineId).toBe("invoice-rules");
      expect(output.schemaVersion).toBe("1.1");
      expect(output.reviewRequired).toBe(true);
      expect(output.validation.reviewRequired).toBe(true);
      if (fixture.expected.issueDate?.status === "uncertain") {
        expect(output.analysis.warnings.some((warning) => warning.includes("format numérique ambigu"))).toBe(true);
      }
      expect(invoiceAnalysisSchema.safeParse(output.analysis).success).toBe(true);
      expect(output.analysis.warnings).not.toContain(fixture.pages.map(({ text }) => text).join("\n"));
      reviewsCorrect += Number(output.reviewRequired === (fixture.humanReviewReasons.length > 0));

      for (const [path, expected] of Object.entries(fixture.expected)) {
        const actual = valueAt(output.analysis, path);
        expect(actual, `${fixture.id}: ${path}`).toBeDefined();
        const correct = actual?.status === expected.status
          && (!("value" in expected) || equalValue(actual.value, expected.value));
        exactFieldsAnnotated += 1;
        exactFieldsCorrect += Number(correct);

        const group = (Object.keys(groupPaths) as FieldGroup[])
          .find((candidate) => candidate !== "other" && groupPaths[candidate].includes(path)) ?? "other";
        counts[group].annotated += 1;
        counts[group].correct += Number(correct);
        if (!correct) mismatches.push({
          fixture: fixture.id,
          path,
          expected,
          actual: { status: actual?.status, value: actual?.value },
        });
        if (expected.status !== "present" && actual?.status === "present") falsePopulated += 1;
        if (datePaths.includes(path) && expected.status === "present") {
          dateComparisons += 1;
          if (!correct) dateErrors += 1;
        }
        if (amountPaths.includes(path) && expected.status === "present" && typeof expected.value === "number") {
          amountComparisons += 1;
          if (actual?.status !== "present" || typeof actual.value !== "number") {
            amountMismatches += 1;
          } else {
            const difference = Math.abs(Math.round((actual.value - expected.value) * 100));
            amountErrorsCents += difference;
            amountMismatches += Number(difference !== 0);
          }
        }
      }

      const predictedRates = output.analysis.amounts.vatBreakdowns.status === "present"
        && output.analysis.amounts.vatBreakdowns.value !== null
        ? output.analysis.amounts.vatBreakdowns.value.map(({ rate }) => rate.status === "present" ? rate.value : null)
          .filter((rate): rate is number => rate !== null)
        : [];
      const unmatchedPredicted = [...predictedRates];
      for (const expectedRate of fixture.expectedVatRates) {
        const index = unmatchedPredicted.findIndex((rate) => Math.abs(rate - expectedRate) < 0.005);
        if (index < 0) falseNegativeVatRates += 1;
        else {
          unmatchedPredicted.splice(index, 1);
          truePositiveVatRates += 1;
        }
      }
      falsePositiveVatRates += unmatchedPredicted.length;

      arithmeticComparisons += 1;
      const arithmeticMatches = output.validation.consistent === fixture.arithmeticConsistent;
      arithmeticCorrect += Number(arithmeticMatches);
      expect(arithmeticMatches, `${fixture.id}: arithmetic validation`).toBe(true);
      expect(output.validation.reviewRequired).toBe(true);
    }

    const metrics = {
      annotatedFieldAccuracy: {
        correct: exactFieldsCorrect,
        total: exactFieldsAnnotated,
        rate: exactFieldsCorrect / exactFieldsAnnotated,
      },
      fieldAccuracyByGroup: Object.fromEntries(Object.entries(counts).map(([group, count]) => [
        group,
        { ...count, rate: count.annotated ? count.correct / count.annotated : null },
      ])),
      date: { errors: dateErrors, compared: dateComparisons },
      amountErrorCents: { total: amountErrorsCents, mismatches: amountMismatches, compared: amountComparisons },
      businessIdentifierRecognition: counts.businessIdentifiers,
      vatRatePrecision: truePositiveVatRates / (truePositiveVatRates + falsePositiveVatRates),
      vatRateRecall: truePositiveVatRates / (truePositiveVatRates + falseNegativeVatRates),
      vatRates: { truePositiveVatRates, falsePositiveVatRates, falseNegativeVatRates },
      falsePopulatedWhenNotPresent: falsePopulated,
      arithmeticConsistency: { correct: arithmeticCorrect, compared: arithmeticComparisons },
      reviewRequired: { correct: reviewsCorrect, compared: evaluated.length },
      accountingValidityGuaranteed: false,
      mismatches,
    };
    console.info(`Synthetic extraction evaluation: ${JSON.stringify(metrics)}`);
    expect(exactFieldsCorrect).toBe(exactFieldsAnnotated);
    expect(dateErrors).toBe(0);
    expect(amountMismatches).toBe(0);
    expect(falsePopulated).toBe(0);
    expect(falsePositiveVatRates).toBe(0);
    expect(falseNegativeVatRates).toBe(0);
    expect(reviewsCorrect).toBe(evaluated.length);
  });

  it("keeps conflicting values uncertain rather than choosing one", async () => {
    const output = await invoiceRuleExtractionEngine.extract({
      pages: [{
        pageNumber: 1,
        text: "FACTURE\nN° facture : EX-A\nN° facture : EX-B",
      }],
    });

    expect(output.analysis.referenceNumber).toMatchObject({ status: "uncertain", value: null });
    expect(output.analysis.warnings).toContain("La référence apparaît avec plusieurs valeurs; vérification humaine nécessaire.");
    expect(output.reviewRequired).toBe(true);
  });

  it("rejects input beyond bounded page and character limits", async () => {
    await expect(invoiceRuleExtractionEngine.extract({ pages: [] })).rejects.toThrow("Invalid extraction input");
    await expect(invoiceRuleExtractionEngine.extract({
      pages: [{ pageNumber: 1, text: "x".repeat(100_001) }],
    })).rejects.toThrow("Invalid extraction input");
    await expect(invoiceRuleExtractionEngine.extract({
      pages: Array.from({ length: 101 }, (_, index) => ({ pageNumber: index + 1, text: "page" })),
    })).rejects.toThrow("Invalid extraction input");
  });

  it("preserves source page evidence without assigning commercial roles from layout", async () => {
    const output = await invoiceRuleExtractionEngine.extract({
      pages: [
        { pageNumber: 1, text: "FACTURE\nÉmetteur : Une société fictive" },
        { pageNumber: 2, text: "Destinataire : Une autre société fictive\nTotal HT : 10,00" },
      ],
    });

    expect(output.analysis.issuer.role).toEqual({ status: "present", value: "unknown" });
    expect(output.analysis.issuer.name.source?.page).toBe(1);
    expect(output.analysis.recipient.name.source?.page).toBe(2);
  });
});
