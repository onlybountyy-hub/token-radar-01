// Launch Radar — the value model, calibration, signals and farm-plan generator.
//
// One model prices every protocol on the board from the snapshot's own
// figures. No protocol name is ever looked up and no row is hand-placed:
// implied value = TVL x peer multiple x growth x maturity x reach, where the
// peer multiple is the median market-cap/TVL of the live-token protocols in
// the same category in this snapshot, shrunk toward the global median by
// peer count. The dashboard's app.js carries the same functions under the
// same names and recomputes every row in the page; both must agree exactly.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface CalibRow {
  category: string;
  peer_count: number;
  median_multiple: number | null;
  multiple: number;
  fallback: boolean;
}

export interface Calibration {
  global_median: number;
  live_token_count: number;
  priced_peer_count: number;
  by_category: CalibRow[];
}

export interface FarmInput {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  on_watchlist: boolean;
  age_days: number;
  implied_value_usd: number;
  launch_score: number;
  signals: string[];
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number;
    peer_count: number;
  };
  farm_steps: string[];
}

// ---------------------------------------------------------------- constants

/** Shrinkage strength: a category median counts for n/(n+SHRINK_K) of the
 *  multiple and the global median for the rest. k = 4 means a category needs
 *  four priced live peers before its own median outweighs the global one. */
export const SHRINK_K = 4;
export const MULTIPLE_MIN = 0.03;
export const MULTIPLE_MAX = 2.5;
/** The gate's ceiling for one row's implied value (RULES.txt). */
export const IMPLIED_CAP = 100_000_000_000_000;

const EXCLUDED_CATEGORIES = new Set([
  "Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking",
  "Restaked BTC", "CEX",
]);
const EXCHANGE_PREFIXES = [
  "Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex",
  "Gemini",
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// ------------------------------------------------------------- classification

export function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** The field guide's pre-token rule, applied with the snapshot's own fields:
 *  no token recorded, category not a wrapped/staked/bridged product class,
 *  no whole word wrapped/staked/staking in the name, no version-marker
 *  suffix, and the name does not begin with an exchange's name. (The guide's
 *  parent-protocol test uses a DefiLlama field the snapshot does not carry;
 *  the category/name tests above are its snapshot-visible approximation.) */
export function isPreToken(p: Protocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  for (const ex of EXCHANGE_PREFIXES) if (p.name.startsWith(ex)) return false;
  return true;
}

// ------------------------------------------------------------------- helpers

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z");
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function ageDaysOf(p: Protocol, asOf: string, medianAge: number): number {
  if (p.listed_at === null) return medianAge;
  return daysBetween(p.listed_at, asOf);
}

/** Board-median age over the protocols whose listing day is recorded; used
 *  for the ones DefiLlama gives no listing day for. */
export function medianRecordedAge(protocols: Protocol[], asOf: string): number {
  const ages: number[] = [];
  for (const p of protocols) {
    if (p.listed_at !== null) ages.push(daysBetween(p.listed_at, asOf));
  }
  return ages.length > 0 ? Math.round(median(ages)) : 0;
}

// --------------------------------------------------------------- calibration

/** Price evidence: live-token protocols whose market cap is recorded. Their
 *  market-cap/TVL ratios, per category and globally, are the only prices the
 *  model ever uses. Live tokens themselves are never ranked. */
export function calibrate(protocols: Protocol[]): Calibration {
  const live = protocols.filter(recordsToken);
  const priced = live.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const globalMedian = median(priced.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const ratios = new Map<string, number[]>();
  for (const p of priced) {
    const cat = p.category ?? "Uncategorised";
    const arr = ratios.get(cat) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    ratios.set(cat, arr);
  }
  const cats = new Set<string>();
  for (const p of protocols) cats.add(p.category ?? "Uncategorised");
  const byCategory: CalibRow[] = [];
  for (const cat of [...cats].sort()) {
    const arr = ratios.get(cat) ?? [];
    if (arr.length === 0) {
      byCategory.push({
        category: cat, peer_count: 0, median_multiple: null,
        multiple: clamp(globalMedian, MULTIPLE_MIN, MULTIPLE_MAX), fallback: true,
      });
    } else {
      const med = median(arr);
      const w = arr.length / (arr.length + SHRINK_K);
      const shrunk = w * med + (1 - w) * globalMedian;
      byCategory.push({
        category: cat, peer_count: arr.length, median_multiple: med,
        multiple: clamp(shrunk, MULTIPLE_MIN, MULTIPLE_MAX), fallback: false,
      });
    }
  }
  return {
    global_median: globalMedian,
    live_token_count: live.length,
    priced_peer_count: priced.length,
    by_category: byCategory,
  };
}

export function calibFor(cal: Calibration, category: string | null): CalibRow {
  const cat = category ?? "Uncategorised";
  for (const row of cal.by_category) if (row.category === cat) return row;
  return {
    category: cat, peer_count: 0, median_multiple: null,
    multiple: clamp(cal.global_median, MULTIPLE_MIN, MULTIPLE_MAX), fallback: true,
  };
}

/** The category's shrunk peer multiple, with the peer count behind it. */
export function peerMultipleOf(cal: Calibration, category: string | null): { multiple: number; peer_count: number; fallback: boolean } {
  const row = calibFor(cal, category);
  return { multiple: row.multiple, peer_count: row.peer_count, fallback: row.fallback };
}

// -------------------------------------------------------------- the multiples

/** 7-day TVL momentum: +100% doubles-counts at 1.6x, -50% floors at 0.7x.
 *  An unreported change counts as flat. */
export function growthMultiplierOf(change7d: number | null): number {
  const c = change7d === null ? 0 : clamp(change7d, -50, 100);
  return 1 + 0.6 * (c / 100);
}

/** Time tracked with no token, on a saturating curve in (0, 1]: a protocol
 *  listed today starts at 0.35 and approaches 1.0 with a ~2-year time
 *  constant, so age helps but never dominates TVL. */
export function maturityMultiplierOf(ageDays: number): number {
  return 0.35 + 0.65 * (1 - Math.exp(-Math.max(0, ageDays) / 720));
}

/** Multi-chain reach: +4% per chain past the first, capped at six extra. */
export function reachMultiplierOf(chainCount: number): number {
  return 1 + 0.04 * Math.min(Math.max(chainCount - 1, 0), 6);
}

export function impliedValueOf(
  tvlUsd: number, multiple: number, growthMult: number,
  maturityMult: number, reachMult: number,
): number {
  const raw = Math.round(tvlUsd * multiple * growthMult * maturityMult * reachMult);
  return clamp(raw, 1, IMPLIED_CAP);
}

/** Launch score 0-100: a fixed-scale blend of the same four inputs —
 *  40% log TVL size (scaled $5M..$5B), 25% maturity, 20% 7-day growth
 *  (scaled -50%..+100%), 15% reach (scaled 1..7 chains). */
export function launchScoreOf(
  tvlUsd: number, change7d: number | null, ageDays: number, chainCount: number,
): number {
  const size = clamp(
    (Math.log10(Math.max(tvlUsd, 1)) - Math.log10(5_000_000)) /
      (Math.log10(5_000_000_000) - Math.log10(5_000_000)),
    0, 1,
  );
  const growth = (clamp(change7d === null ? 0 : change7d, -50, 100) + 50) / 150;
  const maturity = maturityMultiplierOf(ageDays);
  const reach = clamp(chainCount, 1, 7) / 7;
  return Math.round(100 * (0.40 * size + 0.25 * maturity + 0.20 * growth + 0.15 * reach));
}

// ------------------------------------------------------------------- signals

export function signalsOf(row: {
  on_watchlist: boolean; tvl_usd: number; chains: string[];
  age_days: number; change_7d: number | null;
}): string[] {
  const out: string[] = [];
  if (row.on_watchlist) out.push("watchlist");
  if (row.tvl_usd >= 1_000_000_000) out.push("billion-tokenless");
  if (row.tvl_usd >= 50_000_000) out.push("above-floor");
  if (row.chains.length >= 5) out.push("wide-reach");
  if (row.age_days >= 1095) out.push("veteran");
  if (row.change_7d !== null && row.change_7d >= 5) out.push("surging");
  if (row.change_7d !== null && row.change_7d <= -5) out.push("cooling");
  if (row.age_days <= 180) out.push("fresh");
  return out;
}

export const SIGNAL_LABELS: Record<string, string> = {
  "watchlist": "On the house watchlist",
  "billion-tokenless": "Billion-dollar and tokenless",
  "above-floor": "At or above the $50M floor",
  "wide-reach": "On five or more chains",
  "veteran": "Three-plus years live, still no token",
  "surging": "TVL surging (+5% or more in 7d)",
  "cooling": "TVL cooling (-5% or more in 7d)",
  "fresh": "Tracked for 180 days or less",
};

// ------------------------------------------------------------- farm archetypes

/** The snapshot's categories mapped to the way a user actually farms them.
 *  Ten archetypes; each carries its own verbs, venues and exit, so plans
 *  differ in substance, not just in the protocol's name. */
export type ArchetypeId =
  | "vaults" | "yield" | "dex" | "lending" | "cdp"
  | "derivatives" | "rwa" | "bridgepay" | "chains" | "other";

const CATEGORY_ARCHETYPE: Record<string, ArchetypeId> = {
  "Risk Curators": "vaults",
  "Onchain Capital Allocator": "vaults",
  "Yield Aggregator": "vaults",
  "Liquidity Manager": "vaults",
  "Collateral Management": "vaults",
  "Indexes": "vaults",
  "Yield": "yield",
  "Farm": "yield",
  "Leveraged Farming": "yield",
  "Staking Pool": "yield",
  "Restaking": "yield",
  "Governance Incentives": "yield",
  "Dexs": "dex",
  "OTC Marketplace": "dex",
  "Lending": "lending",
  "Uncollateralized Lending": "lending",
  "Collateral Markets": "lending",
  "CDP": "cdp",
  "CDP Manager": "cdp",
  "Dual-Token Stablecoin": "cdp",
  "Stablecoin Issuer": "cdp",
  "Stablecoin Wrapper": "cdp",
  "Algo-Stables": "cdp",
  "Reserve Currency": "cdp",
  "Derivatives": "derivatives",
  "Basis Trading": "derivatives",
  "Options": "derivatives",
  "Options Vault": "derivatives",
  "Interest Rate Derivatives": "derivatives",
  "Synthetics": "derivatives",
  "Prediction Market": "derivatives",
  "RWA": "rwa",
  "Anchor BTC": "rwa",
  "Decentralized BTC": "rwa",
  "Bridge": "bridgepay",
  "Canonical Bridge": "bridgepay",
  "Cross Chain Bridge": "bridgepay",
  "Payments": "bridgepay",
  "Crypto Card Issuer": "bridgepay",
  "Chain": "chains",
};

export function archetypeOf(category: string | null): ArchetypeId {
  if (category === null) return "other";
  return CATEGORY_ARCHETYPE[category] ?? "other";
}

interface ArchVerbs {
  core: string;      // step 2: the archetype's main user action
  second: string;    // step 3: the second surface
  points: string;    // step 4: where points/rewards accrue
  watch: string;     // step 5: what to monitor
  exit: string;      // step 6: how the position unwinds
}

const ARCH: Record<ArchetypeId, ArchVerbs> = {
  vaults: {
    core: "deposit stablecoins into its flagship curated vault",
    second: "hold through at least two curator reallocations without withdrawing",
    points: "the vault's own points or rewards page, where deposit balance and hold time accrue",
    watch: "the curator's allocation shifts and the vault's APY against its TVL trend",
    exit: "withdraw from the vault in the same asset you deposited, keeping the points snapshot history intact",
  },
  yield: {
    core: "stake or deposit into its main yield position and leave the receipt token in your wallet",
    second: "compound the harvested yield back into the same position on a weekly rhythm",
    points: "the protocol's rewards dashboard, where staked balance over time is what accrues",
    watch: "the real yield rate versus emissions, and whether TVL growth is new money or mercenary rotation",
    exit: "unstake through the normal cooldown and sell nothing until any snapshot or claim window the protocol announces has passed",
  },
  dex: {
    core: "provide liquidity to its deepest stable or blue-chip pair and keep the LP position open",
    second: "route regular swaps through its own interface so your address builds genuine volume history",
    points: "the exchange's trading and liquidity rewards surface, where volume and LP time are the usual inputs",
    watch: "your share of the pool and fee APR against the pair's volume trend",
    exit: "withdraw liquidity gradually rather than in one block, so the exit does not read as a one-day farm-and-dump",
  },
  lending: {
    core: "supply a blue-chip collateral asset to its main market and leave it supplied",
    second: "take one modest borrow against the supply and repay it in full, so the address shows both sides of the market",
    points: "the market's supply and borrow rewards view, where supplied balance and duration accrue",
    watch: "utilisation and your health factor, keeping a wide buffer above liquidation at all times",
    exit: "repay any open borrow first, then withdraw supply in tranches across several days",
  },
  cdp: {
    core: "open a collateral position and mint a conservative amount of its stablecoin against it",
    second: "hold or deploy the minted stablecoin inside the protocol's own ecosystem rather than selling it at once",
    points: "the mint and stability rewards surface, where minted balance held over time is what counts",
    watch: "your collateral ratio against the liquidation line, topping up whenever markets move against you",
    exit: "repay the minted debt, close the position and withdraw collateral only after any announced snapshot window",
  },
  derivatives: {
    core: "trade its main perpetual or basis market with small, regular size rather than one large bet",
    second: "build volume across several weeks and more than one market, the pattern genuine traders leave",
    points: "the venue's volume and open-interest rewards programme, where traded volume over time accrues",
    watch: "funding rates and your margin ratio, never letting a position sit near liquidation for points",
    exit: "flatten positions pair by pair and withdraw margin once the rewards epoch you traded in has closed",
  },
  rwa: {
    core: "mint or buy its tokenised real-world asset position with the minimum the product allows, then hold it",
    second: "complete its onboarding or allowlist steps properly, since gated products reward verified holders",
    points: "the product's holder rewards or yield distribution record, where holding duration is the input",
    watch: "redemption windows and the underlying asset reports the protocol publishes",
    exit: "redeem through the product's own redemption window instead of selling into thin secondary liquidity",
  },
  bridgepay: {
    core: "route real transfers through it between the chains it serves, in both directions",
    second: "use its payment or card surface for ordinary spending or transfers, not only bridge hops",
    points: "the service's transaction rewards or cashback record, where genuine routed volume accrues",
    watch: "per-route fees and settlement times, dropping any route whose cost drifts above alternatives",
    exit: "let routed balances settle fully on the destination chain before consolidating them back",
  },
  chains: {
    core: "be an ordinary active user of the chain: hold its gas asset and transact on its native apps weekly",
    second: "bridge a working balance in through the chain's canonical route and keep it deployed on-chain",
    points: "the chain's ecosystem quests or points surface, where on-chain activity history is the input",
    watch: "the chain's own announcements for testnet, points or snapshot language, and its TVL trend",
    exit: "keep the core balance on-chain until any launch the chain announces has fully settled",
  },
  other: {
    core: "use its main product the way a real user would, with a balance sized to matter",
    second: "repeat the core action on a weekly rhythm so the address shows a history, not a single visit",
    points: "the protocol's own rewards or points surface, wherever the app itself links to it",
    watch: "the protocol's announcements and its TVL trend for signs the programme is changing",
    exit: "wind the position down through the product's normal exit path once a launch or claim is announced",
  },
};

// ------------------------------------------------------------ farm plan pieces

const GAS_ASSET: Record<string, string> = {
  "Ethereum": "ETH", "Base": "ETH", "Arbitrum": "ETH", "Optimism": "ETH",
  "Linea": "ETH", "Scroll": "ETH", "zkSync Era": "ETH", "Mantle": "MNT",
  "Blast": "ETH", "Mode": "ETH", "Ink": "ETH", "Sonic": "S",
  "Solana": "SOL", "Binance": "BNB", "BSC": "BNB", "opBNB": "BNB",
  "Hyperliquid L1": "HYPE", "Polygon": "POL", "Avalanche": "AVAX",
  "Tron": "TRX", "Sui": "SUI", "Aptos": "APT", "Near": "NEAR",
  "Cosmos": "ATOM", "Stellar": "XLM", "Flare": "FLR", "Bittensor": "TAO",
  "Robinhood Chain": "ETH",
};

export function gasAssetOf(chain: string): string {
  return GAS_ASSET[chain] ?? "the chain's gas token";
}

/** Capital tier scaled to the protocol's TVL: bigger protocols need a
 *  balance that registers; small ones reward consistency over size. */
export function capitalTierOf(tvlUsd: number): string {
  if (tvlUsd >= 1_000_000_000) return "$25,000-$50,000";
  if (tvlUsd >= 250_000_000) return "$10,000-$25,000";
  if (tvlUsd >= 50_000_000) return "$2,500-$10,000";
  if (tvlUsd >= 10_000_000) return "$500-$2,500";
  return "$100-$500";
}

export function holdPeriodOf(ageDays: number): string {
  if (ageDays >= 1095) return "12 months or more";
  if (ageDays >= 365) return "6-12 months";
  if (ageDays >= 90) return "3-6 months";
  return "6-12 weeks";
}

export function fmtUsd(n: number): string {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

export function fmtPct(x: number | null): string {
  if (x === null) return "unreported";
  return (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(slug: string, salt: string, options: readonly T[]): T {
  return options[hashOf(slug + ":" + salt) % options.length];
}

type Trend = "surging" | "cooling" | "flat";
function trendOf(change7d: number | null): Trend {
  if (change7d !== null && change7d >= 5) return "surging";
  if (change7d !== null && change7d <= -5) return "cooling";
  return "flat";
}

/** Six concrete steps for one protocol, generated from its archetype and
 *  personalised with its own name, chains, TVL tier, age and 7-day trend.
 *  Every step ends with its cost and its time. The dashboard's app.js holds
 *  the same generator and must produce the same strings. */
export function farmPlanFor(p: FarmInput): string[] {
  const arch = ARCH[archetypeOf(p.category)];
  const name = p.name;
  const chain1 = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains[1] ?? null;
  const gas = gasAssetOf(chain1);
  const tier = capitalTierOf(p.tvl_usd);
  const hold = holdPeriodOf(p.age_days);
  const trend = trendOf(p.change_7d);
  const trendTxt = fmtPct(p.change_7d);
  const tvlTxt = fmtUsd(p.tvl_usd);
  const steps: string[] = [];

  // Step 1 — funding, worded by the primary chain's gas asset family.
  const fundOpen = pick(p.slug, "fund", [
    `Fund one wallet for ${name} on ${chain1}: move ${tier} of stablecoins there and keep a small ${gas} reserve for gas`,
    `Set up a dedicated wallet for ${name}: bridge ${tier} of working capital to ${chain1} and hold spare ${gas} for fees`,
    `Prepare capital for ${name} on ${chain1}: bring ${tier} across and leave enough ${gas} untouched to cover a month of transactions`,
  ]);
  steps.push(
    `${fundOpen}; use the bridge or exchange withdrawal route ${name} itself links to, and verify the address on a $10 test transfer first. Cost: ${tier} of capital plus about $5-$25 of bridge and gas fees. Time: 30-60 minutes.`,
  );

  // Step 2 — the archetype's core action.
  steps.push(
    `On ${chain1}, ${arch.core} at ${name} with the core of your ${tier} tier; ${name} tracks ${tvlTxt} of TVL, so size like a real user of a protocol that size, not a dust account. Cost: the deployed share of ${tier}, plus $2-$15 of gas in ${gas}. Time: 20-40 minutes to set up.`,
  );

  // Step 3 — the second surface, on a second chain where the protocol has one.
  const where = chain2 !== null
    ? `Repeat on ${chain2}, ${name}'s second chain, with a smaller slice`
    : `Stay on ${chain1} and use a second product surface of ${name} with a smaller slice`;
  steps.push(
    `${where}: ${arch.second}. A ${hold} hold is the horizon this position is building toward. Cost: 25-40% of the ${tier} tier, plus $2-$12 of gas. Time: 15-30 minutes, then weekly check-ins of 5 minutes.`,
  );

  // Step 4 — the points / rewards surface, in the archetype's own terms.
  steps.push(
    `Register your activity where it counts at ${name}: ${arch.points}. Screenshot your position weekly, and trust only links ${name} itself publishes in its app - never a points checker or claim page from social media. Cost: $0 beyond the capital already deployed. Time: 10 minutes a week for ${hold}.`,
  );

  // Step 5 — trend-aware sizing and monitoring; the case that fired is named.
  const trendStep: Record<Trend, string> = {
    surging: `Trend case: surging. ${name}'s TVL is ${trendTxt} over 7 days, so enter in three tranches a week apart instead of all at once, and ${arch.watch}`,
    cooling: `Trend case: cooling. ${name}'s TVL is ${trendTxt} over 7 days, so stagger entries over a month and size at the low end of the ${tier} tier while you ${arch.watch}`,
    flat: `Trend case: flat. ${name}'s 7-day TVL change is ${trendTxt}, so use standard sizing across the ${tier} tier and ${arch.watch}`,
  };
  steps.push(
    `${trendStep[trend]}. Set a calendar review every two weeks against the ${trendTxt} trend you entered on. Cost: $0; the cost of skipping this is farming a shrinking protocol at full size. Time: 15 minutes every two weeks.`,
  );

  // Step 6 — the exit, keyed to the protocol's own trend sign.
  const exitLead = p.change_7d !== null && p.change_7d < 0
    ? `Because ${name}'s latest 7-day trend is negative (${trendTxt}), pre-commit your exit now`
    : `With ${name}'s latest 7-day trend at ${trendTxt}, plan the exit before any launch announcement forces it`;
  steps.push(
    `${exitLead}: when a token, claim or snapshot is announced, ${arch.exit}. Keep records of every transaction hash from steps 1-5 as your proof of genuine use. Cost: $2-$20 of gas in ${gas} to unwind. Time: 1-2 hours spread over the exit week.`,
  );

  return steps;
}

// ------------------------------------------------------------------ the board

export function buildBoard(snap: Snapshot): {
  rows: BoardRow[];
  calibration: Calibration;
  liveTokens: Protocol[];
} {
  const cal = calibrate(snap.protocols);
  const medianAge = medianRecordedAge(snap.protocols, snap.as_of);
  const watch = new Set(snap.watchlist);
  const candidates = snap.protocols.filter(isPreToken);
  const rows: BoardRow[] = candidates.map((p) => {
    const age = ageDaysOf(p, snap.as_of, medianAge);
    const pm = peerMultipleOf(cal, p.category);
    const gm = growthMultiplierOf(p.change_7d);
    const mm = maturityMultiplierOf(age);
    const rm = reachMultiplierOf(p.chains.length);
    const implied = impliedValueOf(p.tvl_usd, pm.multiple, gm, mm, rm);
    const base = {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
      listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
      token_status: "pre-token",
      on_watchlist: watch.has(p.slug),
      age_days: age,
    };
    return {
      rank: 0,
      ...base,
      implied_value_usd: implied,
      launch_score: launchScoreOf(p.tvl_usd, p.change_7d, age, p.chains.length),
      signals: signalsOf({
        on_watchlist: base.on_watchlist, tvl_usd: p.tvl_usd,
        chains: p.chains, age_days: age, change_7d: p.change_7d,
      }),
      model: {
        peer_multiple: pm.multiple,
        growth_pct: p.change_7d === null ? 0 : p.change_7d,
        growth_multiplier: gm,
        maturity_multiplier: mm,
        reach_multiplier: rm,
        age_days: age,
        peer_count: pm.peer_count,
      },
      farm_steps: farmPlanFor({
        slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: age,
      }),
    };
  });
  rows.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd ||
    b.tvl_usd - a.tvl_usd ||
    (a.slug < b.slug ? -1 : 1),
  );
  rows.forEach((r, i) => { r.rank = i + 1; });
  // The watchlist is the floor: every one of its slugs must be on the board.
  const covered = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !covered.has(s));
  if (missing.length > 0) {
    throw new Error(
      `watchlist coverage failed: ${missing.length} missing (${missing.slice(0, 5).join(", ")})`,
    );
  }
  return { rows, calibration: cal, liveTokens: snap.protocols.filter(recordsToken) };
}
