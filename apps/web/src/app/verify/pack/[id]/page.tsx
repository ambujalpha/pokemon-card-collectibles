"use client";

import { use, useEffect, useMemo, useState } from "react";

type FairnessApi = {
  purchaseId: string;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  nonce: string;
  weightVersionId: string | null;
  weights: Record<string, number> | null;
  committedAt: string;
  revealedAt: string | null;
};

type PackContents = {
  cards: Array<{ position: number; cardId: string; rarity: string; name: string }>;
};

const BUCKETS = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

export default function VerifyPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [fairness, setFairness] = useState<FairnessApi | null>(null);
  const [contents, setContents] = useState<PackContents | null>(null);
  const [pool, setPool] = useState<Array<{ id: string; rarityBucket: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<null | {
    hashOk: boolean;
    cardsOk: boolean;
    expected: string[];
    actual: string[];
  }>(null);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/fairness/${id}`).then((r) => r.json()),
      fetch(`/api/packs/${id}/contents`).then((r) => r.json()).catch(() => null),
      fetch(`/api/cards/pool`).then((r) => r.json()).catch(() => null),
    ]).then(([f, c, p]) => {
      if ("error" in f) setError(f.error);
      else setFairness(f as FairnessApi);
      if (c && "cards" in c) setContents(c as PackContents);
      if (p && "cards" in p) setPool(p.cards as { id: string; rarityBucket: string }[]);
    });
  }, [id]);

  const canVerify = useMemo(() => {
    return fairness?.serverSeed && fairness?.weights && pool && contents;
  }, [fairness, pool, contents]);

  async function runVerify() {
    if (!fairness?.serverSeed || !fairness.weights || !pool || !contents) return;
    const hashOk = await verifyHash(fairness.serverSeed, fairness.serverSeedHash);
    const expected = await reproduceCards(
      fairness.serverSeed,
      fairness.clientSeed,
      fairness.nonce,
      fairness.weights,
      pool,
    );
    const actual = [...contents.cards].sort((a, b) => a.position - b.position).map((c) => c.cardId);
    const cardsOk = expected.length === actual.length && expected.every((id, i) => id === actual[i]);
    setVerifyResult({ hashOk, cardsOk, expected, actual });
  }

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto", fontFamily: "ui-sans-serif" }}>
      <h1>Verify pack {id}</h1>
      {error && <p style={{ color: "tomato" }}>Error: {error}</p>}
      {fairness && (
        <section style={{ marginTop: 16 }}>
          <h2>Commit / reveal</h2>
          <ul>
            <li><strong>Server seed hash</strong>: <code>{fairness.serverSeedHash}</code></li>
            <li><strong>Server seed</strong>: <code>{fairness.serverSeed ?? "(not yet revealed)"}</code></li>
            <li><strong>Client seed</strong>: <code>{fairness.clientSeed}</code></li>
            <li><strong>Nonce</strong>: <code>{fairness.nonce}</code></li>
            <li><strong>Committed at</strong>: {fairness.committedAt}</li>
            <li><strong>Revealed at</strong>: {fairness.revealedAt ?? "—"}</li>
            <li><strong>Weight version</strong>: <code>{fairness.weightVersionId ?? "(static fallback)"}</code></li>
          </ul>
          <button onClick={runVerify} disabled={!canVerify} style={{ marginTop: 12 }}>
            Run verification
          </button>
        </section>
      )}
      {verifyResult && (
        <section style={{ marginTop: 24 }}>
          <h2>Result</h2>
          <p>Hash check: {verifyResult.hashOk ? "✅ matches" : "❌ MISMATCH"}</p>
          <p>Card check: {verifyResult.cardsOk ? "✅ all 5 cards reproduce" : "❌ MISMATCH"}</p>
          <details><summary>Expected cards</summary><pre>{verifyResult.expected.join("\n")}</pre></details>
          <details><summary>Actual cards (from pack record)</summary><pre>{verifyResult.actual.join("\n")}</pre></details>
        </section>
      )}
    </main>
  );
}

// ─── pure browser helpers ────────────────────────────────────────────────

async function verifyHash(serverSeedHex: string, expectedHashHex: string): Promise<boolean> {
  const seedBytes = hexToBytes(serverSeedHex);
  const digest = await crypto.subtle.digest("SHA-256", seedBytes.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest)) === expectedHashHex.toLowerCase();
}

async function reproduceCards(
  serverSeedHex: string,
  clientSeed: string,
  nonce: string,
  weights: Record<string, number>,
  pool: Array<{ id: string; rarityBucket: string }>,
): Promise<string[]> {
  const rarityBytes = await hmacSha256(serverSeedHex, `${clientSeed}:${nonce}:rarity`);
  const cardBytes = await hmacSha256(serverSeedHex, `${clientSeed}:${nonce}:card`);

  const byBucket: Record<string, { id: string }[]> = {
    COMMON: [], UNCOMMON: [], RARE: [], EPIC: [], LEGENDARY: [],
  };
  for (const c of pool) byBucket[c.rarityBucket]?.push({ id: c.id });
  for (const b of BUCKETS) byBucket[b]!.sort((a, c) => a.id.localeCompare(c.id));

  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const u1 = bytesToUniform48(rarityBytes, i * 6);
    const u2 = bytesToUniform48(cardBytes, i * 6);
    const r = pickRarity(u1, weights);
    let bucket = byBucket[r]!;
    if (bucket.length === 0) {
      for (const b of BUCKETS) if (byBucket[b]!.length > 0) { bucket = byBucket[b]!; break; }
    }
    const idx = Math.floor(u2 * bucket.length);
    out.push(bucket[idx]!.id);
  }
  return out;
}

function pickRarity(u: number, weights: Record<string, number>): string {
  let acc = 0;
  for (const b of BUCKETS) {
    acc += weights[b] ?? 0;
    if (u <= acc) return b;
  }
  return "LEGENDARY";
}

async function hmacSha256(keyHex: string, msg: string): Promise<Uint8Array> {
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey(
    "raw", keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const msgBytes = new TextEncoder().encode(msg);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes.buffer as ArrayBuffer);
  return new Uint8Array(sig);
}

function bytesToUniform48(bytes: Uint8Array, offset: number): number {
  const hi = (bytes[offset]! << 8) | bytes[offset + 1]!;
  const lo =
    (bytes[offset + 2]! * 2 ** 24) +
    (bytes[offset + 3]! << 16) +
    (bytes[offset + 4]! << 8) +
    bytes[offset + 5]!;
  return (hi * 2 ** 32 + lo) / 2 ** 48;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
