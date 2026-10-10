import { describe, expect, it } from "vitest";
import { loginSchema, registrationSchema } from "@/lib/auth/validation";

const validRegistration = {
  firstName: "  Jeanne ",
  lastName: " Martin ",
  email: "jeanne@example.com",
  password: "securite123",
  passwordConfirmation: "securite123",
  acceptedTerms: true,
};

describe("authentication form validation", () => {
  it("accepts a valid login and normalizes its email", () => {
    expect(loginSchema.parse({ email: "  jeanne@example.com ", password: "secret" }).email).toBe(
      "jeanne@example.com",
    );
  });

  it("accepts registration with matching credentials and required consent", () => {
    expect(registrationSchema.safeParse(validRegistration).success).toBe(true);
  });

  it.each([
    [{ ...validRegistration, firstName: " " }, "firstName"],
    [{ ...validRegistration, lastName: "" }, "lastName"],
    [{ ...validRegistration, email: "not-an-email" }, "email"],
    [{ ...validRegistration, password: "short" }, "password"],
    [{ ...validRegistration, passwordConfirmation: "different" }, "passwordConfirmation"],
    [{ ...validRegistration, acceptedTerms: false }, "acceptedTerms"],
  ])("rejects invalid registration field %s", (input, field) => {
    const result = registrationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });
});