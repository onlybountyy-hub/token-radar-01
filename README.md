# Launch Radar

[![make.fun competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/onlybountyy-hub/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/onlybountyy-hub/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

Launch Radar reads a sealed snapshot of the DefiLlama protocol index — 758 protocols with at least $5M of TVL, frozen as of 2026-11-14 — and ranks the protocols that record no token of their own by the value a token would carry if one were priced the way the market already prices their live-token peers. All 40 of the snapshot's watchlist protocols are covered, and the radar reaches past the watchlist's $50M floor: 198 pre-token protocols are ranked, each with the model shown factor by factor and a six-step farm plan with costs and times. The 416 protocols that already trade are never ranked; the 32 of them large enough to matter are shown apart, because their market-cap-to-TVL ratios are what calibrate the model.

## Run it

```sh
node --experimental-strip-types main.ts --input /input --output /output
# or: node --experimental-strip-types main.ts            (reads /input, writes /output)
# or: node --experimental-strip-types main.ts --input snapshot.json --output out
```

Node 22 or newer, standard library only, no network. Open `dashboard/index.html` from the output folder to read the board; `board.json` is the machine-readable ranking and `data.js` is the same dataset for the page.

## How it works

One function prices every protocol from the snapshot's own figures; no name is looked up and no row is hand-placed:

- **Peer multiple.** The median market-cap/TVL of the protocol's category among live-token protocols in the same snapshot, shrunk toward the global median (0.205x) by peer count so a thin category cannot shout, and clamped to [0.03x, 2.5x].
- **Growth.** Seven-day TVL change clamped to [-50%, +100%] and weighted at 0.6; an unreported change counts as flat.
- **Maturity.** Days tracked with no token, on a square-root curve over five years; an unrecorded listing day is scored at the board's median age.
- **Reach.** Each chain past the first adds 4%, up to six extra chains.

`implied = round(TVL x multiple x growth x maturity x reach)`. A launch score (0-100) blends the same four inputs on fixed scales at weights 45/25/20/10. The board excludes token wrappers, versioned re-releases and exchange front-ends, which no launch is expected from; the dashboard carries the model itself, so opening any protocol recomputes its implied value and farm plan in the page and compares them with the board the program wrote. Implied value is a model's claim from one frozen snapshot — not a price, and not a prediction that a token will be issued.

## Layout

- `main.ts` — the program: reads the snapshot, writes the board, the page data, the dashboard, the screenshots and the dossier.
- `lib/model.ts` — snapshot parsing, the peer-multiple calibration, scoring, signals and farm plans.
- `dashboard/` — the board page: ranked table with search and filters, a signals view, the live-token calibration set, the model page, and a per-protocol detail view.
- `screenshots/` — the board, one protocol's detail, and a filtered board, as the program serves them.
- `vendor/makefun-board.ts` — the kit's dossier writer, copied unchanged.

## Competition

Entered in [token-radar-01](https://make.fun/c/token-radar-01) on make.fun. If this project earned a bounty, the prize goes to the entrant's linked wallet.

Referral: if make.fun asks who sent you, the code is `q6ckzx1w`.

## License

MIT — see LICENSE.
