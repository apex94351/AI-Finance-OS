import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/lib/supabase/server";

export default async function SectionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  await requireAuthenticatedUser(`/${section}`);
  return children;
}
