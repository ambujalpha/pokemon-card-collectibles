import Link from "next/link";

import { AdminRefreshButton } from "./admin-refresh-button";
import { LogoutButton } from "./logout-button";

interface Props {
  email: string;
  // Balance shown in the header on every page except the dashboard (where
  // balance is the main content). Omit to hide.
  balance?: string;
  // When true, the admin price-refresh pill is rendered.
  isAdmin?: boolean;
}

export function AppHeader({ email, balance, isAdmin }: Props) {
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
        <Link
          href="/collection"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Collection
        </Link>
        <Link
          href="/market"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Market
        </Link>
        <Link
          href="/me/listings"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          My listings
        </Link>
      </nav>
      <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        {isAdmin ? <AdminRefreshButton /> : null}
        {balance !== undefined ? <span className="tabular-nums">${balance}</span> : null}
        <span>{email}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
