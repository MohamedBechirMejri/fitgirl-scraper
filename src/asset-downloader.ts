import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, extname, join, relative } from "path";
import { ArchiveStore } from "./archive-store";
import { extractCssAssetReferences } from "./css-assets";
import type { AssetKind, AssetReference } from "./page-extract";

export interface AssetDownloadOptions {
  archiveDir: string;
  assetDepth: number;
  delayMs: number;
  maxRequests?: number;
  timeoutMs?: number;
}

interface BinaryResponse {
  body: Uint8Array;
  contentType: string | null;
  status: number;
}

const USER_AGENT = "fitgirl-local-archive/0.1";
const DEFAULT_TIMEOUT_MS = 15_000;

export async function saveAssets(
  store: ArchiveStore,
  options: AssetDownloadOptions,
  assets: AssetReference[],
  depth = 0,
  seen = new Set<string>()
): Promise<void> {
  for (const asset of assets) {
    if (seen.has(asset.url)) continue;
    seen.add(asset.url);

    const existing = store.getAsset(asset.url);
    if (existing?.localPath) {
      await saveCssDependencies(store, options, asset, existing.localPath, depth, seen);
      continue;
    }

    const fetchedAt = new Date().toISOString();
    if (!claimRequest(options)) break;

    try {
      const response = await fetchBinary(asset.url, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (response.status < 200 || response.status >= 300) {
        store.saveAssetResult({
          contentHash: null,
          contentType: response.contentType,
          fetchedAt,
          httpStatus: response.status,
          localPath: null,
          sizeBytes: 0,
          url: asset.url,
        });
        await sleep(options.delayMs);
        continue;
      }

      const contentHash = sha256Bytes(response.body);
      const localPath = await saveAsset(options.archiveDir, asset.url, contentHash, response.contentType, response.body);

      store.saveAssetResult({
        contentHash,
        contentType: response.contentType,
        fetchedAt,
        httpStatus: response.status,
        localPath,
        sizeBytes: response.body.byteLength,
        url: asset.url,
      });
      await saveCssDependencies(store, options, asset, localPath, depth, seen);
    } catch (error) {
      store.saveAssetResult({
        contentHash: null,
        contentType: null,
        fetchedAt,
        httpStatus: 0,
        localPath: null,
        sizeBytes: 0,
        url: asset.url,
      });
      console.error(`Asset failed: ${asset.url}`, error);
    }

    await sleep(options.delayMs);
  }
}

async function saveCssDependencies(
  store: ArchiveStore,
  options: AssetDownloadOptions,
  asset: AssetReference,
  localPath: string,
  depth: number,
  seen: Set<string>
): Promise<void> {
  if (depth >= options.assetDepth || asset.kind !== "stylesheet") return;

  try {
    const css = await readFile(localPath, "utf-8");
    const references = extractCssAssetReferences(css, asset.url).map(reference => ({
      kind: reference.source === "css-import" ? "stylesheet" : cssReferenceKind(reference.url),
      source: reference.source,
      url: reference.url,
    }));

    await saveAssets(store, options, references, depth + 1, seen);
  } catch (error) {
    console.error(`CSS dependency scan failed: ${asset.url}`, error);
  }
}

async function fetchBinary(url: string, timeoutMs: number): Promise<BinaryResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    return {
      body: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function saveAsset(
  archiveDir: string,
  url: string,
  contentHash: string,
  contentType: string | null,
  body: Uint8Array
): Promise<string> {
  const extension = assetExtension(url, contentType);
  const filename = `${contentHash}${extension}`;
  const dir = join(archiveDir, "assets", contentHash.slice(0, 2));
  const path = join(dir, filename);

  await mkdir(dir, { recursive: true });
  await writeFile(path, body);

  return relative(process.cwd(), path);
}

function assetExtension(url: string, contentType: string | null): string {
  const pathExtension = extname(basename(new URL(url).pathname)).slice(0, 12);
  if (pathExtension) return pathExtension;

  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("css")) return ".css";
  if (contentType?.includes("javascript")) return ".js";

  return ".bin";
}

function cssReferenceKind(url: string): AssetKind {
  const pathname = new URL(url).pathname.toLowerCase();

  if (pathname.endsWith(".css")) return "stylesheet";
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(pathname)) return "image";
  if (/\.(mp4|webm|mp3|ogg|wav)$/.test(pathname)) return "media";

  return "other";
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function claimRequest(options: AssetDownloadOptions): boolean {
  if (options.maxRequests === undefined) return true;
  if (options.maxRequests <= 0) return false;
  options.maxRequests--;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
