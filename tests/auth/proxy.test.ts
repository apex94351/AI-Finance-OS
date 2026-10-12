import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("protected route proxy", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it.each([
    ["/dashboard?period=month", "/login?next=%2Fdashboard%3Fperiod%3Dmonth"],
    ["/settings", "/login?next=%2Fsettings"],
    ["/treasury", "/login?next=%2Ftreasury"],
  ])("redirects unauthenticated requests to %s", async (requestedPath, expectedPath) => {
    const response = await proxy(new NextRequest(`https://finance.example${requestedPath}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`https://finance.example${expectedPath}`);
  });
});