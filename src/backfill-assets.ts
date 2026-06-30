import { join } from "path";
import { saveAssets } from "./asset-downloader";
import { openArchiveStore } from "./archive-store";
import { isFitGirlUrl, normalizeUrl } from "./page-extract";

const BASE_URL = "https://fitgirl-repacks.site";
const DEFAULT_ARCHIVE_DIR = "archive";
const DEFAULT_ASSET_DEPTH = 2;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_LIMIT = 25;
const DEFAULT_TIMEOUT_MS = 15_000;

interface BackfillOptions {
  archiveDir: string;
  assetDepth: number;
  delayMs: number;
  includeFailed: boolean;
  targetLatestPages: boolean;
  limit: number;
  maxRequests?: number;
  rounds: number;
  targetWeakest: boolean;
  targetUrl: string | null;
  timeoutMs: number;
}

export async function runBackfillAssets(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const store = await openArchiveStore(join(options.archiveDir, "fitgirl.sqlite"));
  const runId = store.startRun({
    command: formatCommand("bun run assets:backfill", args),
    kind: "asset-backfill",
  });

  try {
    const selector = {
      includeFailed: options.includeFailed,
      limit: options.limit,
    };
    const selectedPages: string[] = [];
    let selectedAssets = 0;

    for (let round = 1; round <= options.rounds; round++) {
      const latestPage = options.targetLatestPages ? store.getLatestPostAssetPages(selector, 1)[0] ?? null : null;
      const targetPage = options.targetWeakest ? store.getWeakestAssetPage(selector) : latestPage;
      const targetUrl = options.targetUrl ?? targetPage?.url ?? null;
      const assets = targetUrl ? store.getAssetsToBackfillForPage(targetUrl, selector) : store.getAssetsToBackfill(selector);

      if (options.targetWeakest && targetPage) {
        console.log(
          `Round ${round}/${options.rounds} weakest page: ${targetPage.downloadedAssetCount}/${targetPage.assetCount} ${targetPage.title}`
        );
      }
      if (options.targetLatestPages && targetPage) {
        console.log(
          `Round ${round}/${options.rounds} latest post: ${targetPage.downloadedAssetCount}/${targetPage.assetCount} ${targetPage.title}`
        );
      }

      if (assets.length === 0) {
        console.log("No assets to backfill.");
        break;
      }

      if (targetUrl) selectedPages.push(targetUrl);
      selectedAssets += assets.length;
      console.log(`Backfilling ${assets.length} assets.`);
      await saveAssets(store, { ...options, maxRequests: options.limit === 0 ? undefined : options.limit }, assets);

      if (!options.targetWeakest && !options.targetLatestPages) break;
    }

    const stats = store.getStats();
    console.log(`Assets: ${stats.downloadedAssets}/${stats.assets} downloaded.`);
    store.finishRun(runId, {
      status: "success",
      summary: {
        selectedAssets,
        selectedPages,
        stats,
      },
    });
  } catch (error) {
    store.finishRun(runId, {
      error,
      status: "failed",
      summary: {
        stats: store.getStats(),
      },
    });
    throw error;
  } finally {
    store.close();
  }
}

export function parseOptions(args: string[]): BackfillOptions {
  const limit = readNumberFlag(args, "--limit", DEFAULT_LIMIT);
  const rounds = readNumberFlag(args, "--rounds", 1);
  const targetUrl = readTargetUrl(args);
  const targetWeakest = args.includes("--weakest");
  const targetLatestPages = args.includes("--latest-pages");
  if (!Number.isInteger(rounds) || rounds <= 0) throw new Error("--rounds must be a positive integer");
  const targetModes = [Boolean(targetUrl), targetWeakest, targetLatestPages].filter(Boolean).length;
  if (targetModes > 1) throw new Error("Use only one of --url, --weakest, or --latest-pages");
  if (rounds !== 1 && !targetWeakest && !targetLatestPages) {
    throw new Error("--rounds only works with --weakest or --latest-pages");
  }

  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    assetDepth: readNumberFlag(args, "--asset-depth", DEFAULT_ASSET_DEPTH),
    delayMs: readNumberFlag(args, "--delay-ms", DEFAULT_DELAY_MS),
    includeFailed: args.includes("--retry-failed"),
    limit,
    maxRequests: limit === 0 ? undefined : limit,
    rounds,
    targetLatestPages,
    targetWeakest,
    targetUrl,
    timeoutMs: readNumberFlag(args, "--timeout-ms", DEFAULT_TIMEOUT_MS),
  };
}

function readTargetUrl(args: string[]): string | null {
  const rawUrl = readStringFlag(args, "--url", "");
  if (!rawUrl) return null;

  const url = normalizeUrl(rawUrl, BASE_URL);
  if (!url || !isFitGirlUrl(url)) {
    throw new Error("--url must be a FitGirl URL");
  }

  return url;
}

function readStringFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const raw = readStringFlag(args, name, String(fallback));
  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function formatCommand(baseCommand: string, args: string[]): string {
  const suffix = args.map(arg => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
  return suffix ? `${baseCommand} -- ${suffix}` : baseCommand;
}

if (import.meta.main) {
  runBackfillAssets(Bun.argv.slice(2)).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
