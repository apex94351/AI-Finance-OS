import { describe, expect, it } from "vitest";
import { companyNameSchema } from "@/lib/companies/validation";

describe("company name validation", () => {
  it("trims surrounding whitespace", () => {
    expect(companyNameSchema.parse("  Atelier Nova  ")).toBe("Atelier Nova");
  });

  it("rejects empty and overlong names", () => {
    expect(companyNameSchema.safeParse("   ").success).toBe(false);
    expect(companyNameSchema.safeParse("a".repeat(161)).success).toBe(false);
  });

  it("accepts the maximum supported name length", () => {
    expect(companyNameSchema.safeParse("a".repeat(160)).success).toBe(true);
  });
});
