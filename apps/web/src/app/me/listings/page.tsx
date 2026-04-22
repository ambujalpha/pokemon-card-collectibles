import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Tab = "active" | "sold" | "cancelled";
const STATUS_MAP: Record<Tab, "ACTIVE" | "SOLD" | "CANCELLED"> = {
  active: "ACTIVE",
  sold: "SOLD",
  cancelled: "CANCELLED",
};

function resolveTab(raw: string | string[] | undefined): Tab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "sold") return "sold";
  if (v === "cancelled") return "cancelled";
  return "active";
}

export default async function MyListingsPage({
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

  const listings = await prisma.listing.findMany({
    where: { sellerId: session.userId, status: STATUS_MAP[tab] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      priceAsk: true,
      createdAt: true,
      soldAt: true,
      cancelledAt: true,
      userCard: {
        select: {
          card: { select: { name: true, rarityBucket: true, imageUrl: true, basePrice: true } },
        },
      },
    },
  });

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My listings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Active listings, past sales and cancellations.
          </p>
        </div>

        <nav className="flex gap-2">
          {(["active", "sold", "cancelled"] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <Link
                key={t}
                href={`/me/listings?tab=${t}`}
                className={`inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </Link>
            );
          })}
        </nav>

        {listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Nothing here.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {listings.map((l) => {
              const when = l.soldAt ?? l.cancelledAt ?? l.createdAt;
              return (
                <li key={l.id}>
                  <Link
                    href={`/market/${l.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                  >
                    <div className="h-20 w-[58px] shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.userCard.card.imageUrl} alt={l.userCard.card.name} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{l.userCard.card.name}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {l.userCard.card.rarityBucket[0] + l.userCard.card.rarityBucket.slice(1).toLowerCase()}
                        {" · "}
                        {new Date(when).toISOString().slice(0, 16).replace("T", " ")} UTC
                      </span>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-base font-semibold">${Number(l.priceAsk).toFixed(2)}</div>
                      <div className="text-xs text-zinc-500">mkt ${Number(l.userCard.card.basePrice).toFixed(2)}</div>
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
