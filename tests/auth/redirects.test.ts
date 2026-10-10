import { describe, expect, it } from "vitest";
import {
  getLoginRedirectPath,
  getProtectedRouteRedirect,
  getSafeRedirectPath,
} from "@/lib/auth/redirects";

describe("authentication redirects", () => {
  it("returns a protected destination to login", () => {
    expect(getLoginRedirectPath("/dashboard", "?period=month")).toBe(
      "/login?next=%2Fdashboard%3Fperiod%3Dmonth",
    );
  });

  it("redirects unauthenticated dashboard requests to login", () => {
    expect(getProtectedRouteRedirect(false, "/dashboard")).toBe(
      "/login?next=%2Fdashboard",
    );
  });

  it("keeps safe internal destinations after login", () => {
    expect(getSafeRedirectPath("/settings?tab=profile#account")).toBe(
      "/settings?tab=profile#account",
    );
  });

  it.each([
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/..//attacker.example",
    "/%2e%2e//attacker.example",
    "javascript:alert(1)",
  ])("rejects unsafe destination %s", (next) => {
    expect(getSafeRedirectPath(next)).toBe("/dashboard");
  });
});