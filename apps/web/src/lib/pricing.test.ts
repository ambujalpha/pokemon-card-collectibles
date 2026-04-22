import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildChanges } from "./pricing";

type TestCard = { id: string; pokemontcgId: string; basePrice: Prisma.Decimal | string };

function card(id: string, pokemontcgId: string, basePrice: string): TestCard {
  return { id, pokemontcgId, basePrice };
}

describe("pricing.buildChanges", () => {
  it("emits exactly the cards whose price changed", () => {
    const cards = [
      card("c1", "sv2-1", "1.5000"),
      card("c2", "sv2-2", "2.0000"),
      card("c3", "sv2-3", "3.3300"),
    ];
    const newPrices = new Map([
      ["sv2-1", 1.5], // unchanged
      ["sv2-2", 2.5], // changed
      ["sv2-3", 3.33], // unchanged (decimal equality on 4dp)
    ]);
    const { changes, perCard } = buildChanges(cards, newPrices);
    expect(changes).toEqual([{ cardId: "c2", from: "2.0000", to: "2.5000" }]);
    expect(perCard.get("c1")?.hadFetched).toBe(true);
    expect(perCard.get("c2")?.hadFetched).toBe(true);
    expect(perCard.get("c3")?.hadFetched).toBe(true);
  });

  it("marks cards missing from the upstream response as not-fetched (stale)", () => {
    const cards = [card("c1", "sv2-1", "1.00"), card("c2", "sv2-2", "2.00")];
    const newPrices = new Map([["sv2-1", 1.5]]);
    const { changes, perCard } = buildChanges(cards, newPrices);
    expect(changes).toEqual([{ cardId: "c1", from: "1.0000", to: "1.5000" }]);
    expect(perCard.get("c2")?.hadFetched).toBe(false);
    expect(perCard.get("c2")?.newPrice).toBe("2.0000"); // old price preserved
  });

  it("uses 4-decimal comparison — no float drift classifies as a change", () => {
    // 0.1 + 0.2 !== 0.3 as float. But after Prisma.Decimal.toFixed(4), both
    // compare equal as "0.3000".
    const cards = [card("c1", "sv2-1", "0.3")];
    const newPrices = new Map([["sv2-1", 0.1 + 0.2]]);
    const { changes } = buildChanges(cards, newPrices);
    expect(changes).toEqual([]);
  });

  it("with jitter>0, all fetched cards become candidates for change but stay close to fetched price", () => {
    const cards = Array.from({ length: 100 }, (_, i) => card(`c${i}`, `id${i}`, "10.0000"));
    const newPrices = new Map(cards.map((c) => [c.pokemontcgId, 10]));
    const { changes, perCard } = buildChanges(cards, newPrices, 0.1);
    // With ±10% jitter applied to every fetched card, virtually all should
    // land different from 10.0000 (collisions at exactly 10.0000 are rare).
    expect(changes.length).toBeGreaterThan(80);
    // And every jittered price should remain inside [9, 11] (10 × 1 ± 0.1).
    for (const c of cards) {
      const p = Number(perCard.get(c.id)!.newPrice);
      expect(p).toBeGreaterThanOrEqual(9);
      expect(p).toBeLessThanOrEqual(11);
    }
  });

  it("floor-clamps jittered prices to $0.01", () => {
    const cards = [card("c1", "id1", "0.10")];
    const newPrices = new Map([["id1", 0.01]]);
    // Even with heavy negative jitter, output must not go below $0.01.
    const { perCard } = buildChanges(cards, newPrices, 0.99);
    const p = Number(perCard.get("c1")!.newPrice);
    expect(p).toBeGreaterThanOrEqual(0.01);
  });
});
