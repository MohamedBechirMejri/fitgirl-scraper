import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join, relative } from "path";
import { saveAssets } from "./asset-downloader";
import { ArchiveStore, openArchiveStore, type CrawlQueueInput, type CrawlQueueItem } from "./archive-store";
import {
  extractPageReferences,
  extractSitemapEntries,
  extractSitemapUrls,
  isFitGirlUrl,
  normalizeUrl,
  type SitemapEntry,
} from "./page-extract";

const BASE_URL = "https://fitgirl-repacks.site";
const SITEMAP_INDEX_URL = `${BASE_URL}/sitemap_index.xml`;
const DEFAULT_ARCHIVE_DIR = "archive";
const DEFAULT_ASSET_DEPTH = 2;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_LIMIT = 25;
const DEFAULT_REFRESH_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "fitgirl-local-archive/0.1";

interface ScraperOptions {
  archiveDir: string;
  assetDepth: number;
  downloadAssets: boolean;
  delayMs: number;
  limit: number;
  refreshDays: number;
  refreshStale: boolean;
  seedSitemaps: boolean;
  targetUrl: string | null;
  timeoutMs: number;
}

interface TextResponse {
  body: string;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  status: number;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const options = parseOptions(args);
  const dbPath = join(options.archiveDir, "fitgirl.sqlite");
  const store = await openArchiveStore(dbPath);
  const runId = store.startRun({
    command: formatCommand("bun run scrape:local", args),
    kind: "scrape",
  });

  try {
    const resetCount = store.resetRunningQueue();
    if (resetCount > 0) {
      console.log(`Reset ${resetCount} interrupted queue items.`);
    }
    const prunedCount = store.pruneDiscoveredQueue();
    if (prunedCount > 0) {
      console.log(`Pruned ${prunedCount} discovered queue items.`);
    }

    let seededCount: number | null = null;
    let seedError: string | null = null;
    let staleQueuedCount: number | null = null;

    if (options.targetUrl) {
      store.enqueueUrl({
        forcePending: true,
        priority: Number.MAX_SAFE_INTEGER,
        sitemapLastModified: null,
        source: "manual",
        url: options.targetUrl,
      });
      console.log(`Queued target URL: ${options.targetUrl}`);
    } else if (options.refreshStale) {
      staleQueuedCount = store.enqueueStalePagesForRefresh(options.refreshDays, options.limit);
      console.log(`Queued ${staleQueuedCount} stale saved pages for refresh.`);
    } else {
      const queueStats = store.getQueueStats();
      if (shouldSeedSitemaps(options.seedSitemaps, queueStats)) {
        try {
          seededCount = await seedQueueFromSitemaps(store, options);
          console.log(`Seeded ${seededCount} sitemap URLs.`);
        } catch (error) {
          seedError = error instanceof Error ? error.message : String(error);
          if (isBlockingError(error)) throw error;
          console.error("Sitemap seed failed; continuing with existing queue.", error);
        }
      } else {
        console.log(`Skipped sitemap seed; ${queueStats.pending} queued pages already pending.`);
      }
    }

    const processedCount = await processQueue(store, options);
    store.finishRun(runId, {
      status: "success",
      summary: {
        processedCount,
        prunedCount,
        resetCount,
        seedError,
        seededCount,
        staleQueuedCount,
        stats: store.getStats(),
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

async function seedQueueFromSitemaps(store: ArchiveStore, options: ScraperOptions): Promise<number> {
  const sitemapIndex = await fetchText(SITEMAP_INDEX_URL, {}, options.timeoutMs);
  assertSitemapStatus(sitemapIndex.status, SITEMAP_INDEX_URL);
  await sleep(options.delayMs);

  const sitemapUrls = extractSitemapUrls(sitemapIndex.body, BASE_URL).filter(url => url.includes("post-sitemap"));
  const postEntries = new Map<string, SitemapEntry>();

  for (const sitemapUrl of sitemapUrls) {
    const sitemap = await fetchText(sitemapUrl, {}, options.timeoutMs);
    assertSitemapStatus(sitemap.status, sitemapUrl);
    for (const entry of extractSitemapEntries(sitemap.body, BASE_URL)) {
      if (isFitGirlUrl(entry.url) && !entry.url.includes("updates-digest")) {
        postEntries.set(entry.url, entry);
      }
    }
    await sleep(options.delayMs);
  }

  const entries = [...postEntries.values()].sort(
    (left, right) =>
      (right.lastModified ?? "").localeCompare(left.lastModified ?? "") || left.url.localeCompare(right.url)
  );
  store.enqueueUrls(entries.map(sitemapEntryToQueueInput));

  return entries.length;
}

async function processQueue(store: ArchiveStore, options: ScraperOptions): Promise<number> {
  let processed = 0;
  const maxItems = options.limit;

  while (maxItems === 0 || processed < maxItems) {
    const item = store.claimNextQueueItem();
    if (!item) break;

    processed++;

    try {
      await scrapePage(store, item, options, processed, maxItems);
      store.completeQueueItem(item.url);
    } catch (error) {
      store.failQueueItem(item.url, error);
      console.error(`Failed ${item.url}`, error);
      if (isBlockingError(error)) throw error;
    }

    await sleep(options.delayMs);
  }

  const stats = store.getQueueStats();
  console.log(
    `Queue: ${stats.pending} pending, ${stats.running} running, ${stats.done} done, ${stats.failed} failed.`
  );

  return processed;
}

async function scrapePage(
  store: ArchiveStore,
  item: CrawlQueueItem,
  options: ScraperOptions,
  index: number,
  limit: number
): Promise<void> {
  const { url } = item;
  const checkedAt = new Date().toISOString();
  const latest = store.getPageState(url);
  const position = limit === 0 ? String(index) : `${index}/${limit}`;

  if (
    latest?.latestSnapshotId &&
    item.sitemapLastModified &&
    latest.sitemapLastModified === item.sitemapLastModified &&
    wasCheckedRecently(latest.lastCheckedAt, checkedAt, options.refreshDays)
  ) {
    store.markPageChecked(url, checkedAt, item.sitemapLastModified);
    console.log(`[${position}] sitemap unchanged ${url}`);
    return;
  }

  const response = await fetchText(
    url,
    {
      ...(latest?.etag ? { "if-none-match": latest.etag } : {}),
      ...(latest?.lastModified ? { "if-modified-since": latest.lastModified } : {}),
    },
    options.timeoutMs
  );

  if (response.status === 304) {
    store.markPageChecked(url, checkedAt, item.sitemapLastModified);
    console.log(`[${position}] unchanged ${url}`);
    return;
  }

  if (shouldStopRunForStatus(response.status)) {
    throw new BlockingHttpError(response.status);
  }

  if (response.status >= 500) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentHash = sha256Text(response.body);
  const htmlPath = await saveHtml(options.archiveDir, url, contentHash, response.body);
  const references = await extractPageReferences(response.body, url);
  const snapshot = store.saveSnapshot({
    contentHash,
    contentType: response.contentType,
    etag: response.etag,
    fetchedAt: checkedAt,
    htmlPath,
    lastModified: response.lastModified,
    metadata: references.metadata,
    sitemapLastModified: item.sitemapLastModified,
    status: response.status,
    textContent: references.textContent,
    title: references.title,
    url,
  });

  store.saveSnapshotReferences(snapshot.id, references.links, references.assets);

  if (options.downloadAssets) {
    await saveAssets(store, options, references.assets);
  }

  const state = snapshot.isNew ? "saved" : "checked";
  console.log(`[${position}] ${state} ${url} (${references.links.length} links, ${references.assets.length} assets)`);
}

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TextResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT,
        ...headers,
      },
      signal: controller.signal,
    });

    return {
      body: await response.text(),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function saveHtml(archiveDir: string, url: string, contentHash: string, html: string): Promise<string> {
  const urlHash = sha256Text(url).slice(0, 16);
  const dir = join(archiveDir, "pages", urlHash);
  const path = join(dir, `${contentHash}.html`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, html);

  return relative(process.cwd(), path);
}

function parseOptions(args: string[]): ScraperOptions {
  const targetUrl = readTargetUrl(args);

  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    assetDepth: readNumberFlag(args, "--asset-depth", DEFAULT_ASSET_DEPTH),
    downloadAssets: !args.includes("--no-assets"),
    delayMs: readNumberFlag(args, "--delay-ms", DEFAULT_DELAY_MS),
    limit: readScrapeLimit(args, targetUrl),
    refreshDays: readNumberFlag(args, "--refresh-days", DEFAULT_REFRESH_DAYS),
    refreshStale: args.includes("--refresh-stale"),
    seedSitemaps: args.includes("--seed"),
    targetUrl,
    timeoutMs: readNumberFlag(args, "--timeout-ms", DEFAULT_TIMEOUT_MS),
  };
}

export function shouldSeedSitemaps(forceSeed: boolean, queueStats: Record<"done" | "failed" | "pending" | "running", number>): boolean {
  return forceSeed || queueStats.done + queueStats.failed + queueStats.pending + queueStats.running === 0;
}

export function readScrapeLimit(args: string[], targetUrl: string | null): number {
  const limit = readNumberFlag(args, "--limit", targetUrl ? 1 : DEFAULT_LIMIT);
  if (limit === 0 && !args.includes("--all")) {
    throw new Error("--limit 0 requires --all");
  }

  return limit;
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

function sitemapEntryToQueueInput(entry: SitemapEntry): CrawlQueueInput {
  return {
    priority: entry.lastModified ? Date.parse(entry.lastModified) || 0 : 0,
    sitemapLastModified: entry.lastModified,
    source: "sitemap",
    url: entry.url,
  };
}

function assertSitemapStatus(status: number, url: string): void {
  if (shouldStopRunForStatus(status)) throw new BlockingHttpError(status);
  if (status >= 400) throw new Error(`HTTP ${status} while fetching ${url}`);
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

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function wasCheckedRecently(lastCheckedAt: string | null, now: string, refreshDays: number): boolean {
  if (refreshDays <= 0 || !lastCheckedAt) return false;
  return Date.parse(now) - Date.parse(lastCheckedAt) < refreshDays * 24 * 60 * 60 * 1000;
}

export function shouldStopRunForStatus(status: number): boolean {
  return status === 403 || status === 429;
}

class BlockingHttpError extends Error {
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "BlockingHttpError";
  }
}

function isBlockingError(error: unknown): boolean {
  return error instanceof BlockingHttpError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
