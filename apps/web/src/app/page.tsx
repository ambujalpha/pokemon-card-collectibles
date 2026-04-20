import { redirect } from "next/navigation";

import { AddFundsButton } from "@/components/add-funds-button";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, balance: true, balanceHeld: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="font-semibold tracking-tight">PullVault</div>
        <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-sm uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Balance
          </h1>
          <p className="mt-2 text-4xl font-semibold tabular-nums">
            ${formatMoney(user.balance)}
          </p>
          {user.balanceHeld.toString() !== "0" && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              ${formatMoney(user.balanceHeld)} held
            </p>
          )}
          <div className="mt-6">
            <AddFundsButton />
          </div>
          <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
            Packs, trading, and auctions unlock in later phases.
          </p>
        </section>
      </main>
    </div>
  );
}
