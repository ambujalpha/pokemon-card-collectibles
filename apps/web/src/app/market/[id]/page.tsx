import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { ListingDetail } from "@/components/listing-detail";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <ListingDetail listingId={id} buyerBalance={formatMoney(user.balance)} />
      </main>
    </div>
  );
}
