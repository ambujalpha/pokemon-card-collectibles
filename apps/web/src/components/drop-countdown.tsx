"use client";

import { useEffect, useState } from "react";

function formatHms(ms: number): string {
  if (ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function DropCountdown({ to, label = "Opens in" }: { to: string; label?: string }) {
  const target = new Date(to).getTime();
  // Defer time read to after mount so SSR and the first client render produce
  // identical HTML (no hydration mismatch). Until then, show "—".
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
      <span>{label}</span>
      <span className="font-medium text-zinc-900 dark:text-zinc-100">
        {now === null ? "—" : formatHms(target - now)}
      </span>
    </span>
  );
}
