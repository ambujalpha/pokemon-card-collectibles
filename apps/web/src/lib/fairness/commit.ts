import { createHash, randomBytes } from "node:crypto";

// Phase 11 commit-reveal primitives. See docs/qa/phase-11-provably-fair.md.

export interface FairnessCommit {
  serverSeedHex: string;
  serverSeedHashHex: string;
  clientSeed: string;
}

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "hex")).digest("hex");
}

export function newCommit(clientSeed: string | undefined): FairnessCommit {
  const serverSeedHex = generateServerSeed();
  const serverSeedHashHex = sha256Hex(serverSeedHex);
  return {
    serverSeedHex,
    serverSeedHashHex,
    // If the client didn't supply a seed, generate one — see Q&A §3.
    clientSeed: clientSeed && clientSeed.length > 0 ? clientSeed : randomBytes(16).toString("hex"),
  };
}

export function verifyCommit(serverSeedHex: string, expectedHashHex: string): boolean {
  return sha256Hex(serverSeedHex).toLowerCase() === expectedHashHex.toLowerCase();
}
