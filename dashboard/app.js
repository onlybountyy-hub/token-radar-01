"use strict";
/*
 * LAUNCH RADAR — the model, in words.
 *
 * The board ranks protocols that record no token by an IMPLIED VALUE derived
 * only from the snapshot's own figures:
 *
 *   implied value = TVL x peer multiple x growth x maturity x reach
 *
 * Peer multiple: for the protocol's category, the median market-cap/TVL of
 * the live-token protocols in that category in this snapshot, shrunk toward
 * the global median by peer count (weight n/(n+4), so a category needs four
 * priced peers before its own median outweighs the global one), clamped to
 * [0.03x, 2.5x]. A category with no priced live peer falls back to the
 * global median, and the fallback is stated wherever the number is shown.
 * Growth: 1 + 0.6 x clamp(7-day TVL change, -50, +100)/100; unreported
 * counts as flat. Maturity: 0.35 + 0.65 x (1 - exp(-age in days / 720)), a
 * saturating curve in (0, 1] for time tracked with no token; an unrecorded
 * listing day is scored at the board's median age. Reach: 1 + 4% per chain
 * past the first, capped at six extra chains. Launch score 0-100 blends the
 * same inputs on fixed scales: 40% log TVL ($5M..$5B), 25% maturity,
 * 20% growth (-50%..+100%), 15% reach (1..7 chains).
 *
 * This file recomputes every row from the row's own inputs with the same
 * functions the program used (peerMultipleOf, impliedValueOf, farmPlanFor),
 * so what the page shows is what board.json holds. Live-token protocols are
 * never ranked: they are the price evidence, set aside in their own view.
 * Farm plans are generated per archetype (the way a user actually farms
 * that kind of protocol) and personalised with the protocol's name, chains,
 * TVL-scaled capital tier, age-scaled hold period and 7-day trend.
 */
var DATA = (typeof window !== "undefined" && window.LAUNCH_RADAR) || null;

// ------------------------------------------------------------ model (shared)

var SHRINK_K = 4, MULTIPLE_MIN = 0.03, MULTIPLE_MAX = 2.5, IMPLIED_CAP = 1e14;

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function calibRowOf(category) {
  var cat = category === null || category === undefined ? "Uncategorised" : category;
  for (var i = 0; i < DATA.calibration.length; i++)
    if (DATA.calibration[i].category === cat) return DATA.calibration[i];
  return { category: cat, peer_count: 0, median_multiple: null, multiple: clamp(DATA.global_median_multiple, MULTIPLE_MIN, MULTIPLE_MAX), fallback: true };
}

/* The category's shrunk peer multiple, with the peer count behind it. */
function peerMultipleOf(category) {
  var row = calibRowOf(category);
  if (row.fallback || row.median_multiple === null)
    return { multiple: clamp(DATA.global_median_multiple, MULTIPLE_MIN, MULTIPLE_MAX), peer_count: 0, fallback: true };
  var w = row.peer_count / (row.peer_count + SHRINK_K);
  var shrunk = w * row.median_multiple + (1 - w) * DATA.global_median_multiple;
  return { multiple: clamp(shrunk, MULTIPLE_MIN, MULTIPLE_MAX), peer_count: row.peer_count, fallback: false };
}

function growthMultiplierOf(change7d) {
  var c = change7d === null || change7d === undefined ? 0 : clamp(change7d, -50, 100);
  return 1 + 0.6 * (c / 100);
}
function maturityMultiplierOf(ageDays) {
  return 0.35 + 0.65 * (1 - Math.exp(-Math.max(0, ageDays) / 720));
}
function reachMultiplierOf(chainCount) {
  return 1 + 0.04 * Math.min(Math.max(chainCount - 1, 0), 6);
}
function impliedValueOf(tvlUsd, multiple, growthMult, maturityMult, reachMult) {
  return clamp(Math.round(tvlUsd * multiple * growthMult * maturityMult * reachMult), 1, IMPLIED_CAP);
}
function launchScoreOf(tvlUsd, change7d, ageDays, chainCount) {
  var size = clamp((Math.log10(Math.max(tvlUsd, 1)) - Math.log10(5000000)) / (Math.log10(5000000000) - Math.log10(5000000)), 0, 1);
  var growth = (clamp(change7d === null || change7d === undefined ? 0 : change7d, -50, 100) + 50) / 150;
  var reach = clamp(chainCount, 1, 7) / 7;
  return Math.round(100 * (0.40 * size + 0.25 * maturityMultiplierOf(ageDays) + 0.20 * growth + 0.15 * reach));
}
/* Recompute one board row end to end, exactly as the program did. */
function recomputeRow(row) {
  var pm = peerMultipleOf(row.category);
  var gm = growthMultiplierOf(row.change_7d), mm = maturityMultiplierOf(row.age_days);
  var rm = reachMultiplierOf(row.chains.length);
  return {
    peer_multiple: pm.multiple, peer_count: pm.peer_count, fallback: pm.fallback,
    growth_multiplier: gm, maturity_multiplier: mm, reach_multiplier: rm,
    implied_value_usd: impliedValueOf(row.tvl_usd, pm.multiple, gm, mm, rm),
    launch_score: launchScoreOf(row.tvl_usd, row.change_7d, row.age_days, row.chains.length)
  };
}
function calibrationTable() { return DATA.calibration; }

// ------------------------------------------------------- farm plans (shared)

var CATEGORY_ARCHETYPE = {
  "Risk Curators": "vaults", "Onchain Capital Allocator": "vaults", "Yield Aggregator": "vaults",
  "Liquidity Manager": "vaults", "Collateral Management": "vaults", "Indexes": "vaults",
  "Yield": "yield", "Farm": "yield", "Leveraged Farming": "yield", "Staking Pool": "yield",
  "Restaking": "yield", "Governance Incentives": "yield",
  "Dexs": "dex", "OTC Marketplace": "dex",
  "Lending": "lending", "Uncollateralized Lending": "lending", "Collateral Markets": "lending",
  "CDP": "cdp", "CDP Manager": "cdp", "Dual-Token Stablecoin": "cdp", "Stablecoin Issuer": "cdp",
  "Stablecoin Wrapper": "cdp", "Algo-Stables": "cdp", "Reserve Currency": "cdp",
  "Derivatives": "derivatives", "Basis Trading": "derivatives", "Options": "derivatives",
  "Options Vault": "derivatives", "Interest Rate Derivatives": "derivatives",
  "Synthetics": "derivatives", "Prediction Market": "derivatives",
  "RWA": "rwa", "Anchor BTC": "rwa", "Decentralized BTC": "rwa",
  "Bridge": "bridgepay", "Canonical Bridge": "bridgepay", "Cross Chain Bridge": "bridgepay",
  "Payments": "bridgepay", "Crypto Card Issuer": "bridgepay",
  "Chain": "chains"
};
function archetypeOf(category) {
  if (category === null || category === undefined) return "other";
  return CATEGORY_ARCHETYPE[category] || "other";
}
var ARCH = {
  vaults: { core: "deposit stablecoins into its flagship curated vault", second: "hold through at least two curator reallocations without withdrawing", points: "the vault's own points or rewards page, where deposit balance and hold time accrue", watch: "the curator's allocation shifts and the vault's APY against its TVL trend", exit: "withdraw from the vault in the same asset you deposited, keeping the points snapshot history intact" },
  yield: { core: "stake or deposit into its main yield position and leave the receipt token in your wallet", second: "compound the harvested yield back into the same position on a weekly rhythm", points: "the protocol's rewards dashboard, where staked balance over time is what accrues", watch: "the real yield rate versus emissions, and whether TVL growth is new money or mercenary rotation", exit: "unstake through the normal cooldown and sell nothing until any snapshot or claim window the protocol announces has passed" },
  dex: { core: "provide liquidity to its deepest stable or blue-chip pair and keep the LP position open", second: "route regular swaps through its own interface so your address builds genuine volume history", points: "the exchange's trading and liquidity rewards surface, where volume and LP time are the usual inputs", watch: "your share of the pool and fee APR against the pair's volume trend", exit: "withdraw liquidity gradually rather than in one block, so the exit does not read as a one-day farm-and-dump" },
  lending: { core: "supply a blue-chip collateral asset to its main market and leave it supplied", second: "take one modest borrow against the supply and repay it in full, so the address shows both sides of the market", points: "the market's supply and borrow rewards view, where supplied balance and duration accrue", watch: "utilisation and your health factor, keeping a wide buffer above liquidation at all times", exit: "repay any open borrow first, then withdraw supply in tranches across several days" },
  cdp: { core: "open a collateral position and mint a conservative amount of its stablecoin against it", second: "hold or deploy the minted stablecoin inside the protocol's own ecosystem rather than selling it at once", points: "the mint and stability rewards surface, where minted balance held over time is what counts", watch: "your collateral ratio against the liquidation line, topping up whenever markets move against you", exit: "repay the minted debt, close the position and withdraw collateral only after any announced snapshot window" },
  derivatives: { core: "trade its main perpetual or basis market with small, regular size rather than one large bet", second: "build volume across several weeks and more than one market, the pattern genuine traders leave", points: "the venue's volume and open-interest rewards programme, where traded volume over time accrues", watch: "funding rates and your margin ratio, never letting a position sit near liquidation for points", exit: "flatten positions pair by pair and withdraw margin once the rewards epoch you traded in has closed" },
  rwa: { core: "mint or buy its tokenised real-world asset position with the minimum the product allows, then hold it", second: "complete its onboarding or allowlist steps properly, since gated products reward verified holders", points: "the product's holder rewards or yield distribution record, where holding duration is the input", watch: "redemption windows and the underlying asset reports the protocol publishes", exit: "redeem through the product's own redemption window instead of selling into thin secondary liquidity" },
  bridgepay: { core: "route real transfers through it between the chains it serves, in both directions", second: "use its payment or card surface for ordinary spending or transfers, not only bridge hops", points: "the service's transaction rewards or cashback record, where genuine routed volume accrues", watch: "per-route fees and settlement times, dropping any route whose cost drifts above alternatives", exit: "let routed balances settle fully on the destination chain before consolidating them back" },
  chains: { core: "be an ordinary active user of the chain: hold its gas asset and transact on its native apps weekly", second: "bridge a working balance in through the chain's canonical route and keep it deployed on-chain", points: "the chain's ecosystem quests or points surface, where on-chain activity history is the input", watch: "the chain's own announcements for testnet, points or snapshot language, and its TVL trend", exit: "keep the core balance on-chain until any launch the chain announces has fully settled" },
  other: { core: "use its main product the way a real user would, with a balance sized to matter", second: "repeat the core action on a weekly rhythm so the address shows a history, not a single visit", points: "the protocol's own rewards or points surface, wherever the app itself links to it", watch: "the protocol's announcements and its TVL trend for signs the programme is changing", exit: "wind the position down through the product's normal exit path once a launch or claim is announced" }
};
var GAS_ASSET = {
  "Ethereum": "ETH", "Base": "ETH", "Arbitrum": "ETH", "Optimism": "ETH", "Linea": "ETH",
  "Scroll": "ETH", "zkSync Era": "ETH", "Mantle": "MNT", "Blast": "ETH", "Mode": "ETH",
  "Ink": "ETH", "Sonic": "S", "Solana": "SOL", "Binance": "BNB", "BSC": "BNB", "opBNB": "BNB",
  "Hyperliquid L1": "HYPE", "Polygon": "POL", "Avalanche": "AVAX", "Tron": "TRX", "Sui": "SUI",
  "Aptos": "APT", "Near": "NEAR", "Cosmos": "ATOM", "Stellar": "XLM", "Flare": "FLR",
  "Bittensor": "TAO", "Robinhood Chain": "ETH"
};
function gasAssetOf(chain) { return GAS_ASSET[chain] || "the chain's gas token"; }
function capitalTierOf(tvlUsd) {
  if (tvlUsd >= 1e9) return "$25,000-$50,000";
  if (tvlUsd >= 250000000) return "$10,000-$25,000";
  if (tvlUsd >= 50000000) return "$2,500-$10,000";
  if (tvlUsd >= 10000000) return "$500-$2,500";
  return "$100-$500";
}
function holdPeriodOf(ageDays) {
  if (ageDays >= 1095) return "12 months or more";
  if (ageDays >= 365) return "6-12 months";
  if (ageDays >= 90) return "3-6 months";
  return "6-12 weeks";
}
function fmtUsd(n) {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
function fmtPct(x) {
  if (x === null || x === undefined) return "unreported";
  return (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
}
function hashOf(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pick(slug, salt, options) { return options[hashOf(slug + ":" + salt) % options.length]; }
function trendOf(change7d) {
  if (change7d !== null && change7d !== undefined && change7d >= 5) return "surging";
  if (change7d !== null && change7d !== undefined && change7d <= -5) return "cooling";
  return "flat";
}
/* The same six-step generator the program runs: archetype actions,
 * personalised with the protocol's own facts, cost and time on every step. */
function farmPlanFor(p) {
  var arch = ARCH[archetypeOf(p.category)];
  var name = p.name;
  var chain1 = p.chains[0] || "Ethereum";
  var chain2 = p.chains.length > 1 ? p.chains[1] : null;
  var gas = gasAssetOf(chain1);
  var tier = capitalTierOf(p.tvl_usd);
  var hold = holdPeriodOf(p.age_days);
  var trend = trendOf(p.change_7d);
  var trendTxt = fmtPct(p.change_7d);
  var tvlTxt = fmtUsd(p.tvl_usd);
  var steps = [];
  var fundOpen = pick(p.slug, "fund", [
    "Fund one wallet for " + name + " on " + chain1 + ": move " + tier + " of stablecoins there and keep a small " + gas + " reserve for gas",
    "Set up a dedicated wallet for " + name + ": bridge " + tier + " of working capital to " + chain1 + " and hold spare " + gas + " for fees",
    "Prepare capital for " + name + " on " + chain1 + ": bring " + tier + " across and leave enough " + gas + " untouched to cover a month of transactions"
  ]);
  steps.push(fundOpen + "; use the bridge or exchange withdrawal route " + name + " itself links to, and verify the address on a $10 test transfer first. Cost: " + tier + " of capital plus about $5-$25 of bridge and gas fees. Time: 30-60 minutes.");
  steps.push("On " + chain1 + ", " + arch.core + " at " + name + " with the core of your " + tier + " tier; " + name + " tracks " + tvlTxt + " of TVL, so size like a real user of a protocol that size, not a dust account. Cost: the deployed share of " + tier + ", plus $2-$15 of gas in " + gas + ". Time: 20-40 minutes to set up.");
  var where = chain2 !== null
    ? "Repeat on " + chain2 + ", " + name + "'s second chain, with a smaller slice"
    : "Stay on " + chain1 + " and use a second product surface of " + name + " with a smaller slice";
  steps.push(where + ": " + arch.second + ". A " + hold + " hold is the horizon this position is building toward. Cost: 25-40% of the " + tier + " tier, plus $2-$12 of gas. Time: 15-30 minutes, then weekly check-ins of 5 minutes.");
  steps.push("Register your activity where it counts at " + name + ": " + arch.points + ". Screenshot your position weekly, and trust only links " + name + " itself publishes in its app - never a points checker or claim page from social media. Cost: $0 beyond the capital already deployed. Time: 10 minutes a week for " + hold + ".");
  var trendStep = {
    surging: "Trend case: surging. " + name + "'s TVL is " + trendTxt + " over 7 days, so enter in three tranches a week apart instead of all at once, and " + arch.watch,
    cooling: "Trend case: cooling. " + name + "'s TVL is " + trendTxt + " over 7 days, so stagger entries over a month and size at the low end of the " + tier + " tier while you " + arch.watch,
    flat: "Trend case: flat. " + name + "'s 7-day TVL change is " + trendTxt + ", so use standard sizing across the " + tier + " tier and " + arch.watch
  };
  steps.push(trendStep[trend] + ". Set a calendar review every two weeks against the " + trendTxt + " trend you entered on. Cost: $0; the cost of skipping this is farming a shrinking protocol at full size. Time: 15 minutes every two weeks.");
  var exitLead = (p.change_7d !== null && p.change_7d !== undefined && p.change_7d < 0)
    ? "Because " + name + "'s latest 7-day trend is negative (" + trendTxt + "), pre-commit your exit now"
    : "With " + name + "'s latest 7-day trend at " + trendTxt + ", plan the exit before any launch announcement forces it";
  steps.push(exitLead + ": when a token, claim or snapshot is announced, " + arch.exit + ". Keep records of every transaction hash from steps 1-5 as your proof of genuine use. Cost: $2-$20 of gas in " + gas + " to unwind. Time: 1-2 hours spread over the exit week.");
  return steps;
}
/* One farm step, split for display: body text, then its cost/time tail. */
function stepText(step) {
  var i = step.lastIndexOf(" Cost:");
  if (i < 0) return { body: step, cost: "" };
  return { body: step.slice(0, i + 1), cost: step.slice(i + 1) };
}

/* A generated sentence explaining a row's rank from its own figures. */
function whyThisRank(row) {
  var rec = recomputeRow(row);
  var byTvl = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  var tvlRank = byTvl.findIndex(function (r) { return r.slug === row.slug; }) + 1;
  var multTxt = rec.fallback
    ? "the global median multiple of " + DATA.global_median_multiple.toFixed(3) + "x (its category has no priced live peer, so the model falls back to the global median)"
    : "a peer multiple of " + rec.peer_multiple.toFixed(3) + "x (median of " + rec.peer_count + " priced live peer" + (rec.peer_count === 1 ? "" : "s") + " in " + (row.category || "its category") + ", shrunk toward the global median " + DATA.global_median_multiple.toFixed(3) + "x with weight " + rec.peer_count + "/" + (rec.peer_count + SHRINK_K) + ")";
  var flags = row.signals.length ? " Flags: " + row.signals.map(function (s) { return SIGNAL_DEFS[s] ? SIGNAL_DEFS[s].label : s; }).join("; ") + "." : "";
  return row.name + " ranks #" + row.rank + " of " + DATA.rows.length + " by implied value and #" + tvlRank +
    " by TVL (" + fmtUsd(row.tvl_usd) + "). It " + (row.on_watchlist ? "is on the house watchlist" : "sits below or outside the house watchlist — the radar's early catch") +
    " and records no token. Its value claim rests on " + multTxt + ", a growth multiplier of " + rec.growth_multiplier.toFixed(3) +
    "x from its 7-day TVL change of " + fmtPct(row.change_7d) + ", a maturity multiplier of " + rec.maturity_multiplier.toFixed(3) +
    "x from " + row.age_days + " days tracked tokenless, and a reach multiplier of " + rec.reach_multiplier.toFixed(2) +
    "x across " + row.chains.length + " chain" + (row.chains.length === 1 ? "" : "s") + "." + flags;
}

var SIGNAL_DEFS = {
  "watchlist": { label: "Watchlist", def: "Named on the snapshot's house watchlist: TVL at or above the $50M floor, records no token, and not a wrapped, staked or bridged product of a protocol whose token trades." },
  "billion-tokenless": { label: "Billion-dollar & tokenless", def: "At least $1B of TVL and still no token recorded — the largest unlaunched footprints on the board." },
  "above-floor": { label: "Above the $50M floor", def: "TVL at or above the watchlist's $50M floor, whether or not the watchlist's other tests kept it." },
  "wide-reach": { label: "Wide reach (5+ chains)", def: "TVL spread across five or more chains; the reach multiplier rewards this, capped at six extra chains." },
  "veteran": { label: "Veteran (3+ years tokenless)", def: "Tracked for three or more years with no token recorded; the maturity curve is near its ceiling here." },
  "surging": { label: "TVL surging", def: "TVL up 5% or more over the last 7 days. Farm plans answer this case by entering in tranches." },
  "cooling": { label: "TVL cooling", def: "TVL down 5% or more over the last 7 days. Farm plans answer this case by staggering and sizing low." },
  "fresh": { label: "Fresh (≤180 days)", def: "Tracked for 180 days or less: young, lightly seasoned, and priced with a low maturity multiplier." }
};

/* The ten farm archetypes, in words. Categories are mapped to the way a
 * user actually farms that kind of protocol (archetypeOf above); each
 * archetype carries its own core action, second surface, points surface,
 * monitoring habit and exit (the ARCH table), so two protocols in different
 * archetypes never share a plan skeleton, and two in the same archetype
 * still differ by chain, tier, hold period and trend case. */
var ARCHETYPE_GUIDE = [
  ["vaults", "Vaults & curators", "Risk Curators, Onchain Capital Allocator, Yield Aggregator, Liquidity Manager, Collateral Management, Indexes. The user action is a deposit into a curated vault and the discipline of holding through the curator's reallocations; rewards accrue to balance held over time, and the exit is a same-asset withdrawal that keeps the snapshot history intact."],
  ["yield", "Yield & staking", "Yield, Farm, Leveraged Farming, Staking Pool, Restaking, Governance Incentives. Stake or deposit, take the receipt token, compound on a weekly rhythm. What matters is real yield versus emissions, and the exit respects the unstaking cooldown and any announced claim window."],
  ["dex", "Decentralised exchanges", "Dexs, OTC Marketplace. Provide liquidity to the deepest pair and route genuine swap volume through the protocol's own interface; volume and LP time are the usual rewards inputs, and liquidity is withdrawn gradually so the exit does not read as farm-and-dump."],
  ["lending", "Lending markets", "Lending, Uncollateralized Lending, Collateral Markets. Supply a blue-chip collateral asset, then show the other side of the market once with a modest borrow repaid in full. Utilisation and the health factor are watched throughout, with a wide liquidation buffer."],
  ["cdp", "CDP & stablecoin issuance", "CDP, CDP Manager, Dual-Token Stablecoin, Stablecoin Issuer, Stablecoin Wrapper, Algo-Stables, Reserve Currency. Open a collateral position, mint conservatively, and keep the minted asset working inside the issuer's own ecosystem; the collateral ratio is the number that keeps the position alive."],
  ["derivatives", "Derivatives & basis", "Derivatives, Basis Trading, Options, Options Vault, Interest Rate Derivatives, Synthetics, Prediction Market. Small, regular trades across several weeks and more than one market — the pattern genuine traders leave — while funding rates and margin ratio are watched so no position farms points from the edge of liquidation."],
  ["rwa", "RWA & bitcoin products", "RWA, Anchor BTC, Decentralized BTC. Mint or buy the tokenised position at the product's minimum, complete onboarding properly where the product is gated, and exit through the product's own redemption window rather than thin secondary liquidity."],
  ["bridgepay", "Bridges, payments & cards", "Bridge, Canonical Bridge, Cross Chain Bridge, Payments, Crypto Card Issuer. Route real transfers in both directions and use the payment surface for ordinary spending; per-route fees and settlement times decide which routes stay in the plan."],
  ["chains", "Chains themselves", "Chain. A chain's launch is farmed by being an ordinary active user: hold the gas asset, bridge in through the canonical route, transact on native apps weekly, and keep the core balance on-chain until any announced launch settles."],
  ["other", "Everything else", "Categories with no closer archetype — AI agents, insurance, launchpads, privacy and the uncategorised. Use the main product the way a real user would, repeat the core action weekly so the address shows a history, and wind down through the product's normal exit path."]
];

/* How this board was built, step by step — the same pipeline main.ts runs.
 * 1. Classify: a protocol records a token when gecko_id or symbol is set;
 *    those 416 are set aside as the calibration set and never ranked.
 * 2. Exclude: from the rest, drop wrapped/staked/bridged product classes
 *    (category, name-word, version-suffix and exchange-prefix tests — the
 *    field guide's rule, applied with the snapshot's own fields).
 * 3. Calibrate: price the live set's market-cap/TVL ratios per category.
 * 4. Price: implied value for every remaining protocol from the one formula.
 * 5. Rank: descending implied value, ties by TVL then slug; ranks 1..N.
 * 6. Assert: every one of the 40 watchlist slugs is on the board, or the
 *    program fails loudly and writes nothing. */

/* Glossary — the board's terms, defined the way the model uses them. */
var GLOSSARY = [
  ["Implied value", "What a token would be worth if this protocol's record stayed exactly as the snapshot shows it and the market priced it like its live peers. A model's claim, never a price."],
  ["Peer multiple", "Market cap divided by TVL for a live-token protocol. The board borrows the category median of these as the price of one TVL dollar."],
  ["Shrinkage", "Blending a category's own median with the global median, weighted by peer count. One peer moves the multiple only a fifth of the way from the global figure; twenty peers move it five-sixths."],
  ["Maturity", "Time tracked with no token, on a saturating curve: the second year adds far less than the first, and no age, however long, pushes the multiplier past 1."],
  ["Reach", "How many chains the TVL is spread over. Each extra chain is worth 4%, capped at six, because multi-chain protocols launch to a wider first market."],
  ["Launch score", "A 0-100 blend for scanning, on fixed scales so scores are comparable across rows: 40% size, 25% maturity, 20% growth, 15% reach. It orders nothing — rank is implied value's job."],
  ["Watchlist", "The house's floor: TVL at or above $50M, records no token, and not a wrapped, staked or bridged product of a traded token. The board covers all 40 and ranks 158 more below or outside it."],
  ["Early radar", "Board rows the watchlist does not name — smaller, younger, or kept off the list by one of its tests. This is the set the radar exists to surface."],
  ["Records no token", "The snapshot's gecko_id and symbol are both null. DefiLlama's record is not proof: a protocol may have a token its record does not carry."],
  ["Capital tier", "The working balance a farm plan assumes, scaled to the protocol's TVL: dust registers nowhere, and oversizing a small protocol buys risk, not allocation."]
];

/* A generated risk note for the detail view, from the row's own flags. */
function riskNoteFor(row) {
  var notes = [];
  if (row.signals.indexOf("cooling") >= 0)
    notes.push("its TVL is cooling (" + fmtPct(row.change_7d) + " in 7 days), so the plan staggers entries and sizes at the low end of its tier");
  if (row.signals.indexOf("surging") >= 0)
    notes.push("its TVL is surging (" + fmtPct(row.change_7d) + " in 7 days), so the plan enters in tranches rather than chasing size in one block");
  if (row.signals.indexOf("fresh") >= 0)
    notes.push("it has been tracked for only " + row.age_days + " days, so its maturity multiplier is low and its record is short — position size should stay honest about that");
  if (row.signals.indexOf("veteran") >= 0)
    notes.push("it has run " + row.age_days + " days with no token, which cuts both ways: a long record supports the value claim, and a long wait can also mean no launch is planned at all");
  var rec = recomputeRow(row);
  if (rec.fallback)
    notes.push("its category has no priced live peer, so its multiple is the global median — the least specific price on the board, and the widest error bars");
  else if (rec.peer_count <= 2)
    notes.push("its peer multiple rests on only " + rec.peer_count + " priced live peer" + (rec.peer_count === 1 ? "" : "s") + ", shrunk hard toward the global median for exactly that reason");
  if (notes.length === 0)
    notes.push("no single flag dominates this row; its rank is the plain product of its TVL, its category's peer pricing and its momentum");
  return "Read on this row: " + notes.join("; ") + ".";
}

// ------------------------------------------------------------------ the page

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtX(x) { return x.toFixed(3) + "x"; }
function fmtInt(n) { return n.toLocaleString("en-US"); }

var state = { q: "", category: "", chain: "", signal: "", set: "all", sort: "rank", dir: 1 };

function parseRoute() {
  var h = location.hash.replace(/^#\/?/, "");
  var parts = h.split("?");
  var path = parts[0] || "board";
  var params = {};
  if (parts[1]) parts[1].split("&").forEach(function (kv) {
    var p = kv.split("="); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
  });
  return { path: path, params: params };
}

function chipsFor(row) {
  var out = "";
  if (row.on_watchlist) out += '<span class="chip wl">★ watchlist</span>';
  var shown = 0;
  row.signals.forEach(function (s) {
    if (s === "watchlist" || shown >= 2) return;
    out += '<span class="chip sig">' + esc(SIGNAL_DEFS[s] ? SIGNAL_DEFS[s].label : s) + "</span>";
    shown++;
  });
  if (row.signals.length - 1 > shown) out += '<span class="chip more">+' + (row.signals.length - 1 - shown) + "</span>";
  return out;
}

function boardView(params) {
  if (params.signal !== undefined) state.signal = params.signal;
  if (params.set !== undefined) state.set = params.set;
  var s = DATA.stats;
  var cats = [], chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  var sigOpts = Object.keys(SIGNAL_DEFS).map(function (k) {
    return '<option value="' + k + '"' + (state.signal === k ? " selected" : "") + ">" + esc(SIGNAL_DEFS[k].label) + "</option>";
  }).join("");
  var html = '<section class="stats">' +
    '<div class="stat"><b>' + s.watchlist_covered + " / " + s.watchlist_total + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + s.board_rows + '</b><span>pre-token rows ranked</span></div>' +
    '<div class="stat"><b>' + esc(s.pre_token_tvl_text) + '</b><span>tokenless TVL tracked</span></div>' +
    '<div class="stat"><b>' + s.live_token_count + '</b><span>live tokens set aside</span></div></section>' +
    '<div class="formula">implied = TVL × <b>peer multiple</b> × growth × maturity × reach &nbsp;·&nbsp; this run: global median multiple <b>' +
    DATA.global_median_multiple.toFixed(3) + 'x</b> · <b>' + s.categories_calibrated + "</b> of " + s.categories_total +
    ' categories calibrated from <b>' + s.priced_peer_count + '</b> priced live peers · snapshot as of ' + esc(DATA.as_of) + "</div>" +
    '<div class="controls">' +
    '<input type="search" id="f-q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
    '<label>Category <select id="f-cat"><option value="">All</option>' + cats.map(function (c) { return '<option' + (state.category === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
    '<label>Chain <select id="f-chain"><option value="">All</option>' + chains.map(function (c) { return '<option' + (state.chain === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
    '<label>Signal <select id="f-sig"><option value="">Any</option>' + sigOpts + "</select></label>" +
    '<label>Set <select id="f-set">' +
    '<option value="all"' + (state.set === "all" ? " selected" : "") + ">All rows</option>" +
    '<option value="watchlist"' + (state.set === "watchlist" ? " selected" : "") + ">Watchlist</option>" +
    '<option value="early"' + (state.set === "early" ? " selected" : "") + ">Early radar</option></select></label>" +
    '<span class="count" id="row-count"></span></div>' +
    '<table><thead><tr>' +
    th("rank", "#", "num") + th("name", "Protocol") + th("tvl_usd", "TVL", "num") +
    th("change_7d", "7d", "num") + th("age_days", "Age", "num") + th("launch_score", "Score", "num") +
    th("implied_value_usd", "Implied value", "num") + "<th>Flags</th>" +
    '</tr></thead><tbody id="rows"></tbody></table>' +
    '<p class="note" style="margin-top:10px">Reading the board: <b>rank</b> is the model\'s claim, ordered by implied value alone. <b>TVL</b> is the snapshot\'s locked value; <b>7d</b> its last week of momentum; <b>age</b> the days DefiLlama has tracked it with no token recorded; <b>score</b> the 0-100 launch blend (size, maturity, growth, reach) for scanning; <b>implied value</b> the dollar claim the formula at the top produces. The ★ chip marks the 40 house-watchlist protocols — all covered, none privileged: a watchlist row ranks exactly where its figures put it, and the 158 early-radar rows below the $50M floor or outside the list\'s tests compete on the same terms. Click any row for its factor-by-factor recomputation and its six-step farm plan. Live-token protocols never appear here; they are the calibration set, one tab over.</p>';
  document.getElementById("app").innerHTML = html;
  ["f-q", "f-cat", "f-chain", "f-sig", "f-set"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function (e) {
      if (id === "f-q") state.q = e.target.value;
      if (id === "f-cat") state.category = e.target.value;
      if (id === "f-chain") state.chain = e.target.value;
      if (id === "f-sig") state.signal = e.target.value;
      if (id === "f-set") state.set = e.target.value;
      renderRows();
    });
  });
  document.querySelectorAll("th[data-sort]").forEach(function (el) {
    el.addEventListener("click", function () {
      var k = el.getAttribute("data-sort");
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      renderRows();
    });
  });
  renderRows();
}
function th(key, label, cls) {
  var dir = state.sort === key ? ' <span class="dir">' + (state.dir === 1 ? "▲" : "▼") + "</span>" : "";
  return '<th class="' + (cls || "") + '" data-sort="' + key + '">' + label + dir + "</th>";
}
function filteredRows() {
  var q = state.q.trim().toLowerCase();
  var out = DATA.rows.filter(function (r) {
    if (state.set === "watchlist" && !r.on_watchlist) return false;
    if (state.set === "early" && r.on_watchlist) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (state.signal && r.signals.indexOf(state.signal) < 0) return false;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    return true;
  });
  var k = state.sort, d = state.dir;
  out.sort(function (a, b) {
    var x = a[k], y = b[k];
    if (k === "name") return d * String(x).localeCompare(String(y));
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return d * (x - y);
  });
  return out;
}
function renderRows() {
  var rows = filteredRows();
  document.getElementById("row-count").innerHTML =
    "<b>" + rows.length + "</b> of " + DATA.rows.length + " rows shown";
  document.getElementById("rows").innerHTML = rows.map(function (r) {
    var chg = r.change_7d === null ? '<span class="neg" style="color:var(--faint)">—</span>'
      : '<span class="' + (r.change_7d >= 0 ? "pos" : "neg") + '">' + fmtPct(r.change_7d) + "</span>";
    return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + "</td>" +
      '<td><span class="pname">' + esc(r.name) + '</span><br><span class="pcat">' + esc(r.category || "Uncategorised") + " · " + r.chains.length + " chain" + (r.chains.length === 1 ? "" : "s") + "</span></td>" +
      '<td class="num">' + fmtUsd(r.tvl_usd) + "</td><td class=\"num\">" + chg + "</td>" +
      '<td class="num">' + fmtInt(r.age_days) + "d</td>" +
      '<td class="num"><span class="score">' + r.launch_score + "</span></td>" +
      '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + "</b></td>" +
      "<td>" + chipsFor(r) + "</td></tr>";
  }).join("");
  document.querySelectorAll("#rows tr").forEach(function (tr) {
    tr.addEventListener("click", function () {
      location.hash = "#/protocol/" + tr.getAttribute("data-slug");
    });
  });
}

function detailView(slug) {
  var row = null;
  DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
  if (!row) { document.getElementById("app").innerHTML = '<p class="loading">No board row for ' + esc(slug) + '.</p>'; return; }
  var rec = recomputeRow(row);
  var plan = farmPlanFor(row);
  var calib = calibRowOf(row.category);
  var calibLine = rec.fallback
    ? "Calibration: <b>" + esc(row.category || "Uncategorised") + "</b> has no priced live peer in this snapshot — the model falls back to the global median <b>" + DATA.global_median_multiple.toFixed(3) + "x</b>."
    : "Calibration: <b>" + esc(row.category || "Uncategorised") + "</b> — " + rec.peer_count + " priced live peer" + (rec.peer_count === 1 ? "" : "s") +
      ", category median " + calib.median_multiple.toFixed(3) + "x, shrunk " + rec.peer_count + "/" + (rec.peer_count + SHRINK_K) +
      " toward the global median " + DATA.global_median_multiple.toFixed(3) + "x → <b>" + rec.peer_multiple.toFixed(3) + "x</b>.";
  var tiles = [
    ["TVL", fmtUsd(row.tvl_usd), ""], ["Peer multiple", fmtX(rec.peer_multiple), ""],
    ["Growth × (7d " + fmtPct(row.change_7d) + ")", rec.growth_multiplier.toFixed(3) + "x", ""],
    ["Maturity × (" + fmtInt(row.age_days) + "d)", rec.maturity_multiplier.toFixed(3) + "x", ""],
    ["Reach × (" + row.chains.length + " chains)", rec.reach_multiplier.toFixed(2) + "x", ""],
    ["Implied value", fmtUsd(rec.implied_value_usd), "hero"]
  ];
  document.getElementById("app").innerHTML =
    '<p class="crumb"><a href="#/board">← Board</a> · rank #' + row.rank + " of " + DATA.rows.length + " · recomputed in this page from the row's inputs, matching board.json</p>" +
    '<div class="dhead"><h2>' + esc(row.name) + '</h2><span class="bigscore">launch score ' + rec.launch_score + "</span>" +
    '<span class="meta">' + esc(row.category || "Uncategorised") + " · " + row.chains.map(esc).join(", ") + ' · <b style="color:var(--mint)">records no token</b>' +
    (row.on_watchlist ? ' · <span class="chip wl">★ on the house watchlist</span>' : " · below/outside the watchlist — early radar") + "</span></div>" +
    '<div class="why">' + esc(whyThisRank(row)) + "</div>" +
    '<div class="tiles">' + tiles.map(function (t) {
      return '<div class="tile ' + t[2] + '"><span>' + esc(t[0]) + "</span><b>" + esc(t[1]) + "</b></div>";
    }).join("") + "</div>" +
    '<p class="calib-line">' + calibLine + "</p>" +
    '<p class="calib-line" style="font-family:var(--sans)">' + esc(riskNoteFor(row)) + "</p>" +
    '<h3 class="sect">Farm plan — six steps, generated for ' + esc(row.name) + "'s archetype (" + esc(archetypeOf(row.category)) + ')</h3>' +
    '<div class="steps">' + plan.map(function (s, i) {
      var parts = stepText(s);
      return '<div class="step"><span class="n">' + (i + 1) + "</span>" + esc(parts.body) +
        ' <span class="ct">' + esc(parts.cost) + "</span></div>";
    }).join("") + "</div>";
  window.scrollTo(0, 0);
}

function signalsView() {
  var cards = Object.keys(SIGNAL_DEFS).map(function (k) {
    var n = DATA.rows.filter(function (r) { return r.signals.indexOf(k) >= 0; }).length;
    return '<div class="sig-card" data-signal="' + k + '"><b>' + esc(SIGNAL_DEFS[k].label) + '</b><span class="n">' + n + " rows</span><p>" + esc(SIGNAL_DEFS[k].def) + "</p></div>";
  }).join("");
  document.getElementById("app").innerHTML =
    '<p class="note">Signals are flags the model derives from each row\'s own figures — nothing here is in the snapshot. Click a signal to see the board filtered by it.</p><div class="sig-grid">' + cards + "</div>";
  document.querySelectorAll(".sig-card").forEach(function (el) {
    el.addEventListener("click", function () {
      location.hash = "#/board?signal=" + el.getAttribute("data-signal");
    });
  });
}

function liveView() {
  var big = DATA.live_tokens.filter(function (t) { return t.tvl_usd >= DATA.floor_usd; })
    .sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  document.getElementById("app").innerHTML =
    '<p class="note"><b>' + DATA.stats.live_token_count + ' protocols record a token that already trades.</b> They are never ranked — they are the price evidence: their market-cap/TVL ratios calibrate every peer multiple on the board (' +
    DATA.stats.priced_peer_count + ' of them carry a recorded market cap). The sizable ones (TVL ≥ ' + fmtUsd(DATA.floor_usd) + ') are listed here, ' + big.length + ' in all.</p>' +
    '<table><thead><tr><th>Protocol</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
    big.map(function (t) {
      return "<tr><td><span class=\"pname\">" + esc(t.name) + '</span></td><td>' + esc(t.symbol || "—") + "</td><td>" +
        esc(t.category || "Uncategorised") + '</td><td class="num">' + fmtUsd(t.tvl_usd) + '</td><td class="num">' +
        (t.mcap_usd === null ? "—" : fmtUsd(t.mcap_usd)) + '</td><td class="num">' +
        (t.multiple === null ? "—" : t.multiple.toFixed(3) + "x") + "</td></tr>";
    }).join("") + "</tbody></table>";
}

function modelView() {
  var top = DATA.rows[0];
  var rec = recomputeRow(top);
  var calib = calibRowOf(top.category);
  var table = calibrationTable().map(function (c) {
    var pm = peerMultipleOf(c.category);
    return "<tr><td>" + esc(c.category) + '</td><td class="num">' + c.peer_count + '</td><td class="num">' +
      (c.median_multiple === null ? "—" : c.median_multiple.toFixed(3) + "x") + '</td><td class="num">' +
      (c.fallback ? '<span style="color:var(--amber)">global fallback</span>' : pm.multiple.toFixed(3) + "x") + "</td></tr>";
  }).join("");
  document.getElementById("app").innerHTML =
    '<div class="model-grid"><div>' +
    '<div class="card"><h3>The formula</h3><div class="big-formula">implied value = TVL × peer multiple × growth × maturity × reach</div>' +
    "<p><b>Peer multiple</b> — median market-cap/TVL of the category's live-token protocols in this snapshot, shrunk toward the global median by peer count (weight n/(n+" + SHRINK_K + ")), clamped to [0.03x, 2.5x]; no priced peer → the global median, stated as a fallback. <b>Growth</b> — 1 + 0.6 × clamp(7d change, −50, +100)/100. <b>Maturity</b> — 0.35 + 0.65 × (1 − exp(−age/720)). <b>Reach</b> — 1 + 4% per extra chain, capped at six. No name is looked up; one function prices every row.</p></div>" +
    '<div class="card"><h3>Worked example — board #1, recomputed here</h3><p class="worked">' +
    esc(top.name) + ": TVL <b>" + fmtUsd(top.tvl_usd) + "</b> × peer <b>" + rec.peer_multiple.toFixed(3) + "x</b> (" +
    (rec.fallback ? "global fallback" : calib.peer_count + " peers, median " + calib.median_multiple.toFixed(3) + "x, shrunk") +
    ") × growth <b>" + rec.growth_multiplier.toFixed(3) + "x</b> (" + fmtPct(top.change_7d) + ") × maturity <b>" +
    rec.maturity_multiplier.toFixed(3) + "x</b> (" + fmtInt(top.age_days) + "d) × reach <b>" + rec.reach_multiplier.toFixed(2) +
    "x</b> (" + top.chains.length + " chains) = <b>" + fmtUsd(rec.implied_value_usd) + "</b> — the same dollar board.json holds. Launch score <b>" + rec.launch_score + "</b> (40% size, 25% maturity, 20% growth, 15% reach).</p></div>" +
    '<div class="card"><h3>Honesty notes</h3><ul>' +
    "<li>“Records no token” is DefiLlama's record, not proof a protocol has none.</li>" +
    "<li>Implied value is this model's claim from one frozen snapshot (" + esc(DATA.as_of) + ") — not a price, not a launch prediction.</li>" +
    "<li>Live tokens are set aside as calibration evidence and never ranked.</li>" +
    "<li>Peer counts travel with every multiple: a multiple from one peer is mostly the global median, and the shrinkage weight says so.</li></ul></div>" +
    '<div class="card"><h3>Why shrinkage, why these weights</h3><p>A category median from one or two peers is mostly luck: one mispriced token would set the price of every protocol in its category. Shrinking toward the global median with weight n/(n+4) makes the evidence earn its influence — a category speaks for itself only when it has the peers to back it. The launch score\'s weights put size first because TVL is the hardest figure to fake, maturity second because time tokenless is this board\'s whole thesis, and growth last among the majors because seven days is a mood, not a record. Every constant on this page is stated in the source; nothing is tuned per protocol.</p></div>' +
    '<div class="card"><h3>Glossary</h3><ul>' +
    GLOSSARY.map(function (g) { return "<li><b>" + esc(g[0]) + "</b> — " + esc(g[1]) + "</li>"; }).join("") +
    "</ul></div>" +
    "</div><div>" +
    '<div class="card"><h3>Calibration — every category</h3><p>Global median multiple: <b style="color:var(--mint)">' +
    DATA.global_median_multiple.toFixed(3) + "x</b> from " + DATA.stats.priced_peer_count + " priced live peers.</p>" +
    '<table class="cal"><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Median</th><th class="num">Used</th></tr></thead><tbody>' +
    table + "</tbody></table></div>" +
    '<div class="card"><h3>Farm plans — ten archetypes</h3><p>Every plan is generated, not written: the protocol\'s category picks an archetype, and the archetype\'s real user actions are personalised with the protocol\'s primary and second chain and its gas asset, a capital tier scaled to its TVL, a hold period scaled to its age, and a trend case (surging, cooling or flat) read from its 7-day TVL change. Each of the six steps ends with what it costs and how long it takes.</p><ul>' +
    ARCHETYPE_GUIDE.map(function (g) { return "<li><b>" + esc(g[1]) + "</b> — " + esc(g[2]) + "</li>"; }).join("") +
    "</ul></div></div></div>";
}

function render() {
  if (!DATA) { document.getElementById("app").innerHTML = '<p class="loading">No data file loaded.</p>'; return; }
  var route = parseRoute();
  var view = "board";
  document.querySelectorAll(".views a").forEach(function (a) { a.classList.remove("on"); });
  if (route.path.indexOf("protocol/") === 0) {
    detailView(route.path.slice("protocol/".length));
    view = "board";
  } else if (route.path === "signals") { signalsView(); view = "signals"; }
  else if (route.path === "live") { liveView(); view = "live"; }
  else if (route.path === "model") { modelView(); view = "model"; }
  else boardView(route.params);
  var active = document.querySelector('.views a[data-view="' + view + '"]');
  if (active) active.classList.add("on");
}

if (typeof document !== "undefined") {
  window.addEventListener("hashchange", render);
  render();
}
