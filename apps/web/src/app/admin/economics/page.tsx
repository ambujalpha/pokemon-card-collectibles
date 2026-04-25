import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { EconomicsDashboardTabs } from "@/components/economics-dashboard-tabs";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function EconomicsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/");

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform economics</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Realised margins, fee revenue, and top users. Cached 5 minutes; use Refresh for a fresh read.
          </p>
        </div>
        <EconomicsDashboardTabs />
      </main>
    </div>
  );
}
