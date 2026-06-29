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
  limit: number;
  maxRequests?: number;
  targetWeakest: boolean;
  targetUrl: string | null;
  timeoutMs: number;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
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
    const targetPage = options.targetWeakest ? store.getWeakestAssetPage(selector) : null;
    const targetUrl = options.targetUrl ?? targetPage?.url ?? null;
    const assets = targetUrl ? store.getAssetsToBackfillForPage(targetUrl, selector) : store.getAssetsToBackfill(selector);

    if (targetPage) {
      console.log(`Weakest page: ${targetPage.downloadedAssetCount}/${targetPage.assetCount} ${targetPage.title}`);
    }

    if (assets.length === 0) {
      console.log("No assets to backfill.");
      store.finishRun(runId, {
        status: "success",
        summary: {
          selectedAssets: 0,
          selectedPage: targetUrl,
          stats: store.getStats(),
        },
      });
      return;
    }

    console.log(`Backfilling ${assets.length} assets.`);
    await saveAssets(store, options, assets);

    const stats = store.getStats();
    console.log(`Assets: ${stats.downloadedAssets}/${stats.assets} downloaded.`);
    store.finishRun(runId, {
      status: "success",
      summary: {
        selectedAssets: assets.length,
        selectedPage: targetUrl,
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

function parseOptions(args: string[]): BackfillOptions {
  const limit = readNumberFlag(args, "--limit", DEFAULT_LIMIT);
  const targetUrl = readTargetUrl(args);
  const targetWeakest = args.includes("--weakest");
  if (targetUrl && targetWeakest) throw new Error("Use either --url or --weakest, not both");

  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    assetDepth: readNumberFlag(args, "--asset-depth", DEFAULT_ASSET_DEPTH),
    delayMs: readNumberFlag(args, "--delay-ms", DEFAULT_DELAY_MS),
    includeFailed: args.includes("--retry-failed"),
    limit,
    maxRequests: limit === 0 ? undefined : limit,
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
