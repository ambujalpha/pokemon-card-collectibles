import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Tab = "selling" | "bidding" | "won" | "sold";

function resolveTab(raw: string | string[] | undefined): Tab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "bidding") return "bidding";
  if (v === "won") return "won";
  if (v === "sold") return "sold";
  return "selling";
}

export default async function MyAuctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(rawTab);

  let auctions: Array<{
    id: string; status: string; currentBid: unknown; startingBid: unknown;
    closesAt: Date; closedAt: Date | null; winnerId: string | null; sellerId: string;
    userCard: { card: { name: string; rarityBucket: string; imageUrl: string; basePrice: unknown } };
  }>;

  if (tab === "selling") {
    auctions = await prisma.auction.findMany({
      where: { sellerId: session.userId, status: "LIVE" },
      orderBy: { closesAt: "asc" },
      include: { userCard: { include: { card: true } } },
    });
  } else if (tab === "sold") {
    auctions = await prisma.auction.findMany({
      where: { sellerId: session.userId, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      include: { userCard: { include: { card: true } } },
    });
  } else if (tab === "bidding") {
    // Live auctions where I'm the current high bidder OR have placed any bid.
    const bidded = await prisma.bid.findMany({
      where: { bidderId: session.userId, auction: { status: "LIVE" } },
      distinct: ["auctionId"],
      orderBy: { createdAt: "desc" },
      include: {
        auction: { include: { userCard: { include: { card: true } } } },
      },
    });
    auctions = bidded.map((b) => b.auction);
  } else {
    auctions = await prisma.auction.findMany({
      where: { winnerId: session.userId, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      include: { userCard: { include: { card: true } } },
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My auctions</h1>
        </div>

        <nav className="flex gap-2">
          {(["selling", "bidding", "won", "sold"] as Tab[]).map((t) => (
            <Link
              key={t}
              href={`/me/auctions?tab=${t}`}
              className={`inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium ${tab === t ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </Link>
          ))}
        </nav>

        {auctions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Nothing here.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {auctions.map((a) => {
              const price = Number((a.currentBid ?? a.startingBid) as string | number);
              const when = a.closedAt ?? a.closesAt;
              return (
                <li key={a.id}>
                  <Link href={`/auctions/${a.id}`} className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600">
                    <div className="h-20 w-[58px] shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.userCard.card.imageUrl} alt={a.userCard.card.name} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{a.userCard.card.name}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {a.userCard.card.rarityBucket[0] + a.userCard.card.rarityBucket.slice(1).toLowerCase()}
                        {" · "}{a.status}
                        {" · "}{new Date(when).toISOString().slice(0, 16).replace("T", " ")} UTC
                      </span>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-base font-semibold">${price.toFixed(2)}</div>
                      <div className="text-xs text-zinc-500">mkt ${Number(a.userCard.card.basePrice as string | number).toFixed(2)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
