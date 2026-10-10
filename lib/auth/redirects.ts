const fallbackPath = "/dashboard";
const localOrigin = "https://ai-finance-os.invalid";

export function getSafeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) {
    return fallbackPath;
  }

  try {
    const destination = new URL(next, localOrigin);
    if (destination.origin !== localOrigin || destination.pathname.startsWith("//")) return fallbackPath;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallbackPath;
  }
}

export function getLoginRedirectPath(pathname: string, search = ""): string {
  const requestedPath = `${pathname}${search}`;
  return `/login?next=${encodeURIComponent(getSafeRedirectPath(requestedPath))}`;
}

export function getProtectedRouteRedirect(
  isAuthenticated: boolean,
  pathname: string,
  search = "",
): string | null {
  return isAuthenticated ? null : getLoginRedirectPath(pathname, search);
}