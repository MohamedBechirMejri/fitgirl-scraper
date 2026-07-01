import { createHash } from "crypto";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "path";
import {
  openArchiveStore,
  type ArchiveStore,
  type SnapshotRow,
} from "./archive-store";
import { rewriteCssAssetReferences } from "./css-assets";
import { isFitGirlUrl } from "./page-extract";
import { rewriteSnapshotHtml } from "./snapshot-rewrite";

const DEFAULT_ARCHIVE_DIR = "archive";
const MAX_PATH_SEGMENT_LENGTH = 180;

interface ExportMirrorOptions {
  archiveDir: string;
  assetLimit: number;
  mirrorDir: string;
  pageLimit: number;
}

interface ExportCounts {
  exportedAssets: number;
  exportedPages: number;
  skippedAssets: number;
  skippedPages: number;
}

interface DownloadedAssetRow {
  contentType: string | null;
  localPath: string;
  url: string;
}

export async function runExportMirror(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const store = await openArchiveStore(join(options.archiveDir, "fitgirl.sqlite"));
  const runId = store.startRun({
    command: formatCommand("bun run mirror:export", args),
    kind: "mirror-export",
  });

  try {
    const counts = await exportMirror(store, options);
    console.log(
      `Mirror: ${counts.exportedPages} pages, ${counts.exportedAssets} assets exported; ${counts.skippedPages} pages, ${counts.skippedAssets} assets skipped.`
    );
    store.finishRun(runId, { status: "success", summary: { ...counts } });
  } catch (error) {
    store.finishRun(runId, { error, status: "failed" });
    throw error;
  } finally {
    store.close();
  }
}

export async function exportMirror(store: ArchiveStore, options: ExportMirrorOptions): Promise<ExportCounts> {
  const archiveRoot = resolve(options.archiveDir);
  const mirrorRoot = resolve(options.mirrorDir);
  const counts: ExportCounts = { exportedAssets: 0, exportedPages: 0, skippedAssets: 0, skippedPages: 0 };

  await mkdir(mirrorRoot, { recursive: true });

  for (const asset of downloadedAssetsForExport(store, options.assetLimit)) {
    try {
      await exportAsset(asset, archiveRoot, mirrorRoot);
      counts.exportedAssets++;
    } catch (error) {
      counts.skippedAssets++;
      console.error(`Mirror asset export failed: ${asset.url}`, error);
    }
  }

  for (const snapshot of latestSnapshotsForExport(store, options.pageLimit)) {
    try {
      await exportPage(store, snapshot, archiveRoot, mirrorRoot);
      counts.exportedPages++;
    } catch (error) {
      counts.skippedPages++;
      console.error(`Mirror page export failed: ${snapshot.url}`, error);
    }
  }

  return counts;
}

function latestSnapshotsForExport(store: ArchiveStore, limit: number): SnapshotRow[] {
  const sql = `select
      snapshots.id,
      snapshots.url,
      snapshots.title,
      snapshots.fetched_at as fetchedAt,
      snapshots.status,
      snapshots.content_type as contentType,
      snapshots.content_hash as contentHash,
      snapshots.html_path as htmlPath,
      snapshots.metadata_json as metadataJson,
      snapshots.text_content as textContent
    from pages
    join snapshots on snapshots.id = pages.latest_snapshot_id
    order by pages.url asc`;

  if (limit === 0) {
    return store.db.query<SnapshotRow, []>(sql).all();
  }

  return store.db.query<SnapshotRow, [number]>(`${sql} limit ?`).all(limit);
}

function downloadedAssetsForExport(store: ArchiveStore, limit: number): DownloadedAssetRow[] {
  const sql = `select
      url,
      content_type as contentType,
      local_path as localPath
    from assets
    where local_path is not null
    order by url asc`;

  if (limit === 0) {
    return store.db.query<DownloadedAssetRow, []>(sql).all();
  }

  return store.db.query<DownloadedAssetRow, [number]>(`${sql} limit ?`).all(limit);
}

async function exportAsset(asset: DownloadedAssetRow, archiveRoot: string, mirrorRoot: string): Promise<void> {
  const sourcePath = resolveStoredPath(asset.localPath, archiveRoot);
  if (!sourcePath) throw new Error("Stored asset is outside archive");

  const targetPath = mirrorAssetPath(asset.url, mirrorRoot);
  await mkdir(dirname(targetPath), { recursive: true });

  if (isCssAsset(asset.contentType, asset.url)) {
    const css = await readFile(sourcePath, "utf-8");
    await writeFile(targetPath, rewriteCssAssetReferences(css, asset.url, staticMirrorRoute));
    return;
  }

  await copyFile(sourcePath, targetPath);
}

async function exportPage(
  store: ArchiveStore,
  snapshot: SnapshotRow,
  archiveRoot: string,
  mirrorRoot: string
): Promise<void> {
  const sourcePath = resolveStoredPath(snapshot.htmlPath, archiveRoot);
  if (!sourcePath) throw new Error("Stored snapshot is outside archive");

  const html = await readFile(sourcePath, "utf-8");
  const rewritten = await rewriteSnapshotHtml(html, snapshot.url, store.getSnapshotAssets(snapshot.id), {
    assetRoute: staticMirrorRoute,
    missingAssetRoute: staticMirrorRoute,
    missingPageRoute: staticMirrorRoute,
  });
  const targetPath = mirrorPagePath(snapshot.url, mirrorRoot);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, rewritten);
}

export function staticMirrorRoute(url: string): string {
  if (isFitGirlUrl(url)) {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  }

  return `/__external-assets/${sha256Text(url).slice(0, 16)}${routeExtension(url)}`;
}

export function mirrorPagePath(url: string, mirrorRoot: string): string {
  const parsed = new URL(url);
  const segments = safePathSegments(parsed.pathname);
  const targetSegments =
    segments.length === 0 || parsed.pathname.endsWith("/") || !extname(segments.at(-1) ?? "")
      ? [...segments, "index.html"]
      : segments;

  return safeJoin(mirrorRoot, targetSegments);
}

export function mirrorAssetPath(url: string, mirrorRoot: string): string {
  const route = new URL(staticMirrorRoute(url), "https://fitgirl-repacks.site");
  const segments = safePathSegments(route.pathname);
  if (segments.length === 0) throw new Error("Asset URL has no path");

  return safeJoin(mirrorRoot, segments);
}

function safeJoin(root: string, segments: string[]): string {
  const rootPath = resolve(root);
  const targetPath = resolve(rootPath, ...segments);
  if (targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`)) return targetPath;
  throw new Error("Mirror path escaped root");
}

function safePathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map(segment => {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || decoded.includes("\0")) {
        throw new Error(`Unsafe path segment: ${segment}`);
      }
      const safeSegment = decoded.includes("/") ? encodeURIComponent(decoded) : decoded;
      if (safeSegment.length <= MAX_PATH_SEGMENT_LENGTH) return safeSegment;

      // ponytail: long URL segments cannot stay exact on common filesystems; hash keeps the path stable.
      return `${safeSegment.slice(0, MAX_PATH_SEGMENT_LENGTH - 17)}-${sha256Text(safeSegment).slice(0, 16)}`;
    });
}

function routeExtension(url: string): string {
  const extension = extname(basename(new URL(url).pathname)).slice(0, 12);
  return extension || ".bin";
}

function isCssAsset(contentType: string | null, url: string): boolean {
  return contentType?.includes("css") || new URL(url).pathname.endsWith(".css");
}

function resolveStoredPath(storedPath: string, archiveRoot: string): string | null {
  const path = resolve(process.cwd(), storedPath);
  return path === archiveRoot || path.startsWith(`${archiveRoot}${sep}`) ? path : null;
}

function parseOptions(args: string[]): ExportMirrorOptions {
  const archiveDir = readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR);

  return {
    archiveDir,
    assetLimit: readNumberFlag(args, "--assets", 0),
    mirrorDir: readStringFlag(args, "--mirror", join(archiveDir, "mirror")),
    pageLimit: readNumberFlag(args, "--pages", 0),
  };
}

function readStringFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const raw = readStringFlag(args, name, String(fallback));
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a positive integer or 0`);
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

if (import.meta.main) {
  runExportMirror(Bun.argv.slice(2)).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
