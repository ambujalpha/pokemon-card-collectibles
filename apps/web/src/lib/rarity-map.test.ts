import { describe, expect, it } from "vitest";

import { RARITY_MAP, mapRarity } from "./rarity-map";

describe("rarity-map", () => {
  it("maps every entry in the lookup table to a known bucket", () => {
    const buckets = new Set(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]);
    for (const [tcgString, bucket] of Object.entries(RARITY_MAP)) {
      expect(buckets, `unknown bucket for ${tcgString}`).toContain(bucket);
    }
  });

  it("returns null for unknown rarity strings", () => {
    expect(mapRarity("Made Up Rarity")).toBeNull();
    expect(mapRarity("")).toBeNull();
    expect(mapRarity(null)).toBeNull();
    expect(mapRarity(undefined)).toBeNull();
  });

  it("canonical pokemontcg.io strings from Paldea Evolved all map", () => {
    const observedInSeed = [
      "Common",
      "Uncommon",
      "Rare",
      "Double Rare",
      "Ultra Rare",
      "Illustration Rare",
      "Special Illustration Rare",
      "Hyper Rare",
    ];
    for (const s of observedInSeed) {
      expect(mapRarity(s), `missing mapping for ${s}`).not.toBeNull();
    }
  });
});
