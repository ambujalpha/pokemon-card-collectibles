import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { RevealFlow } from "@/components/reveal-flow";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { TIER_PRICES_USD } from "@/lib/rarity-weights";

export const dynamic = "force-dynamic";

type RawMode = string | string[] | undefined;

function resolveMode(raw: RawMode): "animate" | "static" {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "static" ? "static" : "animate";
}

export default async function RevealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const { mode } = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true },
  });
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <Header email={user.email} balance={formatMoney(user.balance)} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <Link
          href="/me/packs"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← My packs
        </Link>
        <RevealFlow
          packId={id}
          mode={resolveMode(mode)}
          tierPrices={TIER_PRICES_USD}
        />
      </main>
    </div>
  );
}

function Header({ email, balance }: { email: string; balance: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="font-semibold tracking-tight">
          PullVault
        </Link>
        <Link
          href="/drops"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Drops
        </Link>
        <Link
          href="/me/packs"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          My packs
        </Link>
      </nav>
      <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="tabular-nums">${balance}</span>
        <span>{email}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
