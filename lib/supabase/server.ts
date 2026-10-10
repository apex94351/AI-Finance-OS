import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginRedirectPath } from "@/lib/auth/redirects";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function getAuthenticatedSupabase(pathname: string) {
  const config = getSupabaseConfig();
  if (!config) redirect(getLoginRedirectPath(pathname));

  const cookieStore = await cookies();
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          return;
        }
      },
    },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(getLoginRedirectPath(pathname));
  return { supabase, user };
}

export async function requireAuthenticatedUser(pathname: string) {
  const { user } = await getAuthenticatedSupabase(pathname);
  return user;
}