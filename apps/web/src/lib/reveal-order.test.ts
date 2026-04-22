import { Rarity } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { sortPackCards } from "./reveal-order";

describe("reveal-order.sortPackCards", () => {
  it("sorts Common → Legendary (least valuable first)", () => {
    const input = [
      { position: 1, rarityBucket: "LEGENDARY" as Rarity },
      { position: 2, rarityBucket: "COMMON" as Rarity },
      { position: 3, rarityBucket: "EPIC" as Rarity },
      { position: 4, rarityBucket: "UNCOMMON" as Rarity },
      { position: 5, rarityBucket: "RARE" as Rarity },
    ];
    const out = sortPackCards(input).map((c) => c.rarityBucket);
    expect(out).toEqual(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]);
  });

  it("breaks rarity ties by position ASC", () => {
    const input = [
      { position: 4, rarityBucket: "COMMON" as Rarity },
      { position: 1, rarityBucket: "COMMON" as Rarity },
      { position: 3, rarityBucket: "COMMON" as Rarity },
    ];
    const out = sortPackCards(input).map((c) => c.position);
    expect(out).toEqual([1, 3, 4]);
  });

  it("is a pure sort — input is not mutated", () => {
    const input = [
      { position: 1, rarityBucket: "LEGENDARY" as Rarity },
      { position: 2, rarityBucket: "COMMON" as Rarity },
    ];
    const snapshot = input.map((c) => c.rarityBucket);
    sortPackCards(input);
    expect(input.map((c) => c.rarityBucket)).toEqual(snapshot);
  });

  it("Legendary always lands last when present", () => {
    const input = [
      { position: 1, rarityBucket: "LEGENDARY" as Rarity },
      { position: 2, rarityBucket: "RARE" as Rarity },
      { position: 3, rarityBucket: "COMMON" as Rarity },
      { position: 4, rarityBucket: "COMMON" as Rarity },
      { position: 5, rarityBucket: "UNCOMMON" as Rarity },
    ];
    const out = sortPackCards(input);
    expect(out[out.length - 1].rarityBucket).toBe("LEGENDARY");
  });
});
