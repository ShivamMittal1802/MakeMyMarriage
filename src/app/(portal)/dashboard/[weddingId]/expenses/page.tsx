import { redirect, notFound } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { GuestLayout } from "@/modules/guests/layout";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";
import {
  getExpense,
  listExpenses,
  expenseSummary,
} from "@/modules/expenses/service";
import { Overview, Details, ExpenseForm } from "@/modules/expenses/workspace";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ weddingId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account)) redirect("/onboarding");
  const { weddingId: w } = await params,
    p = await searchParams,
    a = { id: String(account._id), sessionVersion: account.sessionVersion };
  async function loadView() {
    if (p.expense) {
      const e = await getExpense(a, w, p.expense);
      return p.view === "edit" || p.view === "payment" ? (
        <ExpenseForm w={w} expense={e} payment={p.view === "payment"} />
      ) : (
        <Details w={w} expense={e} />
      );
    } else {
      const summary = await expenseSummary(a, w);
      return p.view === "new" ? (
        <ExpenseForm w={w} />
      ) : (
        <Overview
          key={JSON.stringify(p)}
          w={w}
          summary={summary}
          initial={await listExpenses(a, w, {
            outstanding: p.outstanding as "true" | "false" | undefined,
            dueBefore: p.dueBefore || undefined,
          })}
          outstanding={p.outstanding}
          dueBefore={p.dueBefore || undefined}
        />
      );
    }
  }
  let content;
  try {
    content = await loadView();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.status === 401) redirect("/login");
    if (e.status === 404) notFound();
    content = <SetupUnavailable message={e.message} />;
  }
  return (
    <GuestLayout w={w} email={account.emailNormalized} active="expenses">
      {content}
    </GuestLayout>
  );
}
