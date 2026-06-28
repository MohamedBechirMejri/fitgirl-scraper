import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { migrateArchiveSchema } from "./archive-schema";
import type {
  ArchiveRunRow,
  ArchiveSearchFacets,
  ArchiveSearchFilters,
  ArchiveStats,
  AssetBackfillOptions,
  AssetFailureRow,
  AssetResult,
  AssetRow,
  CrawlQueueInput,
  CrawlQueueItem,
  CrawlStatus,
  FacetRow,
  LinkAvailability,
  PageListRow,
  PageNavRow,
  PageNavigation,
  PageState,
  QueueFailureRow,
  RunFinishInput,
  SnapshotAssetRow,
  SnapshotBackfillRow,
  SnapshotExtractionInput,
  SnapshotInput,
  SnapshotRow,
  StoredSnapshot,
} from "./archive-types";
import { emptyPageMetadata, type AssetReference, type PageMetadata } from "./page-extract";

export type * from "./archive-types";

export class ArchiveStore {
  readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    migrateArchiveSchema(this.db);
  }

  getPageState(url: string): PageState | null {
    return this.db
      .query<PageState, [string]>(
        `select
          snapshots.etag,
          pages.last_checked_at as lastCheckedAt,
          pages.latest_snapshot_id as latestSnapshotId,
          snapshots.last_modified as lastModified,
          pages.sitemap_last_modified as sitemapLastModified
        from pages
        left join snapshots on snapshots.id = pages.latest_snapshot_id
        where pages.url = ?
        limit 1`
      )
      .get(url);
  }

  startRun(input: { command: string; kind: string }, now = new Date().toISOString()): number {
    const result = this.db.run(
      `insert into archive_runs (kind, command, status, started_at)
       values (?, ?, 'running', ?)`,
      [input.kind, input.command, now]
    );

    return Number(result.lastInsertRowid);
  }

  finishRun(id: number, input: RunFinishInput, now = new Date().toISOString()): void {
    this.db.run(
      `update archive_runs set
        status = ?,
        finished_at = ?,
        summary_json = ?,
        error = ?
      where id = ?`,
      [
        input.status,
        now,
        input.summary ? JSON.stringify(input.summary) : null,
        input.error ? errorMessage(input.error).slice(0, 1000) : null,
        id,
      ]
    );
  }

  getRecentRuns(limit: number): ArchiveRunRow[] {
    return this.db
      .query<ArchiveRunRow, [number]>(
        `select
          id,
          kind,
          command,
          status,
          started_at as startedAt,
          finished_at as finishedAt,
          summary_json as summaryJson,
          error
        from archive_runs
        order by id desc
        limit ?`
      )
      .all(limit);
  }

  enqueueUrl(input: CrawlQueueInput, now = new Date().toISOString()): void {
    const existing = this.db
      .query<{ sitemapLastModified: string | null; status: CrawlStatus }, [string]>(
        "select sitemap_last_modified as sitemapLastModified, status from crawl_queue where url = ?"
      )
      .get(input.url);

    if (!existing) {
      this.db.run(
        `insert into crawl_queue (
          url, source, status, priority, sitemap_last_modified, discovered_at, updated_at
        ) values (?, ?, 'pending', ?, ?, ?, ?)`,
        [input.url, input.source, input.priority, input.sitemapLastModified, now, now]
      );
      return;
    }

    const sitemapChanged =
      input.sitemapLastModified !== null && input.sitemapLastModified !== existing.sitemapLastModified;
    const status = input.forcePending || sitemapChanged ? "pending" : existing.status;

    this.db.run(
      `update crawl_queue set
        source = ?,
        status = ?,
        priority = max(priority, ?),
        sitemap_last_modified = case when ? = 1 then ? else coalesce(?, sitemap_last_modified) end,
        updated_at = ?
      where url = ?`,
      [
        input.source,
        status,
        input.priority,
        input.forcePending ? 1 : 0,
        input.sitemapLastModified,
        input.sitemapLastModified,
        now,
        input.url,
      ]
    );
  }

  enqueueUrls(inputs: CrawlQueueInput[], now = new Date().toISOString()): void {
    const enqueueAll = this.db.transaction((items: CrawlQueueInput[]) => {
      for (const input of items) {
        this.enqueueUrl(input, now);
      }
    });

    enqueueAll(inputs);
  }

  resetRunningQueue(now = new Date().toISOString()): number {
    // ponytail: one local runner; add process locks if concurrent crawls matter.
    return this.db.run(
      `update crawl_queue set
        status = 'pending',
        updated_at = ?,
        last_error = 'Reset after interrupted run'
      where status = 'running'`,
      [now]
    ).changes;
  }

  pruneDiscoveredQueue(): number {
    return this.db.run("delete from crawl_queue where source = 'page' and status in ('pending', 'failed')").changes;
  }

  claimNextQueueItem(now = new Date().toISOString()): CrawlQueueItem | null {
    const item = this.db
      .query<CrawlQueueItem, [string]>(
        `select
          url,
          source,
          priority,
          sitemap_last_modified as sitemapLastModified,
          status,
          attempts,
          last_error as lastError,
          next_attempt_at as nextAttemptAt
        from crawl_queue
        where status = 'pending' or (status = 'failed' and coalesce(next_attempt_at, '') <= ?)
        order by priority desc, discovered_at asc
        limit 1`
      )
      .get(now);

    if (!item) return null;

    this.db.run(
      `update crawl_queue set
        status = 'running',
        attempts = attempts + 1,
        last_started_at = ?,
        updated_at = ?,
        last_error = null
      where url = ?`,
      [now, now, item.url]
    );

    return { ...item, attempts: item.attempts + 1, status: "running" };
  }

  getQueueItem(url: string): CrawlQueueItem | null {
    return this.db
      .query<CrawlQueueItem, [string]>(
        `select
          url,
          source,
          priority,
          sitemap_last_modified as sitemapLastModified,
          status,
          attempts,
          last_error as lastError,
          next_attempt_at as nextAttemptAt
        from crawl_queue
        where url = ?
        limit 1`
      )
      .get(url);
  }

  completeQueueItem(url: string, now = new Date().toISOString()): void {
    this.db.run(
      `update crawl_queue set
        status = 'done',
        last_finished_at = ?,
        updated_at = ?,
        next_attempt_at = null,
        last_error = null
      where url = ?`,
      [now, now, url]
    );
  }

  failQueueItem(url: string, error: unknown, now = new Date().toISOString(), retryDelayMs = 60_000): void {
    this.db.run(
      `update crawl_queue set
        status = 'failed',
        last_finished_at = ?,
        updated_at = ?,
        next_attempt_at = ?,
        last_error = ?
      where url = ?`,
      [
        now,
        now,
        new Date(Date.parse(now) + retryDelayMs).toISOString(),
        errorMessage(error).slice(0, 1000),
        url,
      ]
    );
  }

  markPageChecked(url: string, checkedAt: string, sitemapLastModified: string | null): void {
    this.db.run(
      `insert into pages (url, first_seen_at, last_checked_at, sitemap_last_modified)
       values (?, ?, ?, ?)
       on conflict(url) do update set
        last_checked_at = excluded.last_checked_at,
        sitemap_last_modified = coalesce(excluded.sitemap_last_modified, pages.sitemap_last_modified)`,
      [url, checkedAt, checkedAt, sitemapLastModified]
    );
  }

  saveSnapshot(input: SnapshotInput): StoredSnapshot {
    this.db.run(
      `insert into pages (url, first_seen_at, last_checked_at, sitemap_last_modified)
       values (?, ?, ?, ?)
       on conflict(url) do update set
        last_checked_at = excluded.last_checked_at,
        sitemap_last_modified = coalesce(excluded.sitemap_last_modified, pages.sitemap_last_modified)`,
      [input.url, input.fetchedAt, input.fetchedAt, input.sitemapLastModified]
    );

    const existing = this.db
      .query<{ id: number }, [string, string]>("select id from snapshots where url = ? and content_hash = ? limit 1")
      .get(input.url, input.contentHash);

    if (existing) {
      this.db.run("update pages set latest_snapshot_id = ? where url = ?", [existing.id, input.url]);
      this.saveSnapshotExtraction(existing.id, {
        metadata: input.metadata,
        textContent: input.textContent,
        title: input.title,
      });
      return { id: existing.id, isNew: false };
    }

    const result = this.db.run(
      `insert into snapshots (
        url, fetched_at, status, content_type, etag, last_modified, content_hash, html_path, title, text_content, metadata_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.url,
        input.fetchedAt,
        input.status,
        input.contentType,
        input.etag,
        input.lastModified,
        input.contentHash,
        input.htmlPath,
        input.title,
        input.textContent,
        metadataJson(input.metadata),
      ]
    );

    const id = Number(result.lastInsertRowid);
    this.db.run("update pages set latest_snapshot_id = ? where url = ?", [id, input.url]);
    this.indexSnapshot(id, input.url, input.title, input.textContent);

    return { id, isNew: true };
  }

  saveSnapshotReferences(snapshotId: number, links: string[], assets: AssetReference[]): void {
    this.db.run("delete from snapshot_links where snapshot_id = ?", [snapshotId]);
    this.db.run("delete from snapshot_assets where snapshot_id = ?", [snapshotId]);

    const saveLink = this.db.prepare("insert or ignore into snapshot_links (snapshot_id, url) values (?, ?)");
    const saveAsset = this.db.prepare(
      `insert or ignore into snapshot_assets (snapshot_id, asset_url, kind, source)
       values (?, ?, ?, ?)`
    );
    const touchAsset = this.db.prepare(
      "insert into assets (url, first_seen_at) values (?, datetime('now')) on conflict(url) do nothing"
    );

    const saveAll = this.db.transaction((storedLinks: string[], storedAssets: AssetReference[]) => {
      for (const link of storedLinks) {
        saveLink.run(snapshotId, link);
      }

      for (const asset of storedAssets) {
        touchAsset.run(asset.url);
        saveAsset.run(snapshotId, asset.url, asset.kind, asset.source);
      }
    });

    saveAll(links, assets);
  }

  getAsset(url: string): AssetRow | null {
    return this.db
      .query<AssetRow, [string]>(
        "select url, content_type as contentType, local_path as localPath from assets where url = ?"
      )
      .get(url);
  }

  getAssetsToBackfill(options: AssetBackfillOptions): AssetReference[] {
    const sql = `select
          assets.url,
          coalesce(min(snapshot_assets.kind), 'other') as kind,
          coalesce(min(snapshot_assets.source), 'backfill') as source
        from assets
        left join snapshot_assets on snapshot_assets.asset_url = assets.url
        where assets.local_path is null
          and (? = 1 or assets.http_status is null)
        group by assets.url
        order by
          case coalesce(min(snapshot_assets.kind), 'other')
            when 'stylesheet' then 0
            when 'image' then 1 when 'icon' then 2 when 'media' then 3
            when 'script' then 4
            else 5
          end,
          assets.first_seen_at asc, assets.url asc`;

    if (options.limit === 0) {
      return this.db.query<AssetReference, [number]>(sql).all(options.includeFailed ? 1 : 0);
    }

    return this.db
      .query<AssetReference, [number, number]>(`${sql} limit ?`)
      .all(options.includeFailed ? 1 : 0, options.limit);
  }

  saveAssetResult(input: AssetResult): void {
    this.db.run(
      `insert into assets (
        url, first_seen_at, last_checked_at, fetched_at, http_status, content_type, content_hash, local_path, size_bytes
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(url) do update set
        last_checked_at = excluded.last_checked_at,
        fetched_at = excluded.fetched_at,
        http_status = excluded.http_status,
        content_type = excluded.content_type,
        content_hash = excluded.content_hash,
        local_path = coalesce(excluded.local_path, assets.local_path),
        size_bytes = excluded.size_bytes`,
      [
        input.url,
        input.fetchedAt,
        input.fetchedAt,
        input.fetchedAt,
        input.httpStatus,
        input.contentType,
        input.contentHash,
        input.localPath,
        input.sizeBytes,
      ]
    );
  }

  getStats(): ArchiveStats {
    const queue = this.getQueueStats();

    return {
      assets: count(this.db, "assets"),
      queueDone: queue.done,
      queueFailed: queue.failed,
      queuePending: queue.pending,
      queueRunning: queue.running,
      downloadedAssets: count(this.db, "assets where local_path is not null"),
      pages: count(this.db, "pages"),
      snapshots: count(this.db, "snapshots"),
    };
  }

  getQueueStats(): Record<CrawlStatus, number> {
    const rows = this.db
      .query<{ status: CrawlStatus; value: number }, []>("select status, count(*) as value from crawl_queue group by status")
      .all();
    const stats: Record<CrawlStatus, number> = { done: 0, failed: 0, pending: 0, running: 0 };

    for (const row of rows) {
      stats[row.status] = row.value;
    }

    return stats;
  }

  getRecentQueueFailures(limit: number): QueueFailureRow[] {
    return this.db
      .query<QueueFailureRow, [number]>(
        `select
          url,
          attempts,
          last_error as lastError,
          next_attempt_at as nextAttemptAt
        from crawl_queue
        where status = 'failed'
        order by updated_at desc
        limit ?`
      )
      .all(limit);
  }

  getRecentAssetFailures(limit: number): AssetFailureRow[] {
    return this.db
      .query<AssetFailureRow, [number]>(
        `select
          url,
          http_status as httpStatus,
          content_type as contentType,
          fetched_at as fetchedAt
        from assets
        where local_path is null and http_status is not null
        order by last_checked_at desc
        limit ?`
      )
      .all(limit);
  }

  getPagesWithSnapshotHistory(limit: number): PageListRow[] {
    return this.db
      .query<PageListRow, [number]>(
        `with history as (
          select url, count(*) as snapshotCount
          from snapshots
          group by url
          having count(*) > 1
        )
        select
          pages.url,
          coalesce(snapshots.title, pages.url) as title,
          snapshots.id as snapshotId,
          snapshots.fetched_at as fetchedAt,
          snapshots.metadata_json as metadataJson,
          history.snapshotCount,
          (select count(*) from snapshot_assets where snapshot_id = snapshots.id) as assetCount,
          (select count(*) from snapshot_assets join assets on assets.url = snapshot_assets.asset_url where snapshot_assets.snapshot_id = snapshots.id and assets.local_path is not null) as downloadedAssetCount
        from history
        join pages on pages.url = history.url
        join snapshots on snapshots.id = pages.latest_snapshot_id
        order by snapshots.fetched_at desc, snapshots.id desc
        limit ?`
      )
      .all(limit);
  }

  searchPages(input: string | ArchiveSearchFilters, limit: number): PageListRow[] {
    const filters = typeof input === "string" ? emptySearchFilters(input) : normalizeSearchFilters(input);

    if (filters.query && !filters.genre && !filters.company && !filters.language) {
      try {
        return this.searchPagesByFts(filters.query, limit);
      } catch {
        return this.searchPagesByLike(filters, limit);
      }
    }

    return this.searchPagesByLike(filters, limit);
  }

  getSearchFacets(limit: number): ArchiveSearchFacets {
    return {
      companies: this.getJsonArrayFacet("$.companies", limit),
      genres: this.getJsonArrayFacet("$.genres", limit),
      languages: this.getLanguageFacets(limit),
    };
  }

  getPageNavigation(url: string): PageNavigation {
    const rows = this.db
      .query<PageNavRow & { positionDelta: number }, [string]>(
        `with ordered as (
          select
            pages.url,
            coalesce(snapshots.title, pages.url) as title,
            snapshots.fetched_at as fetchedAt,
            row_number() over (order by snapshots.fetched_at desc, snapshots.id desc) as position
          from pages
          join snapshots on snapshots.id = pages.latest_snapshot_id
        ),
        current as (
          select position from ordered where url = ?
        )
        select
          ordered.url,
          ordered.title,
          ordered.fetchedAt,
          ordered.position - current.position as positionDelta
        from ordered, current
        where ordered.position in (current.position - 1, current.position + 1)
        order by ordered.position`
      )
      .all(url);

    return {
      next: rows.find(row => row.positionDelta === 1) ?? null,
      previous: rows.find(row => row.positionDelta === -1) ?? null,
    };
  }

  getLinkAvailability(urls: string[]): Map<string, LinkAvailability> {
    const uniqueUrls = [...new Set(urls)];
    const availability = new Map<string, LinkAvailability>();
    if (uniqueUrls.length === 0) return availability;

    for (const url of uniqueUrls) {
      availability.set(url, {
        queueStatus: null,
        saved: false,
        url,
      });
    }

    for (const page of this.db
      .query<{ latestSnapshotId: number | null; url: string }, string[]>(
        `select url, latest_snapshot_id as latestSnapshotId
        from pages
        where url in (${placeholders(uniqueUrls.length)})`
      )
      .all(...uniqueUrls)) {
      availability.set(page.url, {
        ...(availability.get(page.url) ?? { queueStatus: null, url: page.url }),
        saved: Boolean(page?.latestSnapshotId),
      });
    }

    for (const queue of this.db
      .query<{ status: CrawlStatus; url: string }, string[]>(
        `select url, status
        from crawl_queue
        where url in (${placeholders(uniqueUrls.length)})`
      )
      .all(...uniqueUrls)) {
      availability.set(queue.url, {
        ...(availability.get(queue.url) ?? { saved: false, url: queue.url }),
        queueStatus: queue.status,
      });
    }

    return availability;
  }

  private searchPagesByLike(filters: ArchiveSearchFilters, limit: number): PageListRow[] {
    const like = `%${filters.query}%`;

    return this.db
      .query<
        PageListRow,
        [string, string, string, string, string, string, string, string, string, string, string, number]
      >(
        `select
          pages.url,
          coalesce(snapshots.title, pages.url) as title,
          snapshots.id as snapshotId,
          snapshots.fetched_at as fetchedAt,
          coalesce(snapshots.metadata_json, '{}') as metadataJson,
          (select count(*) from snapshots all_snapshots where all_snapshots.url = pages.url) as snapshotCount,
          (select count(*) from snapshot_assets where snapshot_id = snapshots.id) as assetCount,
          (select count(*) from snapshot_assets join assets on assets.url = snapshot_assets.asset_url where snapshot_assets.snapshot_id = snapshots.id and assets.local_path is not null) as downloadedAssetCount
        from pages
        left join snapshots on snapshots.id = pages.latest_snapshot_id
        where (? = '' or pages.url like ? or snapshots.title like ? or snapshots.text_content like ? or snapshots.metadata_json like ?)
          and (? = '' or exists (
            select 1 from json_each(snapshots.metadata_json, '$.genres') genre
            where genre.value = ?
          ))
          and (? = '' or exists (
            select 1 from json_each(snapshots.metadata_json, '$.companies') company
            where company.value = ?
          ))
          and (? = '' or coalesce(json_extract(snapshots.metadata_json, '$.languages'), '') = ?)
        order by snapshots.fetched_at desc, pages.last_checked_at desc
        limit ?`
      )
      .all(
        filters.query,
        like,
        like,
        like,
        like,
        filters.genre,
        filters.genre,
        filters.company,
        filters.company,
        filters.language,
        filters.language,
        limit
      );
  }

  private searchPagesByFts(query: string, limit: number): PageListRow[] {
    const rows = this.db
      .query<PageListRow, [string, number]>(
        `select
          pages.url,
          coalesce(snapshots.title, pages.url) as title,
          snapshots.id as snapshotId,
          snapshots.fetched_at as fetchedAt,
          snapshots.metadata_json as metadataJson,
          (select count(*) from snapshots all_snapshots where all_snapshots.url = pages.url) as snapshotCount,
          (select count(*) from snapshot_assets where snapshot_id = snapshots.id) as assetCount,
          (select count(*) from snapshot_assets join assets on assets.url = snapshot_assets.asset_url where snapshot_assets.snapshot_id = snapshots.id and assets.local_path is not null) as downloadedAssetCount
        from snapshot_search
        join snapshots on snapshots.id = snapshot_search.rowid
        join pages on pages.latest_snapshot_id = snapshots.id
        where snapshot_search match ?
        order by bm25(snapshot_search), snapshots.fetched_at desc
        limit ?`
      )
      .all(toFtsQuery(query), limit);

    return rows.length > 0 ? rows : this.searchPagesByLike(emptySearchFilters(query), limit);
  }

  private getJsonArrayFacet(path: "$.companies" | "$.genres", limit: number): FacetRow[] {
    return this.db
      .query<FacetRow, [number]>(
        `select cast(facet.value as text) as value, count(*) as count
        from pages
        join snapshots on snapshots.id = pages.latest_snapshot_id
        join json_each(snapshots.metadata_json, '${path}') facet
        where cast(facet.value as text) <> ''
        group by facet.value
        order by count(*) desc, value asc
        limit ?`
      )
      .all(limit);
  }

  private getLanguageFacets(limit: number): FacetRow[] {
    return this.db
      .query<FacetRow, [number]>(
        `select cast(json_extract(snapshots.metadata_json, '$.languages') as text) as value, count(*) as count
        from pages
        join snapshots on snapshots.id = pages.latest_snapshot_id
        where json_extract(snapshots.metadata_json, '$.languages') is not null
          and json_extract(snapshots.metadata_json, '$.languages') <> ''
        group by value
        order by count(*) desc, value asc
        limit ?`
      )
      .all(limit);
  }

  getLatestSnapshotForUrl(url: string): SnapshotRow | null {
    return this.db
      .query<SnapshotRow, [string]>(
        `select
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
        where pages.url = ?
        limit 1`
      )
      .get(url);
  }

  getSnapshot(id: number): SnapshotRow | null {
    return this.db
      .query<SnapshotRow, [number]>(
        `select
          id,
          url,
          title,
          fetched_at as fetchedAt,
          status,
          content_type as contentType,
          content_hash as contentHash,
          html_path as htmlPath,
          metadata_json as metadataJson,
          text_content as textContent
        from snapshots
        where id = ?`
      )
      .get(id);
  }

  getSnapshotsForUrl(url: string): SnapshotRow[] {
    return this.db
      .query<SnapshotRow, [string]>(
        `select
          id,
          url,
          title,
          fetched_at as fetchedAt,
          status,
          content_type as contentType,
          content_hash as contentHash,
          html_path as htmlPath,
          metadata_json as metadataJson,
          text_content as textContent
        from snapshots
        where url = ?
        order by id desc`
      )
      .all(url);
  }

  getSnapshotLinks(snapshotId: number): string[] {
    return this.db
      .query<{ url: string }, [number]>("select url from snapshot_links where snapshot_id = ? order by url")
      .all(snapshotId)
      .map(row => row.url);
  }

  getSnapshotsForBackfill(limit: number): SnapshotBackfillRow[] {
    const sql = `select id, url, html_path as htmlPath
      from snapshots
      order by id desc`;

    if (limit === 0) {
      return this.db.query<SnapshotBackfillRow, []>(sql).all();
    }

    return this.db.query<SnapshotBackfillRow, [number]>(`${sql} limit ?`).all(limit);
  }

  saveSnapshotMetadata(snapshotId: number, metadata: PageMetadata): void {
    this.db.run("update snapshots set metadata_json = ? where id = ?", [metadataJson(metadata), snapshotId]);
  }

  saveSnapshotExtraction(snapshotId: number, input: SnapshotExtractionInput): void {
    const row = this.db.query<{ url: string }, [number]>("select url from snapshots where id = ?").get(snapshotId);
    if (!row) return;

    this.db.run("update snapshots set title = ?, text_content = ?, metadata_json = coalesce(?, metadata_json) where id = ?", [
      input.title,
      input.textContent,
      input.metadata ? metadataJson(input.metadata) : null,
      snapshotId,
    ]);
    this.indexSnapshot(snapshotId, row.url, input.title, input.textContent);
  }

  getSnapshotAssets(snapshotId: number): SnapshotAssetRow[] {
    return this.db
      .query<SnapshotAssetRow, [number]>(
        `select
          snapshot_assets.asset_url as url,
          snapshot_assets.kind,
          snapshot_assets.source,
          assets.local_path as localPath,
          assets.content_type as contentType,
          assets.http_status as httpStatus,
          coalesce(assets.size_bytes, 0) as sizeBytes
        from snapshot_assets
        join assets on assets.url = snapshot_assets.asset_url
        where snapshot_assets.snapshot_id = ?
        order by snapshot_assets.kind, snapshot_assets.asset_url`
      )
      .all(snapshotId);
  }

  close(): void {
    this.db.close();
  }

  private indexSnapshot(id: number, url: string, title: string, textContent: string): void {
    this.db.run("insert or replace into snapshot_search(rowid, title, url, body) values (?, ?, ?, ?)", [
      id,
      title,
      url,
      textContent,
    ]);
  }
}

export async function openArchiveStore(dbPath: string): Promise<ArchiveStore> {
  await mkdir(dirname(dbPath), { recursive: true });
  return new ArchiveStore(dbPath);
}

function count(db: Database, from: string): number {
  const row = db.query<{ value: number }, []>(`select count(*) as value from ${from}`).get();
  return row?.value ?? 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function metadataJson(metadata: PageMetadata | undefined): string {
  return JSON.stringify(metadata ?? emptyPageMetadata());
}

function emptySearchFilters(query = ""): ArchiveSearchFilters {
  return { company: "", genre: "", language: "", query: query.trim() };
}

function normalizeSearchFilters(filters: ArchiveSearchFilters): ArchiveSearchFilters {
  return { company: filters.company.trim(), genre: filters.genre.trim(), language: filters.language.trim(), query: filters.query.trim() };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function toFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map(term => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
}
