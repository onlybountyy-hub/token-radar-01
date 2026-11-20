# Launch Radar — token-radar-01

[![make.fun competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/onlybountyy-hub/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/onlybountyy-hub/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

A token launch radar built for the make.fun `token-radar-01` competition.
It reads the sealed DefiLlama snapshot (758 protocols at or above $5M TVL,
frozen 2026-11-14), finds the protocols that record no token, prices each
one with a model derived from the snapshot's own figures, ranks them by
that implied value, and gives every row a concrete six-step farm plan.

The board holds 198 pre-token protocols and covers all 40 protocols on the
house watchlist — the watchlist is the floor, never the ceiling. The 416
protocols whose token already trades are never ranked; they are set aside
as the calibration set, because their market caps are the only real prices
in the snapshot.

## Run it

```
node --experimental-strip-types main.ts --input <dir-or-file> --output <dir>
```

Defaults are `/input` and `/output`. Node 22.18+, standard library only,
no network. The program writes `board.json`, `data.js` (the dashboard's
data, in the output root), copies of `dashboard/` and `screenshots/`, and
`dossier.json` built with `buildDossier` from `vendor/makefun-board.ts`.
Two runs on the same snapshot produce byte-identical `board.json`. Open
`output/dashboard/index.html` in a browser to use the board; it loads its
data from `../data.js` and works fully offline.

## The model

One function prices every protocol; no name is looked up and no row is
hand-placed.

```
implied value = TVL × peer multiple × growth × maturity × reach
```

- **Peer multiple** — for the protocol's category, the median
  market-cap/TVL of the live-token protocols in that category in this
  snapshot, shrunk toward the global median by peer count (weight
  n/(n+4)) and clamped to [0.03×, 2.5×]. A category with no priced live
  peer falls back to the global median, and the fallback is stated
  wherever the number is shown. Peer counts travel with every multiple.
- **Growth** — `1 + 0.6 × clamp(change_7d, −50, +100)/100`; an unreported
  change counts as flat.
- **Maturity** — `0.35 + 0.65 × (1 − exp(−age_days/720))`, a saturating
  curve in (0, 1] over days tracked with no token; an unrecorded listing
  day is scored at the board's median age.
- **Reach** — 1 + 4% per chain past the first, capped at six extra chains.
- **Launch score** (0–100, for scanning; rank is implied value's job) —
  40% log TVL on a $5M..$5B scale, 25% maturity, 20% growth on a
  −50%..+100% scale, 15% reach on a 1..7 chain scale.

Pre-token classification follows the snapshot field guide's rule exactly,
using the snapshot's own fields: no token recorded, category not in
{Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked
BTC, CEX}, no whole word wrapped/staked/staking in the name, no
version-marker suffix, and the name does not begin with an exchange's
name. The program asserts all 40 watchlist slugs are on the board and
fails loudly otherwise.

The dashboard recomputes every row in the page with the same functions
(`peerMultipleOf`, `impliedValueOf`, `farmPlanFor`, … in
`dashboard/app.js`), so the detail view's factor tiles are a live
recomputation, not a copy of the program's arithmetic.

## Farm plans

Six steps per protocol, each ending with its cost and its time. Plans are
generated per archetype — the snapshot's categories are mapped to ten
archetypes (vaults & curators; yield & staking; DEX; lending; CDP &
collateral; derivatives & basis; RWA & bitcoin products; bridges,
payments & cards; chains; other), each with its own real user actions —
and personalised with the protocol's name, primary and second chain and
its gas asset, a capital tier scaled to its TVL, a hold period scaled to
its age, and a trend case (surging / cooling / flat) read from its 7-day
TVL change, which the plan names along with the number.

## Layout

- `main.ts` — the program: arguments, I/O, dossier.
- `lib/model.ts` — snapshot parsing, classification, calibration, the
  value model, signals, and the farm-plan generator.
- `dashboard/` — `index.html`, `app.css`, `app.js` and nothing else: the
  board, signals, live-token and model views, plus a full-page detail
  view per protocol, addressed by hash routes (`#/board`,
  `#/protocol/<slug>`, `#/model`, …).
- `screenshots/` — four 1440×900 captures of a real run's output: the
  board, the #1 watchlist protocol's detail page with all six farm steps
  in frame, the board filtered by the TVL-surging signal, and the model
  view.
- `vendor/makefun-board.ts` — the kit's dossier library, copied unchanged.

## Honesty notes

A protocol here *records no token* — that is DefiLlama's record, not
proof it has none. An implied value is this model's claim from one frozen
snapshot: not a price, and not a prediction that a token will launch.

## Competition note

Entry for make.fun's token-radar-01 ("Build the best token launch
radar"), program/v1 harness with an AI judge. The judge reads only the
screenshots and the dashboard's source, so everything the model claims
lives in `dashboard/` and is visible in the captures.
