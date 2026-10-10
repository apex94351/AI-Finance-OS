import { getAuthErrorMessage } from "@/lib/auth/errors";

type SignUpRequest = {
  email: string;
  password: string;
  options: {
    data: { first_name: string; last_name: string; full_name: string };
    emailRedirectTo: string;
  };
};

type SignUp = (request: SignUpRequest) => Promise<{
  data: { session: unknown | null };
  error: { message: string } | null;
}>;

type RegistrationCredentials = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

export async function registerWithPassword(
  signUp: SignUp,
  credentials: RegistrationCredentials,
  emailRedirectTo: string,
): Promise<{ error: string } | { confirmationRequired: boolean }> {
  const { data, error } = await signUp({
    email: credentials.email,
    password: credentials.password,
    options: {
      data: {
        first_name: credentials.firstName,
        last_name: credentials.lastName,
        full_name: `${credentials.firstName} ${credentials.lastName}`,
      },
      emailRedirectTo,
    },
  });

  if (error) return { error: getAuthErrorMessage(error.message) };
  return { confirmationRequired: !data.session };
}