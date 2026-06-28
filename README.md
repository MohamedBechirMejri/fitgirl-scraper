# fitgirl-scraper

Local-first archive scraper for FitGirl posts.

The new scraper stores:

- full HTML page snapshots under `archive/pages`
- downloaded assets under `archive/assets`
- page, snapshot, link, and asset metadata in `archive/fitgirl.sqlite`
- crawl queue state in `archive/fitgirl.sqlite`, so interrupted runs can resume

The old JSON scraper and scheduled GitHub Action have been removed. The archive is intended to run locally.

Install dependencies:

```bash
bun install
```

Run a conservative local scrape:

```bash
bun run scrape:local
```

Useful flags:

```bash
bun run scrape:local -- --limit 100
bun run scrape:local -- --limit 0 --all
bun run scrape:local -- --no-assets
bun run scrape:local -- --delay-ms 3000
bun run scrape:local -- --seed
bun run scrape:local -- --refresh-stale
bun run scrape:local -- --asset-depth 3
bun run scrape:local -- --refresh-days 30
bun run scrape:local -- --timeout-ms 15000
bun run scrape:local -- --url https://fitgirl-repacks.site/sportal/
```

`--limit 0 --all` means every post found in the sitemaps. Start with a small limit and increase it gradually.
`--seed` refreshes the local queue from FitGirl post sitemaps. Normal runs only seed automatically when the queue is empty.
`--url` fetches one specific FitGirl page and skips sitemap seeding.
`--refresh-stale` requeues already-saved pages whose last check is older than `--refresh-days`, capped by `--limit`.
`--refresh-days` controls how long sitemap-unchanged pages can skip conditional rechecks. Use `--refresh-days 0` to revalidate every processed page.
`--timeout-ms` caps each page or sitemap request. `403` and `429` stop the run instead of continuing through the queue.

Normal scrape runs process up to `--limit` queued pages. The first run seeds the local crawl queue from FitGirl post sitemaps; later sitemap refreshes require `--seed`. Targeted `--url` runs enqueue that page directly. `--refresh-stale --refresh-days 0 --limit 10` is the small-batch way to force-update-check saved pages. Discovered links are saved for browsing, but they are not queued automatically. Failed sitemap/manual/refresh pages are kept for retry. CSS `url(...)` and `@import` dependencies are downloaded up to `--asset-depth`.

Backfill missing assets for already-saved snapshots:

```bash
bun run assets:backfill
bun run assets:backfill -- --limit 100
bun run assets:backfill -- --retry-failed
bun run assets:backfill -- --limit 50 --timeout-ms 15000
```

`assets:backfill --limit` is a hard network request budget, including CSS dependencies.

Check local archive health without opening the viewer:

```bash
bun run health
bun run health -- --limit 10
```

Refresh structured metadata, links, and asset references from already-saved snapshot HTML:

```bash
bun run snapshots:backfill
bun run snapshots:backfill -- --limit 100
```

Open the local archive viewer:

```bash
bun run view
```

The viewer runs at `http://localhost:4173` by default. Its `/ops` page shows current queue/asset health, recent runs, and the next conservative commands to run. Use `--port` or `--archive` when needed:

```bash
bun run view -- --port 4174
bun run view -- --archive /path/to/archive
```
