import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/supabase/server";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser("/settings");
  return children;
}