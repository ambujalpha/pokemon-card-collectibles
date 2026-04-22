import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
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
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
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

