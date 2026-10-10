import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth/redirects";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const destination = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  const code = requestUrl.searchParams.get("code");
  const config = getSupabaseConfig();

  if (!code || !config) {
    return NextResponse.redirect(new URL("/login?authError=callback", request.url));
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(destination, request.url));
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?authError=callback", request.url));
  }
  return response;
}