import { z } from "zod";
import { locales, type Locale } from "@/i18n/messages";

const preferencesSchema = z.object({
  locale: z.enum(locales),
  theme: z.enum(["light", "dark", "system"]),
});

export interface AuthUserProfileSource {
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface UserProfileSettings {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  locale: Locale;
}

export function getUserProfileSettings(user: AuthUserProfileSource): {
  profile: UserProfileSettings;
  preferences: z.infer<typeof preferencesSchema> | null;
} {
  const metadata = user.user_metadata ?? {};
  const parsedPreferences = preferencesSchema.safeParse(metadata.ai_finance_preferences);
  return {
    profile: {
      firstName: typeof metadata.first_name === "string" ? metadata.first_name : "",
      lastName: typeof metadata.last_name === "string" ? metadata.last_name : "",
      email: user.email ?? "",
      phone: typeof metadata.phone === "string" ? metadata.phone : "",
      country: typeof metadata.country_of_residence === "string" ? metadata.country_of_residence : "",
      locale: parsedPreferences.success ? parsedPreferences.data.locale : "fr",
    },
    preferences: parsedPreferences.success ? parsedPreferences.data : null,
  };
}
