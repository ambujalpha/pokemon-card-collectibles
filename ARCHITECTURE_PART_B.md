# PullVault — Architecture, Part B

> The reviewer-facing addendum to [`ARCHITECTURE.md`](./ARCHITECTURE.md).
> Covers the five Part B requirements:
>
> 1. Pack economics algorithm (dynamic solver, target margins under shifting prices).
> 2. Anti-bot & rate limiting.
> 3. Auction integrity (sniping, fat-finger, wash trades).
> 4. Provably fair pack openings (commit-reveal + browser verifier).
> 5. Platform health dashboard (tabs, alerts, ack flow).
>
> Every claim here is grounded in code paths that ship on `main`. Schema
> additions are documented in [`DATABASE.md`](./DATABASE.md).

---

## 0. What changed at the system level

| Concern | Before | After |
|---|---|---|
| Pack rarity weights | Static constant in `lib/rarity-weights.ts`, calibrated once. | Solved per-tier from the latest price snapshot; pinned per pack via `user_packs.weight_version_id`. |
| Pack roll RNG | `Math.random` inside `pack-picker.ts`. | HMAC-SHA-256 deterministic stream over `(server_seed, client_seed, nonce)`. |
| Drop purchase admission | First-come-first-served. | Per-IP middleware floor + per-user rate limit + 0–500 ms jitter. |
| Auction bid validation | Increment + anti-snipe. | Above plus 5× fat-finger cap, 2 s same-user min interval, sealed final-minute window, post-close wash-trade scan. |
| Admin dashboard | Single revenue view. | Five tabs (Revenue / Fraud / Economic Health / Fairness / Users) + alert log with ack flow. |

Two new processes? **No.** Part B is entirely additive code in
`apps/web` plus six tables. `apps/ws` is unchanged. The deployment
diagram in `ARCHITECTURE.md §1` still applies as-is.

---

## 1. Pack economics — dynamic solver

### 1.1 Why replace the static weights

Part A calibrated `RARITY_WEIGHTS` once offline against fixed average
bucket prices. If the upstream feed re-prices a single SR card 10×
overnight, Ultra packs become loss-making and there is no mechanism to
detect or react. Static calibration is a snapshot; we needed a control
loop.

### 1.2 The closed form

Given a tier with price `P`, target margin `m`, and 5 buckets with mean
prices `μ_i`:

- Required EV per pack: `E = P · (1 − m)`. Per-card target: `e = E / 5`.
- Parametrise the simplex by `T_low = w_COMMON + w_UNCOMMON`. Preserve
  the calibrated `baseShape` ratio inside the *low* subset and inside the
  *high* subset (RARE+EPIC+LEGENDARY).
- Then `EV(T_low) = T_low · μ_low + (1 − T_low) · μ_high` is *linear*
  in T_low. Solve once: `T_low = (μ_high − e) / (μ_high − μ_low)`.

That's it. No LP solver, no WASM, no NumPy. With 5 buckets, 1 EV
equality, 1 simplex constraint, and 1 floor, the problem is
under-determined in exactly one dimension once the internal ratios are
fixed — and the dimension we kept is the one that is interpretable to
admins.

### 1.3 The win-rate floor (and why we clamp instead of throw)

A solver that minimises EV subject only to a margin target can satisfy
it with a "one jackpot, everyone else zero" distribution. To prevent
that, each tier carries a `winRateFloor` (0.40 / 0.50 / 0.60 for
Starter / Premium / Ultra) — a lower bound on `T_low`.

When the unclamped `T_low` would drop below the floor, we **clamp** and
return `constraintBinding: "winRateFloor"`. The realised margin then
ends up *above* target (house richer) — which is acceptable because:

- The win-rate floor is a player-protection invariant that should never
  be sacrificed for margin.
- The dashboard surfaces the binding so the admin can choose: raise the
  tier price, lower the floor, or accept the higher realised margin.

The solver only throws `SolverInfeasibleError` for **genuine**
infeasibility — per-bucket minima exceeding the simplex, or degenerate
prices where `μ_high ≤ μ_low`. The admin endpoint translates this into
a 409 with diagnostics.

### 1.4 Mid-drop rebalance safety

Concurrent rebalance vs unrevealed pack:

```
purchase(t0)            rebalance(t1)         reveal(t2)
   │                         │                    │
   │  read active version V1 │                    │
   │  pin V1 onto user_packs │                    │
   │  apply V1 weights ──────┼─→ pack_cards       │
   │                         │ deactivate V1      │
   │                         │ insert active V2   │
   │                         │ invalidate cache   │
   │                         │                    │  read user_packs.weight_version_id = V1
   │                         │                    │  (cards already in pack_cards from t0)
   ▼                         ▼                    ▼
```

Picks are written at purchase time using V1's weights; the version id
is pinned. Reveal does not re-roll. Rebalance affects *future*
purchases only.

### 1.5 Files

| Path | Purpose |
|---|---|
| `apps/web/src/lib/economics/solver.ts` | Pure closed-form solver. |
| `apps/web/src/lib/economics/winRate.ts` | Win definition + per-tier floors. |
| `apps/web/src/lib/economics/simulate.ts` | Seeded Monte-Carlo (`mulberry32`). |
| `apps/web/src/lib/economics/bucket-means.ts` | DB read of the latest mean price per bucket. |
| `apps/web/src/lib/active-weights.ts` | Active-version reader, 60 s TTL cache, pinned-version lookup. |
| `apps/web/src/app/api/admin/economics/simulate/route.ts` | Admin POST: simulate against active or proposed weights. |
| `apps/web/src/app/api/admin/economics/rebalance/route.ts` | Admin POST: solve all tiers and flip active. |

### 1.6 Reviewer test plan

- `pnpm test src/lib/economics` — closed-form within 0.01 % of target EV.
- `POST /api/admin/economics/simulate?tier=PREMIUM&n=10000` — realised
  margin within ±2 pp of 0.25.
- 10× spike on the EPIC bucket via `price_snapshots` insertion → next
  rebalance shifts the high-bucket mass downward.

---

## 2. Anti-bot & rate limiting

### 2.1 Layered defence, no CAPTCHA

| Layer | Where | Limit | Purpose |
|---|---|---|---|
| **Per-IP floor** | `src/middleware.ts` on `/api/*` | 60 req / 60 s | Stop a single host from sweeping endpoints. |
| **Per-user purchase cap** | `apps/web/src/app/api/drops/[id]/purchase/route.ts` | 6 / 60 s, 20 / 60 min | Stop a single account bursting through pack inventory. |
| **Fairness jitter** | Same purchase route, before tx | 0–500 ms uniform | Randomise admission order so a fast client can't deterministically out-race human bidders. |
| **Behavioural risk** | `lib/behavioralSignals.ts` on purchase + reveal | Score ≥ 100 → flag | Surface accounts whose pattern doesn't match a human. |

### 2.2 The rate-limit algorithm

`lib/ratelimit.ts` is a sliding-window-log over a Redis ZSET. The
prune → count → add cycle runs inside one Lua script:

```lua
ZREMRANGEBYSCORE key -inf (now - windowMs)
ZCARD key            -- count after prune
if count >= max then return {0, count, oldest+windowMs} end
ZADD key now <member>
PEXPIRE key windowMs
return {1, count+1, now+windowMs}
```

This gives exact counting (no edge-of-window 2× burst that a fixed-
window has) without WATCH/MULTI retry storms. Cost: O(log n) per call,
where n is `max` per window — small for our 60/min and 6/min limits.

### 2.3 Behavioural signals — co-occurrence required

Each signal is intentionally cheap and individually weak:

| Signal | Trigger | Weight |
|---|---|---|
| `rapidPurchase` | < 200 ms between two purchases by same user | +25 |
| `freshSession` | Purchase < 30 s after session start | +20 |
| `multiAccount` | ≥ 3 distinct user_ids share `(ip, ua_hash)` in last 24h | +40 |
| `fastReveal` | Reveal < 500 ms after purchase | +30 |

The threshold is **100**. The strongest signal alone (multiAccount, +40)
cannot flag. Two strong signals (multiAccount + fastReveal, 70) cannot
flag. It takes a *combination* — which is precisely the bot
fingerprint.

`hashUserAgent()` truncates SHA-256 to 16 hex chars — we never store
raw UA strings.

### 2.4 What we *don't* block

- **Shared NAT / VPN / campus IP.** The per-IP floor is loose (60/min)
  and per-user limits are stricter — so an office of legit collectors
  isn't penalised because one of them clicked fast.
- **Single-signal anomalies.** A fast clicker isn't a bot; a fast
  clicker who also created the account 10 s ago and shares a UA with
  three other accounts is.

### 2.5 Files

| Path | Purpose |
|---|---|
| `apps/web/src/lib/ratelimit.ts` | Sliding-window-log + multi-spec helper. |
| `apps/web/src/lib/fairness.ts` | `jitter(maxMs)` admission helper. |
| `apps/web/src/middleware.ts` | Per-IP floor on `/api/*`. |
| `apps/web/src/lib/behavioralSignals.ts` | Signal evaluators + risk-score upsert. |

---

## 3. Auction integrity

### 3.1 Bid-time hardening

Three layers run before the row-locked transaction:

1. **2-second per-user-per-auction lock** in Redis (`SET NX EX 2`).
   Returning false means a second bid arrived within the window —
   responds 429 `bid_too_fast`.
2. **5× overbid cap.** A bid more than 5× the current high is
   rejected with 400 `excessive_overbid`. Almost always a typo
   ($1.50 → $1500); the UI can prompt to confirm.
3. **Self-bid rejection.** Already in Phase 6, retained.

### 3.2 Sealed-bid final minute

When `closesAt - 60s ≤ now < closesAt`:

- The auction is in **sealed mode**. The `bid_placed` WS event is
  suppressed; a single `sealed_phase_started` event fires once when an
  auction enters the window via a fresh bid.
- The auction GET endpoint redacts `currentBid`, `currentBidderId`,
  `bids[]`, and `isLeading`. The `closesAt` field is preserved so the
  countdown still ticks.
- Anti-snipe still extends `closesAt` by +30 s on every bid (cap 20).
  This means a popular auction *moves out of and back into* the sealed
  window naturally as it extends.
- On close, a single `auction_closed` event carries the final bid and
  winner.

Result: an observer in the final minute cannot tell whether 0, 1, or
50 bids were placed — only that the auction is live and the timer is
ticking. Reactive sniping becomes blind sniping, which is just bidding.

We deliberately did **not** convert to a full Vickrey auction — it's a
different product with different bidder incentives. The sealed window
neutralises the specific reactive-sniping problem without rewriting the
English-auction UX.

### 3.3 Wash-trade detection — review queue, not punishment

Three heuristics run *after* settlement commits (errors there can't
roll back the transfer):

| Reason | Trigger |
|---|---|
| `repeat_pair` | Same `(seller, winner)` in ≥ 3 closed auctions in last 7 d. |
| `thin_low_clearance` | Final bid < 50 % of card's market price AND < 2 unique bidders. |
| `linked_high_clearance` | Final bid > 3× market price AND winner shares an `account_links` row with the seller. |

Each writes one row to `auction_flags` with a JSON detail blob. **No
row ever auto-actions a user.** Legit collectors trade with the same
partner repeatedly; flags are a dashboard review queue, the admin
decides.

### 3.4 Files

| Path | Purpose |
|---|---|
| `apps/web/src/lib/auction-integrity.ts` | Overbid cap, min-interval lock, sealed-window helpers. |
| `apps/web/src/app/api/auctions/[id]/bid/route.ts` | Bid placement (modified). |
| `apps/web/src/app/api/auctions/[id]/route.ts` | Auction read (sealed redaction). |
| `apps/web/src/lib/wash-trade-detect.ts` | Three heuristics + flag insert. |
| `apps/web/src/app/api/internal/auctions/settle-due/route.ts` | Calls detector post-commit. |
| `apps/web/src/app/api/admin/auctions/analytics/route.ts` | Snipe rate, flag counts, final-vs-market histogram. |

---

## 4. Provably fair pack openings

### 4.1 Commit-reveal, not signatures

Signatures prove *who* generated a value. We need to prove *when* —
specifically that the seed was fixed before the outcome was knowable.
Commit-reveal is the right primitive:

```
purchase                                reveal
   │                                       │
   │ server_seed ← randomBytes(32)         │
   │ commit_hash ← SHA-256(server_seed)    │
   │ store (server_seed, commit_hash,      │
   │        client_seed, nonce=pack_id)    │
   │ return commit_hash to client          │
   │                                       │
   │                                       │ stamp pack_fairness.revealed_at = NOW()
   │                                       │ return server_seed in response
   ▼                                       ▼
```

### 4.2 The deterministic roll

```
roll = HMAC_SHA-256(server_seed, client_seed || ":" || nonce || ":rarity")
       || HMAC_SHA-256(server_seed, client_seed || ":" || nonce || ":card")
```

Two HMAC chains so card-pick entropy is independent of rarity-pick
entropy.

Each chain produces 32 bytes, consumed as 5 × 6-byte (48-bit) slices
divided by `2^48` to give a uniform `[0,1)` per card slot. Slot uniform
→ rarity bucket via the cumulative weight vector pinned in
`pack_weight_versions`. Card uniform → index inside the bucket sorted
by id (so the verifier can reproduce ordering deterministically).

### 4.3 Browser-side verifier — no server trust

`/verify/pack/:id` is a client component using only WebCrypto:

1. `fetch /api/fairness/:id` — commit + (post-reveal) seed + pinned weights.
2. `fetch /api/packs/:id/contents` — actual cards in the pack.
3. `fetch /api/cards/pool` — canonical pool sorted by id.
4. In-browser: SHA-256(seed) → must equal commit hash.
5. In-browser: rebuild HMAC chains, reproduce the 5 card ids, compare
   to actual.

Zero server trust beyond the public commit/reveal record. If any step
mismatches, the verifier shows red. Tampering with `server_seed` in the
DB after reveal makes step 4 fail.

### 4.4 Pre-reveal protection

`server_seed` lives only in the DB. The public endpoint redacts it
(returns null) until `revealed_at IS NOT NULL`. This prevents a user
from "peeking" at their pack contents before the reveal animation
plays — which is a UX/privacy issue, not a fairness one (the outcome
is already determined at purchase).

### 4.5 Aggregate audit (statistical)

`/api/fairness/audit?window=…` computes `χ²` GOF per tier using
`lib/chi-squared.ts` (Wilson–Hilferty p-value, no SciPy dependency).
Compares observed rarity counts in revealed packs to the *active*
`pack_weight_versions` row's advertised weights.

| p-value | Verdict |
|---|---|
| `> 0.05` | Statistically indistinguishable from advertised. ✅ |
| `0.01 – 0.05` | Watch list. 🟡 |
| `< 0.01` | Investigate — solver/picker mismatch or bug. 🔴 |

The same thresholds drive the dashboard's `chi_squared_drift` alert.

### 4.6 Files

| Path | Purpose |
|---|---|
| `apps/web/src/lib/fairness/commit.ts` | Server seed, hash, client-seed fallback. |
| `apps/web/src/lib/fairness/roll.ts` | Deterministic HMAC roll + pool mapping. |
| `apps/web/src/lib/chi-squared.ts` | Pure GOF + Wilson–Hilferty p-value. |
| `apps/web/src/app/api/fairness/[purchaseId]/route.ts` | Public commit/reveal record. |
| `apps/web/src/app/api/fairness/audit/route.ts` | Per-tier chi-squared audit. |
| `apps/web/src/app/api/cards/pool/route.ts` | Public pool snapshot (verifier input). |
| `apps/web/src/app/verify/pack/[id]/page.tsx` | Browser verifier (WebCrypto). |

---

## 5. Platform health dashboard

### 5.1 One page, five tabs

`/admin/economics` is the single admin entry point. Top-level tabs:

| Tab | Powers |
|---|---|
| **Revenue** | The original revenue snapshot (`computeEconomics`). |
| **Fraud** | Flagged-account count, top risk scores, account-link clusters with ≥ 3 users. |
| **Economic Health** | Per-tier realised vs target margin, active weight-version age, **Rebalance** + **Simulate** buttons hitting the solver endpoints. |
| **Fairness** | Per-tier `χ² / df / p` table with green/yellow/red badge. |
| **Users** | Cohort + engagement: total / active 24h / active 7d, drop engagement, auction participation, 7-day retention. |

Tab content fetches lazily — switching tabs is one API call to the
section route, not a giant payload up front.

### 5.2 Alerts, threshold-banded

`lib/alerts.ts` exposes three pure evaluators that return null /
yellow / red:

| Kind | Yellow | Red | Where it fires |
|---|---|---|---|
| `margin_drift` | drift > 3 pp from target | > 6 pp | `/api/admin/economics/health` writes when any tier has > 50 packs. |
| `chi_squared_drift` | p < 0.05 | p < 0.01 | (Plumbed; the audit endpoint exposes the value, dashboard renders the badge.) |
| `bot_flag_rate_spike` | > 1.5× 7d avg | > 2× 7d avg | (Module ready; firing point pluggable.) |

`persistAlert` deduplicates on unacknowledged `(kind, detail.tier)` —
re-evaluating on every dashboard hit doesn't spam. `POST
/api/admin/alerts/:id/ack` flips `acknowledged_at` + `acknowledged_by`.

### 5.3 Why polled, not WS

Phase 6/8/9/10/11 already broadcast WS events for the things that
actually change in real time (drop inventory, bids, reveals). The
dashboard is a polled view: an admin checking margins can wait the 5-
minute cache TTL or click Refresh. Adding a WS subscription per tab
buys nothing the admin cares about and heats up the DB.

### 5.4 Files

| Path | Purpose |
|---|---|
| `apps/web/src/lib/alerts.ts` | Threshold constants + evaluators + dedup insert. |
| `apps/web/src/lib/admin-guard.ts` | Shared admin auth gate for section routes. |
| `apps/web/src/components/economics-dashboard-tabs.tsx` | Tabbed shell + four new tab components. |
| `apps/web/src/app/api/admin/economics/fraud/route.ts` | Fraud tab payload. |
| `apps/web/src/app/api/admin/economics/health/route.ts` | Economic Health payload + side-effect alert insert. |
| `apps/web/src/app/api/admin/economics/users/route.ts` | Users tab payload. |
| `apps/web/src/app/api/admin/alerts/route.ts` | List alerts + thresholds. |
| `apps/web/src/app/api/admin/alerts/[id]/ack/route.ts` | Ack flow. |

---

## 6. Schema additions

Seven new tables. Full reference in [`DATABASE.md`](./DATABASE.md).

| Table | Purpose |
|---|---|
| `pack_weight_versions` | Per-tier rarity weights solved from current prices; `is_active` flips on rebalance. |
| `user_risk` | Per-user behavioural score + flag. |
| `account_links` | `(user_id, ip, ua_hash)` for multi-account heuristic. |
| `auction_flags` | Wash-trade review queue. |
| `pack_fairness` | Per-pack commit-reveal record. |
| `fairness_audit_log` | (Reserved) aggregated rarity counts per tier per window. |
| `admin_alerts` | Margin / fairness / bot-rate threshold breaches with ack flow. |

Plus one column: `user_packs.weight_version_id` (nullable FK) so
already-purchased packs can keep their pinned solver version.

---

## 7. Test surface

`pnpm test` runs 105 cases across 17 files. The Part B-specific
coverage:

| Module | Cases | What's verified |
|---|---|---|
| `economics/solver` | 6 | exact target EV per tier, win-floor clamping, SR-spike weight shift, infeasibility detection |
| `economics/simulate` | 4 | realised margin ±2 pp / 10k packs, win-rate floor reached, deterministic under seed |
| `auction-integrity` | 12 | overbid cap, sealed-window boundary, redaction behaviour |
| `fairness/roll` | 9 | determinism, sensitivity to nonce + client seed, uniforms in [0,1), pool mapping |
| `chi-squared` | 3 | uniform/skewed fixtures, known-fixture statistic |
| `alerts` | 9 | yellow/red threshold bands, zero-baseline guard |
| `ratelimit` | 6 | sliding-window-log semantics, 1 000-call burst admits exactly `max` |
| `behavioralSignals` | 3 | UA hash stability, threshold-requires-co-occurrence invariant |

---

## 8. Out of scope (explicit cuts)

- **CAPTCHA / proof-of-work.** Out of scope; would need a third-party.
- **On-chain commitments / signatures alongside the hash.** The hash
  chain is sufficient; on-chain adds operational cost without
  cryptographic gain at this scale.
- **Full Vickrey auctions.** Different product; sealed-bid final
  minute solves the actual problem (reactive sniping).
- **CSV export across all 5 dashboard sections.** The Revenue CSV is
  preserved; the heterogeneous shapes of the other tabs don't combine
  cleanly into one file. Each section endpoint returns plain JSON for
  copy/paste.
- **Multi-region Redis / DB failover.** A production hardening item;
  flagged in DB notes.
- **Background `fairness_audit_log` aggregator.** The audit endpoint
  computes chi-squared live from `pack_cards` + `cards`; the table is
  reserved for very-large windows.
- **WS push for admin metrics.** Polled with the 5-min cache + Refresh
  button is the right shape; a WS subscription per admin tab heats up
  the DB for no user-visible win.

---

## 9. How a reviewer can verify each claim quickly

1. **Solver correctness:** `pnpm --filter web test src/lib/economics`.
2. **Provably fair end-to-end:** buy a pack, hit `/api/fairness/<pack
   id>` (sees commit only), reveal, hit again (sees seed), open
   `/verify/pack/<pack id>` and click Run verification — must show two
   green ticks.
3. **Anti-bot rate limit:** `for i in {1..70}; do curl -s -o /dev/null
   -w "%{http_code}\n" -X POST http://localhost:3000/api/drops/<live-
   drop-id>/purchase; done` — the first 60 admit (or hit business
   errors), the rest 429.
4. **Sealed final minute:** create a 2-minute auction, place a bid in
   the last 60 s, observe `bid_placed` is *not* broadcast to the
   `auction:<id>` room while `sealed_phase_started` is.
5. **Wash-trade flag:** create 3 closed auctions between the same
   seller and winner pair within 7 d → 1 row appears in
   `auction_flags` with `reason='repeat_pair'`.
6. **Dashboard alerts:** insert a fixture that skews realised margin
   by 8 pp on a tier with > 50 packs → next call to
   `/api/admin/economics/health` writes a red `margin_drift` row in
   `admin_alerts`, visible at `GET /api/admin/alerts`.
