import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Tab = "unopened" | "opened";

const TIER_LABEL: Record<"STARTER" | "PREMIUM" | "ULTRA", { name: string; tone: string }> = {
  STARTER: {
    name: "Starter",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  },
  PREMIUM: {
    name: "Premium",
    tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  },
  ULTRA: {
    name: "Ultra",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

function resolveTab(raw: string | string[] | undefined): Tab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "opened" ? "opened" : "unopened";
}

export default async function MyPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { tab: rawTab } = await searchParams;
  const tab = resolveTab(rawTab);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const packs = await prisma.userPack.findMany({
    where: { userId: session.userId, isRevealed: tab === "opened" },
    orderBy: { purchasedAt: "desc" },
    select: {
      id: true,
      dropId: true,
      purchasedAt: true,
      isRevealed: true,
      drop: { select: { packTier: true } },
    },
  });

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My packs</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {tab === "unopened"
              ? "Unopened packs waiting to be revealed."
              : "Packs you've already opened. Click to revisit."}
          </p>
        </div>

        <Tabs active={tab} />

        {packs.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="flex flex-col gap-3">
            {packs.map((p) => {
              const tier = TIER_LABEL[p.drop.packTier];
              const href =
                tab === "unopened"
                  ? `/packs/${p.id}/reveal`
                  : `/packs/${p.id}/reveal?mode=static`;
              const cta = tab === "unopened" ? "Reveal" : "View contents";
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tier.tone}`}
                    >
                      {tier.name}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {p.purchasedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    </span>
                  </div>
                  <Link
                    href={href}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {cta}
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

function Tabs({ active }: { active: Tab }) {
  const base =
    "inline-flex h-9 items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors";
  const activeCls = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const idle =
    "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
  return (
    <nav className="flex items-center gap-2">
      <Link
        href="/me/packs?tab=unopened"
        className={`${base} ${active === "unopened" ? activeCls : idle}`}
      >
        Unopened
      </Link>
      <Link
        href="/me/packs?tab=opened"
        className={`${base} ${active === "opened" ? activeCls : idle}`}
      >
        Opened
      </Link>
    </nav>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  if (tab === "unopened") {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No unopened packs.{" "}
        <Link href="/drops" className="underline">
          Head to the drops
        </Link>
        .
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      You haven&apos;t opened any packs yet. Find one in the{" "}
      <Link href="/me/packs?tab=unopened" className="underline">
        Unopened
      </Link>{" "}
      tab.
    </div>
  );
}

