import type { AssetKind, PageMetadata } from "./page-extract";

export interface PageState {
  etag: string | null;
  lastCheckedAt: string | null;
  latestSnapshotId: number | null;
  lastModified: string | null;
  sitemapLastModified: string | null;
}

export interface SnapshotInput {
  contentHash: string;
  contentType: string | null;
  etag: string | null;
  fetchedAt: string;
  htmlPath: string;
  lastModified: string | null;
  metadata?: PageMetadata;
  sitemapLastModified: string | null;
  status: number;
  textContent: string;
  title: string;
  url: string;
}

export interface StoredSnapshot {
  id: number;
  isNew: boolean;
}

export interface AssetRow {
  contentType: string | null;
  localPath: string | null;
  url: string;
}

export interface AssetResult {
  contentHash: string | null;
  contentType: string | null;
  fetchedAt: string;
  httpStatus: number;
  localPath: string | null;
  sizeBytes: number;
  url: string;
}

export interface ArchiveStats {
  assets: number;
  queueDone: number;
  queueFailed: number;
  queuePending: number;
  queueRunning: number;
  downloadedAssets: number;
  pages: number;
  snapshots: number;
}

export type ArchiveRunStatus = "running" | "success" | "failed";

export interface ArchiveRunRow {
  command: string;
  error: string | null;
  finishedAt: string | null;
  id: number;
  kind: string;
  startedAt: string;
  status: ArchiveRunStatus;
  summaryJson: string | null;
}

export type CrawlStatus = "pending" | "running" | "done" | "failed";

export interface CrawlQueueInput {
  forcePending?: boolean;
  priority: number;
  sitemapLastModified: string | null;
  source: string;
  url: string;
}

export interface CrawlQueueItem extends CrawlQueueInput {
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  status: CrawlStatus;
}

export interface PageListRow {
  assetCount: number;
  downloadedAssetCount: number;
  fetchedAt: string | null;
  metadataJson: string;
  snapshotCount: number;
  snapshotId: number | null;
  title: string;
  url: string;
}

export interface PageNavRow {
  fetchedAt: string | null;
  title: string;
  url: string;
}

export interface PageNavigation {
  next: PageNavRow | null;
  previous: PageNavRow | null;
}

export interface LinkAvailability {
  latestSnapshotId: number | null;
  queueStatus: CrawlStatus | null;
  saved: boolean;
  url: string;
}

export interface ArchiveSearchFilters {
  company: string;
  genre: string;
  language: string;
  query: string;
}

export interface FacetRow {
  count: number;
  value: string;
}

export interface ArchiveSearchFacets {
  companies: FacetRow[];
  genres: FacetRow[];
  languages: FacetRow[];
}

export interface SnapshotRow {
  contentHash: string;
  contentType: string | null;
  fetchedAt: string;
  htmlPath: string;
  id: number;
  metadataJson: string;
  status: number;
  textContent: string;
  title: string;
  url: string;
}

export interface SnapshotBackfillRow {
  htmlPath: string;
  id: number;
  url: string;
}

export interface SnapshotExtractionInput {
  metadata?: PageMetadata;
  textContent: string;
  title: string;
}

export interface SnapshotAssetRow {
  contentType: string | null;
  httpStatus: number | null;
  kind: AssetKind;
  localPath: string | null;
  sizeBytes: number;
  source: string;
  url: string;
}

export interface AssetFailureRow {
  contentType: string | null;
  fetchedAt: string | null;
  httpStatus: number | null;
  url: string;
}

export interface AssetBackfillOptions {
  includeFailed: boolean;
  limit: number;
}

export interface QueueFailureRow {
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  url: string;
}

export interface RunFinishInput {
  error?: unknown;
  status: Exclude<ArchiveRunStatus, "running">;
  summary?: Record<string, unknown>;
}
