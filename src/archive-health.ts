import { join } from "path";
import {
  openArchiveStore,
  type ArchiveStats,
  type AssetFailureRow,
  type PageListRow,
  type QueueFailureRow,
} from "./archive-store";

const DEFAULT_ARCHIVE_DIR = "archive";
const DEFAULT_LIMIT = 5;
const PAGE_SCAN_LIMIT = 10_000;

interface HealthOptions {
  archiveDir: string;
  limit: number;
}

interface HealthReportInput {
  assetFailures: AssetFailureRow[];
  limit: number;
  pages: PageListRow[];
  queueFailures: QueueFailureRow[];
  stats: ArchiveStats;
}

export function formatHealthReport(input: HealthReportInput): string {
  const stats = input.stats;
  const missingAssets = stats.assets - stats.downloadedAssets;
  const assetCoverage = percent(stats.downloadedAssets, stats.assets);
  const weakPages = lowestAssetCoverage(input.pages, input.limit);
  const lines = [
    "FitGirl archive health",
    "",
    `Pages: ${stats.pages}`,
    `Snapshots: ${stats.snapshots}`,
    `Queue: ${stats.queuePending} pending, ${stats.queueRunning} running, ${stats.queueDone} done, ${stats.queueFailed} failed`,
    `Assets: ${stats.downloadedAssets}/${stats.assets} downloaded (${assetCoverage}), ${missingAssets} missing`,
    "",
    "Lowest asset coverage:",
    ...(weakPages.length === 0 ? ["- none"] : weakPages.map(page => `- ${assetRatio(page)} ${page.title}\n  ${page.url}`)),
    "",
    "Recent failures:",
    ...failureLines("Queue", input.queueFailures.map(row => `${row.url} (${row.attempts} attempts)`)),
    ...failureLines("Assets", input.assetFailures.map(row => `${row.url} (${row.httpStatus ?? "failed"})`)),
    "",
    "Next commands:",
    "- bun run scrape:local -- --limit 25 --delay-ms 3000",
    "- bun run scrape:local -- --refresh-stale --limit 25 --refresh-days 30 --delay-ms 3000",
    "- bun run assets:backfill -- --weakest --rounds 2 --limit 25 --delay-ms 2000 --asset-depth 2",
    "- bun run assets:backfill -- --limit 25 --retry-failed --delay-ms 3000",
  ];

  return `${lines.join("\n")}\n`;
}

export function lowestAssetCoverage(pages: PageListRow[], limit: number): PageListRow[] {
  return pages
    .filter(page => page.assetCount > 0 && page.downloadedAssetCount < page.assetCount)
    .sort((left, right) => {
      const coverage = left.downloadedAssetCount / left.assetCount - right.downloadedAssetCount / right.assetCount;
      return coverage || right.assetCount - left.assetCount || left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

async function main(): Promise<void> {
  const options = parseOptions(Bun.argv.slice(2));
  const store = await openArchiveStore(join(options.archiveDir, "fitgirl.sqlite"));

  try {
    const report = formatHealthReport({
      assetFailures: store.getRecentAssetFailures(options.limit),
      limit: options.limit,
      pages: store.searchPages("", PAGE_SCAN_LIMIT),
      queueFailures: store.getRecentQueueFailures(options.limit),
      stats: store.getStats(),
    });
    console.log(report);
  } finally {
    store.close();
  }
}

function failureLines(label: string, rows: string[]): string[] {
  return rows.length === 0 ? [`- ${label}: none`] : rows.map(row => `- ${label}: ${row}`);
}

function assetRatio(page: PageListRow): string {
  return `${page.downloadedAssetCount}/${page.assetCount} (${percent(page.downloadedAssetCount, page.assetCount)})`;
}

function percent(value: number, total: number): string {
  return total === 0 ? "100%" : `${Math.round((value / total) * 100)}%`;
}

function parseOptions(args: string[]): HealthOptions {
  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    limit: readNumberFlag(args, "--limit", DEFAULT_LIMIT),
  };
}

function readStringFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const value = Number(readStringFlag(args, name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
