import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AuctionsBrowse } from "@/components/auctions-browse";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AuctionsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Auctions</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Live auctions end on the clock. Last-30s bids extend by +30s (max 20 extensions).
          </p>
        </div>
        <AuctionsBrowse />
      </main>
    </div>
  );
}
