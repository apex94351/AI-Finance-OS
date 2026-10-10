import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, getSupabaseConfigIssue } from "@/lib/supabase/config";

describe("Supabase public configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports which public values are missing instead of attempting a fake signup", () => {
    expect(getSupabaseConfig()).toBeNull();
    expect(getSupabaseConfigIssue()).toContain("NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("reports an invalid project URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "configured-public-key");

    expect(getSupabaseConfig()).toBeNull();
    expect(getSupabaseConfigIssue()).toContain("URL HTTP(S) valide");
  });

  it("uses the configured URL and anonymous key without requiring a service key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.supabase.co/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "configured-public-key");

    expect(getSupabaseConfig()).toEqual({
      url: "https://project.example.supabase.co/",
      anonKey: "configured-public-key",
    });
    expect(getSupabaseConfigIssue()).toBeNull();
  });
});