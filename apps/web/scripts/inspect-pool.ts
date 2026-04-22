import { PrismaClient, Rarity } from "@prisma/client";

const prisma = new PrismaClient();

const RARITIES: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

async function main() {
  const cards = await prisma.card.findMany({
    select: { rarityBucket: true, basePrice: true, name: true },
  });

  console.log(`Total cards in pool: ${cards.length}\n`);

  for (const bucket of RARITIES) {
    const inBucket = cards
      .filter((c) => c.rarityBucket === bucket)
      .map((c) => ({ name: c.name, price: Number(c.basePrice) }))
      .sort((a, b) => a.price - b.price);
    if (inBucket.length === 0) {
      console.log(`${bucket}: 0 cards`);
      continue;
    }
    const prices = inBucket.map((c) => c.price);
    const n = prices.length;
    const min = prices[0];
    const max = prices[n - 1];
    const mean = prices.reduce((a, b) => a + b, 0) / n;
    const median = prices[Math.floor(n / 2)];
    const fallback = prices.filter((p) => p === 0.25).length;
    const p90 = prices[Math.floor(n * 0.9)];
    const p10 = prices[Math.floor(n * 0.1)];
    console.log(
      `${bucket.padEnd(10)} n=${n.toString().padStart(3)}  min=$${min.toFixed(2)}  p10=$${p10.toFixed(2)}  median=$${median.toFixed(2)}  mean=$${mean.toFixed(2)}  p90=$${p90.toFixed(2)}  max=$${max.toFixed(2)}  fallback_$0.25=${fallback}/${n}`,
    );
    if (bucket === "EPIC" || bucket === "LEGENDARY") {
      console.log(`   bottom 3: ${inBucket.slice(0, 3).map((c) => `${c.name} $${c.price.toFixed(2)}`).join(", ")}`);
      console.log(`   top 3:    ${inBucket.slice(-3).reverse().map((c) => `${c.name} $${c.price.toFixed(2)}`).join(", ")}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
