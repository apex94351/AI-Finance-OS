export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export function getSupabaseConfigIssue(): string | null {
  const missingVariables = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);

  if (missingVariables.length > 0) {
    return `Configuration Supabase incomplète. Définissez ${missingVariables.join(" et ")} dans .env.local puis redémarrez le serveur.`;
  }

  try {
    const parsedUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim());
    if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
      throw new Error("Invalid URL");
    }
  } catch {
    return "La valeur de NEXT_PUBLIC_SUPABASE_URL doit être une URL HTTP(S) valide.";
  }

  return null;
}

export function getSupabaseConfig() {
  if (getSupabaseConfigIssue()) return null;
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  };
}