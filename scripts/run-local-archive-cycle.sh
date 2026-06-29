#!/usr/bin/env bash
set -euo pipefail

scrape_limit="${FITGIRL_SCRAPE_LIMIT:-50}"
refresh_days="${FITGIRL_REFRESH_DAYS:-30}"
refresh_limit="${FITGIRL_REFRESH_LIMIT:-10}"
delay_ms="${FITGIRL_DELAY_MS:-3000}"
asset_depth="${FITGIRL_ASSET_DEPTH:-2}"
asset_limit="${FITGIRL_ASSET_LIMIT:-50}"
asset_rounds="${FITGIRL_ASSET_ROUNDS:-2}"
asset_delay_ms="${FITGIRL_ASSET_DELAY_MS:-2000}"

bun run scrape:local -- \
  --seed \
  --crawl-discovered \
  --limit "$scrape_limit" \
  --delay-ms "$delay_ms" \
  --no-assets \
  --asset-depth "$asset_depth"

bun run scrape:local -- \
  --refresh-stale \
  --limit "$refresh_limit" \
  --refresh-days "$refresh_days" \
  --delay-ms "$delay_ms" \
  --no-assets \
  --asset-depth "$asset_depth"

bun run assets:backfill -- \
  --weakest \
  --rounds "$asset_rounds" \
  --limit "$asset_limit" \
  --delay-ms "$asset_delay_ms" \
  --asset-depth "$asset_depth"

bun run mirror:export

bun run health
