import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig, getSupabaseConfigIssue, SupabaseConfigurationError } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseConfigurationError(getSupabaseConfigIssue() ?? "Configuration Supabase invalide.");
  return createBrowserClient(config.url, config.anonKey);
}