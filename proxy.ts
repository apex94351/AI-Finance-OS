import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getProtectedRouteRedirect } from "@/lib/auth/redirects";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) return redirectToLogin(request);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  const redirectPath = getProtectedRouteRedirect(
    !error && Boolean(user),
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (redirectPath) return NextResponse.redirect(new URL(redirectPath, request.url));
  return response;
}

function redirectToLogin(request: NextRequest) {
  const redirectPath = getProtectedRouteRedirect(
    false,
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  return NextResponse.redirect(new URL(redirectPath ?? "/login", request.url));
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/invoices/:path*",
    "/finance/:path*",
    "/expenses/:path*",
    "/treasury/:path*",
    "/revenue/:path*",
    "/due-dates/:path*",
    "/documents/:path*",
    "/customers/:path*",
    "/suppliers/:path*",
    "/team/:path*",
    "/analytics/:path*",
    "/ai/:path*",
    "/automations/:path*",
  ],
};