import { getSafeRedirectPath } from "@/lib/auth/redirects";

type Credentials = { email: string; password: string };
type SignIn = (credentials: Credentials) => Promise<{ error: { message: string } | null }>;

export async function signInWithPassword(
  signIn: SignIn,
  credentials: Credentials,
  next: string | null | undefined,
): Promise<{ error: string } | { redirectTo: string }> {
  const { error } = await signIn(credentials);
  if (error) return { error: error.message };
  return { redirectTo: getSafeRedirectPath(next) };
}