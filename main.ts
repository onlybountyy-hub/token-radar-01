// Launch Radar — token-radar-01 entry program.
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol by the
// implied value the model in lib/model.ts derives from the snapshot's own
// figures, and writes the board, the dashboard's data file, copies of the
// dashboard and screenshots, and the dossier the judge reads.
//
//   node --experimental-strip-types main.ts --input <dir-or-file> --output <dir>
//
// Defaults: --input /input, --output /output (or $MAKEFUN_OUTPUT_DIR).
// Standard library only, no network. Deterministic: two runs on the same
// snapshot write byte-identical board.json.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  buildBoard, fmtUsd, type Snapshot,
} from "./lib/model.ts";

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function main(): void {
  const args = process.argv.slice(2);
  const inputArg = argValue(args, "--input") ?? "/input";
  const outputDir = argValue(args, "--output")
    ?? process.env.MAKEFUN_OUTPUT_DIR
    ?? "/output";
  const inputPath = inputArg.endsWith(".json")
    ? inputArg
    : join(inputArg, "snapshot.json");

  const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  const { rows, calibration, liveTokens } = buildBoard(snap);

  mkdirSync(outputDir, { recursive: true });

  // The board: ranked pre-token protocols, watchlist fully covered (the
  // coverage assertion lives in buildBoard and throws before we get here).
  const board = { rows };
  writeFileSync(join(outputDir, "board.json"), JSON.stringify(board, null, 2) + "\n");

  // The dashboard's data, in the output ROOT — never inside dashboard/, so
  // it stays out of the dossier's source text. The page loads ../data.js.
  const preTokenTvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
  const data = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    stats: {
      board_rows: rows.length,
      watchlist_covered: rows.filter((r) => r.on_watchlist).length,
      watchlist_total: snap.watchlist.length,
      pre_token_tvl_usd: preTokenTvl,
      pre_token_tvl_text: fmtUsd(preTokenTvl),
      live_token_count: liveTokens.length,
      global_median_multiple: calibration.global_median,
      priced_peer_count: calibration.priced_peer_count,
      categories_calibrated: calibration.by_category.filter((c) => !c.fallback).length,
      categories_total: calibration.by_category.length,
    },
    rows,
    calibration: calibration.by_category,
    global_median_multiple: calibration.global_median,
    live_tokens: liveTokens.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    })),
  };
  writeFileSync(
    join(outputDir, "data.js"),
    "window.LAUNCH_RADAR = " + JSON.stringify(data) + ";\n",
  );

  // The page and its screenshots travel with the output.
  const root = dirname(fileURLToPath(import.meta.url));
  cpSync(join(root, "dashboard"), join(outputDir, "dashboard"), { recursive: true });
  if (existsSync(join(root, "screenshots"))) {
    cpSync(join(root, "screenshots"), join(outputDir, "screenshots"), { recursive: true });
  }

  const dossier = buildDossier(outputDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 512 * 1024 },
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  });
  writeFileSync(join(outputDir, "dossier.json"), dossier);

  console.log(
    `Launch Radar: ${rows.length} pre-token rows, ` +
    `${data.stats.watchlist_covered}/${snap.watchlist.length} watchlist covered, ` +
    `${liveTokens.length} live tokens set aside as the calibration set.`,
  );
}

main();
