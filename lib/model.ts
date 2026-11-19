// Launch Radar model: one sealed DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// The board ranks protocols that record no token of their own yet. Its implied value is built only
// from the snapshot's own figures, in four factors a reader can check on the row:
//
//   multiple   what the market already pays for a dollar of TVL in this protocol's category: the
//              median market-cap/TVL ratio of the category's live-token protocols in this same
//              snapshot, shrunk toward the global median so a thin category cannot shout, and
//              clamped to a sane band. No category is priced from a list of names.
//   growth     the protocol's seven-day TVL change, clamped, at a stated weight.
//   maturity   how long the protocol has run with no token, on a square-root curve: the second
//              year counts for less than the first.
//   reach      how many chains the protocol's TVL sits on, a small factor with a hard cap.
//
//   implied = max(1, round(tvl_usd x multiple x growthMult x maturityMult x reachMult))
//
// A launch score (0-100) blends the same four inputs on fixed scales so a reader can sort by it;
// the board's rank always follows implied value. No protocol name is special-cased anywhere: one
// function scores every row, and the dashboard carries the same function and checks the board
// against it in the detail view.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can recompute any row. */
export interface ModelConstants {
  shrink_k: number;
  multiple_min: number;
  multiple_max: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  reach_per_chain: number;
  reach_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  multiple_min: 0.03,
  multiple_max: 2.5,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.6,
  maturity_base: 0.75,
  maturity_range: 0.45,
  maturity_days: 1825,
  reach_per_chain: 0.04,
  reach_max_extra: 6,
};

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'peer-1';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 32;

/** Categories whose products are another asset in a wrapper: not a first launch of their own. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** One row of board.json: the ranked board's row. */
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  launch_score: number;
  signals: string[];
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  launch_score: number;
  signals: string[];
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
}

/** A live-token protocol: it already trades, so the page shows the market's own figures. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_to_tvl: number | null;
}

/** One category's calibration: how many live peers priced it, and the multiple the model uses. */
export interface CategoryCalibration {
  category: string;
  peers: number;
  median_ratio: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  unknown_age_days: number;
  global_multiple: number;
  calibration: CategoryCalibration[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a launch candidate of its own: pre-token, not a wrapper or staking product
 * of a token that trades, not an exchange's own product and not a versioned pool of another.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The calibration the snapshot itself implies: a peer multiple per category, and the global one. */
export interface Calibration {
  global_multiple: number;
  by_category: Map<string, CategoryCalibration>;
  unknown_age_days: number;
}

/**
 * Price every category from its live-token peers in this snapshot: the median market-cap/TVL of the
 * category's trading protocols, shrunk toward the global median by the peer count so a category
 * with two peers cannot outshout one with forty, then clamped. Also settles the age an unlisted
 * protocol is scored at: the median age of the protocols whose listing day the snapshot records.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const global_multiple = round4(clamp(globalMedian, model.multiple_min, model.multiple_max));
  const by_category = new Map<string, CategoryCalibration>();
  for (const [category, list] of perCategory) {
    const med = median(list);
    const shrunk = (list.length * med + model.shrink_k * globalMedian) / (list.length + model.shrink_k);
    by_category.set(category, {
      category,
      peers: list.length,
      median_ratio: round4(med),
      multiple: round4(clamp(shrunk, model.multiple_min, model.multiple_max)),
    });
  }
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  const unknown_age_days = ages.length > 0 ? Math.round(median(ages)) : 365;
  return { global_multiple, by_category, unknown_age_days };
}

/** The peer multiple one protocol is priced at: its category's, or the global one. */
export function peerMultiple(p: SnapshotProtocol, calibration: Calibration): number {
  if (p.category !== null) {
    const entry = calibration.by_category.get(p.category);
    if (entry !== undefined) return entry.multiple;
  }
  return calibration.global_multiple;
}

/** The factors one protocol gets: every multiplier, the implied value and the launch score. */
export interface Scored {
  implied: number;
  score: number;
  multiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  reachMult: number;
  age: number | null;
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, calibration: Calibration, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? calibration.unknown_age_days;
  const multiple = peerMultiple(p, calibration);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = model.maturity_base + model.maturity_range * Math.sqrt(clamp(ageForModel, 0, model.maturity_days) / model.maturity_days);
  const reachMult = 1 + model.reach_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.reach_max_extra);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  const sizeScore = p.tvl_usd > 1_000_000 ? clamp(Math.log10(p.tvl_usd / 1_000_000) / 3.5, 0, 1) : 0;
  const growthScore = (growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor);
  const maturityScore = clamp(ageForModel, 0, model.maturity_days) / model.maturity_days;
  const reachScore = Math.min(Math.max(p.chains.length - 1, 0), model.reach_max_extra) / model.reach_max_extra;
  const score = Math.round(100 * (0.45 * sizeScore + 0.25 * growthScore + 0.2 * maturityScore + 0.1 * reachScore));
  return { implied, score, multiple, growthPct, growthMult, maturityMult, reachMult, age };
}

/** The signal flags one row carries: plain statements about its own figures, nothing predicted. */
export function signalsOf(p: SnapshotProtocol, age: number | null): string[] {
  const signals: string[] = [];
  if (p.tvl_usd >= 1_000_000_000) signals.push('whale');
  if (p.change_7d !== null && p.change_7d >= 20) signals.push('surge');
  if (age !== null && age >= 1095 && p.tvl_usd >= 100_000_000) signals.push('overdue');
  if (age !== null && age <= 180 && p.tvl_usd >= 250_000_000) signals.push('fresh');
  if (p.chains.length >= 5) signals.push('everywhere');
  if (p.change_7d !== null && p.change_7d <= -20) signals.push('cooling');
  return signals;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page weekly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain a protocol names, for plans that move funds, or its first again. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 365) return 60;
  if (age < 1095) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chain = chainOf(p);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC as collateral in ${name} on ${chain}, take one small borrow against it, and repay the borrow a week later so the wallet shows on both sides of the market`;
  }
  if (c.includes('dex')) {
    return `Swap $${capital} of USDC for the chain's gas token in ${name} on ${chain}, then add the same value as liquidity to its busiest stable pool`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Allocate $${capital} of USDC through a ${name} vault on ${chain} and keep the position through one full reallocation cycle`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC from ${chain} to ${secondChainOf(p)} through ${name}, then make one small transaction with the bridged funds on the far side`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin in ${name} on ${chain} and open one small position you can explain, then close it flat instead of letting it ride`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Fund $${capital} in ${name} and make two ordinary payments with it, the way a regular user of the product would`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it past one distribution date`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for the shortest term it sells, and keep the policy to expiry`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of the ${name} index on ${chain} and hold it rather than trading in and out`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${chain} and make one transaction a week inside ${name}'s own apps`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity')) {
    return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and leave the shares untouched`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set up one fresh wallet for this farm and fund it only with what the plan uses; keep the seed phrase on paper, never in a screenshot or a cloud note`,
      cost: 'about $1 to $3 of gas to fund the wallet and make its first transaction',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital),
      cost: `$${capital} of capital and about $${capital >= 120 ? 6 : 3} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Repeat one small qualifying action every week - a deposit, a swap, a vote or a claim check - so the wallet reads as a user, not a one-day visitor`,
      cost: 'about $1 to $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days; points seasons and snapshots reward wallets that stay, and a fast in-and-out is the pattern filters remove`,
      cost: `the $${capital} stays deployed, so size it as money you can afford to leave`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own site and its verified social account for a points or rewards page; claim only from a link the protocol itself publishes, and never pay a fee to unlock an airdrop`,
      cost: 'free to check, and any claim fee is a scam signal',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log - wallet, dates, amounts and transaction hashes - and review the position monthly; withdraw if the protocol's TVL falls for three straight weeks`,
      cost: 'nothing but the log itself',
      time: '5 minutes, then 5 minutes a month',
    },
  ];
}

/** The protocols the board ranks: every watchlist slug first, then every other launch candidate. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (watch.has(p.slug)) chosen.set(p.slug, p);
  for (const p of snapshot.protocols) if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, calibration, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_score: s.score,
    signals: signalsOf(p, s.age),
    model: {
      peer_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      reach_multiplier: round4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_to_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js; the farm plan is regenerated in the page by the same rules. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    launch_score: row.launch_score,
    signals: row.signals,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    unknown_age_days: calibration.unknown_age_days,
    global_multiple: calibration.global_multiple,
    calibration: [...calibration.by_category.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside the gate's 100 to 4,000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
