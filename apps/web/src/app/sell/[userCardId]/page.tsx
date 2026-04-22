import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SellForm } from "@/components/sell-form";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function SellPage({
  params,
}: {
  params: Promise<{ userCardId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const { userCardId } = await params;
  const userCard = await prisma.userCard.findUnique({
    where: { id: userCardId },
    select: {
      id: true,
      userId: true,
      status: true,
      acquiredPrice: true,
      card: {
        select: {
          name: true,
          imageUrl: true,
          rarityBucket: true,
          basePrice: true,
        },
      },
    },
  });

  if (!userCard || userCard.userId !== session.userId) {
    redirect("/collection");
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">List card for sale</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Set your ask price. Platform takes a 5% fee on successful sale.
          </p>
        </div>
        <SellForm
          userCardId={userCard.id}
          name={userCard.card.name}
          imageUrl={userCard.card.imageUrl}
          rarity={userCard.card.rarityBucket}
          marketPrice={userCard.card.basePrice.toFixed(4)}
          acquiredPrice={userCard.acquiredPrice.toFixed(4)}
          alreadyListed={userCard.status === "LISTED"}
        />
      </main>
    </div>
  );
}
