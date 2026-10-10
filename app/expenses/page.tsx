import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { ExpenseManager } from "@/database/components/expenses/expense-manager";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  expenseRowSchema,
  expenseSupplierRowSchema,
  mapExpense,
} from "@/services/expenses";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({
  id: z.uuid(),
  name: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}));

export default async function ExpensesPage() {
  const { supabase, user } = await getAuthenticatedSupabase("/expenses");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Expense membership query failed", { code: membershipResult.error.code });
    return <AppShell pageTitle="expenses"><ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." supplierWarning={null} /></AppShell>;
  }
  const membership = membershipSchema.safeParse(membershipResult.data);
  if (!membership.success) {
    console.error("Expense membership query returned an unexpected result");
    return <AppShell pageTitle="expenses"><ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError="La liste des espaces associés reçue est invalide." supplierWarning={null} /></AppShell>;
  }

  const companyIds = [...new Set(membership.data.map(({ company_id }) => company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length) {
    const result = await supabase.from("companies").select("id, name, currency").in("id", companyIds);
    if (result.error) {
      console.error("Expense company query failed", { code: result.error.code });
      return <AppShell pageTitle="expenses"><ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError="Impossible de charger les entreprises associées à votre compte." supplierWarning={null} /></AppShell>;
    }
    companyRows = result.data;
  }
  const companies = companySchema.safeParse(companyRows);
  if (!companies.success) {
    console.error("Expense company query returned an unexpected result");
    return <AppShell pageTitle="expenses"><ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError="Les informations d’entreprise reçues ne sont pas au format attendu." supplierWarning={null} /></AppShell>;
  }

  const companyIdsAccessible = companies.data.map(({ id }) => id);
  const [personalExpenses, companyExpenses, personalSuppliers, companySuppliers] = await Promise.all([
    supabase.from("expenses")
      .select("id, user_id, company_id, label, amount, currency, expense_date, category, supplier_id, status, notes, created_at, updated_at")
      .eq("user_id", user.id).is("company_id", null).order("expense_date", { ascending: false }),
    companyIdsAccessible.length
      ? supabase.from("expenses")
        .select("id, user_id, company_id, label, amount, currency, expense_date, category, supplier_id, status, notes, created_at, updated_at")
        .in("company_id", companyIdsAccessible).is("user_id", null).order("expense_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("suppliers").select("id, user_id, company_id, name")
      .eq("user_id", user.id).is("company_id", null).order("name"),
    companyIdsAccessible.length
      ? supabase.from("suppliers").select("id, user_id, company_id, name")
        .in("company_id", companyIdsAccessible).is("user_id", null).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const expenseError = personalExpenses.error ?? companyExpenses.error;
  if (expenseError) {
    console.error("Expense query failed", { code: expenseError.code });
    const migrationMissing = ["42P01", "42703", "PGRST205"].includes(expenseError.code ?? "");
    const message = migrationMissing
      ? "La table des dépenses n’est pas disponible. Appliquez manuellement la migration 009_expenses.sql après les migrations 006 et 008."
      : "Impossible de charger les dépenses. Réessayez plus tard.";
    return <AppShell pageTitle="expenses"><ExpenseManager companies={companies.data} suppliers={[]} expenses={[]} loadError={message} supplierWarning={null} /></AppShell>;
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse([
    ...(personalExpenses.data ?? []),
    ...(companyExpenses.data ?? []),
  ]);
  if (!parsedExpenses.success) {
    console.error("Expense query returned an unexpected result");
    return <AppShell pageTitle="expenses"><ExpenseManager companies={companies.data} suppliers={[]} expenses={[]} loadError="Les dépenses reçues ne sont pas au format attendu." supplierWarning={null} /></AppShell>;
  }

  const supplierWarning = personalSuppliers.error || companySuppliers.error
    ? "Les dépenses sont chargées, mais la liste des fournisseurs n’est pas disponible."
    : null;
  if (supplierWarning) console.error("Expense supplier query failed", { code: personalSuppliers.error?.code ?? companySuppliers.error?.code });
  const parsedSuppliers = z.array(expenseSupplierRowSchema).safeParse([
    ...(personalSuppliers.data ?? []),
    ...(companySuppliers.data ?? []),
  ]);
  if (!parsedSuppliers.success) {
    console.error("Expense supplier query returned an unexpected result");
    return <AppShell pageTitle="expenses"><ExpenseManager companies={companies.data} suppliers={[]} expenses={parsedExpenses.data.map((row) => mapExpense(row, []))} loadError={null} supplierWarning="Les informations des fournisseurs reçues ne sont pas au format attendu." /></AppShell>;
  }

  const suppliers = parsedSuppliers.data;
  return (
    <AppShell pageTitle="expenses">
      <ExpenseManager
        companies={companies.data}
        suppliers={suppliers}
        expenses={parsedExpenses.data.map((row) => mapExpense(row, suppliers))}
        loadError={null}
        supplierWarning={supplierWarning}
        today={new Date().toISOString().slice(0, 10)}
      />
    </AppShell>
  );
}
