import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { openArchiveStore } from "./archive-store";

describe("archive store queue", () => {
  test("claims, completes, and requeues changed sitemap entries", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({
      priority: 1,
      sitemapLastModified: "2026-06-27",
      source: "sitemap",
      url: "https://fitgirl-repacks.site/demo/",
    });

    const first = store.claimNextQueueItem("2026-06-28T00:00:00.000Z");
    expect(first?.url).toBe("https://fitgirl-repacks.site/demo/");
    store.completeQueueItem(first!.url, "2026-06-28T00:00:01.000Z");
    expect(store.getQueueStats().done).toBe(1);

    store.enqueueUrl({
      priority: 2,
      sitemapLastModified: "2026-06-28",
      source: "sitemap",
      url: "https://fitgirl-repacks.site/demo/",
    });

    const changed = store.claimNextQueueItem("2026-06-28T00:00:02.000Z");
    expect(changed?.url).toBe("https://fitgirl-repacks.site/demo/");

    store.close();
  });

  test("can force an existing done queue item back to pending", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({
      priority: 1,
      sitemapLastModified: "2026-06-28",
      source: "sitemap",
      url: "https://fitgirl-repacks.site/manual/",
    });
    store.completeQueueItem("https://fitgirl-repacks.site/manual/");
    store.enqueueUrl({
      forcePending: true,
      priority: 2,
      sitemapLastModified: null,
      source: "manual",
      url: "https://fitgirl-repacks.site/manual/",
    });

    const item = store.claimNextQueueItem();
    expect(item?.url).toBe("https://fitgirl-repacks.site/manual/");
    expect(item?.sitemapLastModified).toBeNull();

    store.close();
  });

  test("queues stale saved pages for refresh", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    for (const [url, fetchedAt] of [
      ["https://fitgirl-repacks.site/old/", "2026-05-01T00:00:00.000Z"],
      ["https://fitgirl-repacks.site/recent/", "2026-06-27T00:00:00.000Z"],
    ] as const) {
      store.saveSnapshot({
        contentHash: url,
        contentType: "text/html",
        etag: null,
        fetchedAt,
        htmlPath: "archive/pages/demo.html",
        lastModified: null,
        sitemapLastModified: null,
        status: 200,
        textContent: url,
        title: url,
        url,
      });
    }

    expect(store.enqueueStalePagesForRefresh(30, 10, "2026-06-28T00:00:00.000Z")).toBe(1);

    const item = store.claimNextQueueItem("2026-06-28T00:00:01.000Z");
    expect(item).toMatchObject({
      source: "refresh",
      url: "https://fitgirl-repacks.site/old/",
    });
    expect(store.claimNextQueueItem("2026-06-28T00:00:02.000Z")).toBeNull();

    store.close();
  });

  test("failed items wait for retry time", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({
      priority: 1,
      sitemapLastModified: null,
      source: "page",
      url: "https://fitgirl-repacks.site/retry/",
    });

    const item = store.claimNextQueueItem("2026-06-28T00:00:00.000Z");
    store.failQueueItem(item!.url, new Error("blocked"), "2026-06-28T00:00:01.000Z", 60_000);

    expect(store.claimNextQueueItem("2026-06-28T00:00:30.000Z")).toBeNull();
    expect(store.claimNextQueueItem("2026-06-28T00:01:02.000Z")?.url).toBe("https://fitgirl-repacks.site/retry/");

    store.close();
  });

  test("prunes only pending discovered queue noise", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({ priority: 1, sitemapLastModified: null, source: "page", url: "https://fitgirl-repacks.site/page-pending/" });
    store.enqueueUrl({ priority: 1, sitemapLastModified: null, source: "page", url: "https://fitgirl-repacks.site/page-done/" });
    store.enqueueUrl({ priority: 1, sitemapLastModified: null, source: "manual", url: "https://fitgirl-repacks.site/manual/" });
    store.enqueueUrl({ priority: 1, sitemapLastModified: "2026-06-28", source: "sitemap", url: "https://fitgirl-repacks.site/sitemap/" });

    store.completeQueueItem("https://fitgirl-repacks.site/page-done/");
    expect(store.pruneDiscoveredQueue()).toBe(1);
    expect(store.getQueueItem("https://fitgirl-repacks.site/page-pending/")).toBeNull();
    expect(store.getQueueItem("https://fitgirl-repacks.site/page-done/")?.status).toBe("done");
    expect(store.getQueueItem("https://fitgirl-repacks.site/manual/")?.status).toBe("pending");
    expect(store.getQueueItem("https://fitgirl-repacks.site/sitemap/")?.status).toBe("pending");

    store.close();
  });

  test("searches snapshot body text", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/demo.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "The rare exact phrase is searchable.",
      title: "Demo",
      url: "https://fitgirl-repacks.site/demo/",
    });

    const result = store.searchPages("rare searchable", 10)[0];
    expect(result?.url).toBe("https://fitgirl-repacks.site/demo/");
    expect(result?.snippet).toContain("rare exact phrase");
    expect(store.getPageState("https://fitgirl-repacks.site/demo/")?.lastCheckedAt).toBe("2026-06-28T00:00:00.000Z");

    store.close();
  });

  test("stores snapshot metadata", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/demo.html",
      lastModified: null,
      metadata: {
        companies: ["Studio"],
        filehosterCount: 3,
        genres: ["Action"],
        languages: "ENG",
        magnetCount: 2,
        modifiedAt: "2026-06-27T00:00:01.000Z",
        originalSize: "2 GB",
        pageType: "post",
        publishedAt: "2026-06-27T00:00:00.000Z",
        repackSize: "1 GB",
      },
      sitemapLastModified: null,
      status: 200,
      textContent: "Demo",
      title: "Demo",
      url: "https://fitgirl-repacks.site/demo/",
    });

    const latest = store.getLatestSnapshotForUrl("https://fitgirl-repacks.site/demo/");
    expect(JSON.parse(latest?.metadataJson ?? "{}").genres).toEqual(["Action"]);

    expect(store.getSnapshotsForBackfill(10)[0]?.id).toBe(latest!.id);
    store.saveSnapshotMetadata(latest!.id, {
      companies: [],
      filehosterCount: 0,
      genres: ["Shooter"],
      languages: null,
      magnetCount: 0,
      modifiedAt: null,
      originalSize: null,
      pageType: "post",
      publishedAt: null,
      repackSize: null,
    });
    expect(JSON.parse(store.getLatestSnapshotForUrl("https://fitgirl-repacks.site/demo/")!.metadataJson).genres).toEqual([
      "Shooter",
    ]);
    store.saveSnapshotExtraction(latest!.id, {
      metadata: {
        companies: ["Better Studio"],
        filehosterCount: 1,
        genres: ["Adventure"],
        languages: "ENG",
        magnetCount: 1,
        modifiedAt: null,
        originalSize: null,
        pageType: "post",
        publishedAt: null,
        repackSize: null,
      },
      textContent: "Fresh searchable body.",
      title: "Clean Title",
    });
    expect(store.getLatestSnapshotForUrl("https://fitgirl-repacks.site/demo/")?.title).toBe("Clean Title");
    expect(store.searchPages("fresh", 10)[0]?.title).toBe("Clean Title");
    store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:01.000Z",
      htmlPath: "archive/pages/demo.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Demo",
      title: "Demo",
      url: "https://fitgirl-repacks.site/demo/",
    });
    expect(JSON.parse(store.getLatestSnapshotForUrl("https://fitgirl-repacks.site/demo/")!.metadataJson).genres).toEqual([
      "Adventure",
    ]);

    store.close();
  });

  test("filters search by snapshot metadata facets", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/action.html",
      lastModified: null,
      metadata: {
        companies: ["Studio A"],
        filehosterCount: 1,
        genres: ["Action", "Shooter"],
        languages: "ENG",
        magnetCount: 1,
        modifiedAt: null,
        originalSize: "2 GB",
        pageType: "post",
        publishedAt: null,
        repackSize: "1 GB",
      },
      sitemapLastModified: null,
      status: 200,
      textContent: "Fast arena combat.",
      title: "Action Demo",
      url: "https://fitgirl-repacks.site/action-demo/",
    });
    store.saveSnapshot({
      contentHash: "def",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:01:00.000Z",
      htmlPath: "archive/pages/puzzle.html",
      lastModified: null,
      metadata: {
        companies: ["Studio B"],
        filehosterCount: 1,
        genres: ["Puzzle"],
        languages: "RUS/ENG",
        magnetCount: 0,
        modifiedAt: null,
        originalSize: "3 GB",
        pageType: "post",
        publishedAt: null,
        repackSize: "2 GB",
      },
      sitemapLastModified: null,
      status: 200,
      textContent: "Quiet puzzle rooms.",
      title: "Puzzle Demo",
      url: "https://fitgirl-repacks.site/puzzle-demo/",
    });

    expect(
      store.searchPages({ company: "", genre: "Action", language: "ENG", query: "" }, 10).map(row => row.url)
    ).toEqual(["https://fitgirl-repacks.site/action-demo/"]);
    expect(store.searchPages({ company: "Studio B", genre: "", language: "", query: "quiet" }, 10)[0]?.title).toBe(
      "Puzzle Demo"
    );

    const facets = store.getSearchFacets(10);
    expect(facets.genres.map(row => row.value)).toContain("Action");
    expect(facets.companies.map(row => row.value)).toContain("Studio B");
    expect(facets.languages.map(row => row.value)).toContain("ENG");

    store.close();
  });

  test("gets page navigation by latest fetch order", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    for (const [url, title, fetchedAt] of [
      ["https://fitgirl-repacks.site/newest/", "Newest", "2026-06-28T00:02:00.000Z"],
      ["https://fitgirl-repacks.site/middle/", "Middle", "2026-06-28T00:01:00.000Z"],
      ["https://fitgirl-repacks.site/oldest/", "Oldest", "2026-06-28T00:00:00.000Z"],
    ] as const) {
      store.saveSnapshot({
        contentHash: url,
        contentType: "text/html",
        etag: null,
        fetchedAt,
        htmlPath: "archive/pages/demo.html",
        lastModified: null,
        sitemapLastModified: null,
        status: 200,
        textContent: title,
        title,
        url,
      });
    }

    const middle = store.getPageNavigation("https://fitgirl-repacks.site/middle/");
    expect(middle.previous?.title).toBe("Newest");
    expect(middle.next?.title).toBe("Oldest");
    expect(store.getPageNavigation("https://fitgirl-repacks.site/newest/").previous).toBeNull();
    expect(store.getPageNavigation("https://fitgirl-repacks.site/oldest/").next).toBeNull();

    store.close();
  });

  test("lists pages with multiple snapshots", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.saveSnapshot({
      contentHash: "first",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/demo-first.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Before update",
      title: "Before",
      url: "https://fitgirl-repacks.site/demo/",
    });
    store.saveSnapshot({
      contentHash: "second",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:01:00.000Z",
      htmlPath: "archive/pages/demo-second.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "After update",
      title: "After",
      url: "https://fitgirl-repacks.site/demo/",
    });
    store.saveSnapshot({
      contentHash: "single",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:02:00.000Z",
      htmlPath: "archive/pages/single.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Single",
      title: "Single",
      url: "https://fitgirl-repacks.site/single/",
    });

    expect(store.getSnapshotsForUrl("https://fitgirl-repacks.site/demo/").map(snapshot => snapshot.title)).toEqual([
      "After",
      "Before",
    ]);
    expect(store.getPagesWithSnapshotHistory(10)).toMatchObject([
      {
        snapshotCount: 2,
        title: "After",
        url: "https://fitgirl-repacks.site/demo/",
      },
    ]);

    store.close();
  });

  test("gets internal link availability", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/demo.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Saved",
      title: "Saved",
      url: "https://fitgirl-repacks.site/saved/",
    });
    store.enqueueUrl({
      priority: 1,
      sitemapLastModified: null,
      source: "sitemap",
      url: "https://fitgirl-repacks.site/queued/",
    });

    const availability = store.getLinkAvailability([
      "https://fitgirl-repacks.site/saved/",
      "https://fitgirl-repacks.site/queued/",
      "https://fitgirl-repacks.site/missing/",
    ]);

    const saved = store.getLatestSnapshotForUrl("https://fitgirl-repacks.site/saved/");

    expect(store.getLinkAvailability([]).size).toBe(0);
    expect(availability.get("https://fitgirl-repacks.site/saved/")).toMatchObject({
      latestSnapshotId: saved?.id,
      saved: true,
    });
    expect(availability.get("https://fitgirl-repacks.site/queued/")).toMatchObject({
      latestSnapshotId: null,
      queueStatus: "pending",
      saved: false,
    });
    expect(availability.get("https://fitgirl-repacks.site/missing/")).toMatchObject({
      latestSnapshotId: null,
      queueStatus: null,
      saved: false,
    });

    store.close();
  });

  test("selects missing assets for backfill", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));
    const snapshot = store.saveSnapshot({
      contentHash: "abc",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/demo.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Demo",
      title: "Demo",
      url: "https://fitgirl-repacks.site/demo/",
    });

    store.saveSnapshotReferences(snapshot.id, [], [
      { kind: "image", source: "img[src]", url: "https://fitgirl-repacks.site/cover.jpg" },
      { kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/style.css" },
      { kind: "script", source: "script[src]", url: "https://fitgirl-repacks.site/app.js" },
      { kind: "image", source: "style[attr]:css-url", url: "https://fitgirl-repacks.site/hero.webp" },
    ]);
    store.saveAssetResult({
      contentHash: null,
      contentType: null,
      fetchedAt: "2026-06-28T00:00:01.000Z",
      httpStatus: 404,
      localPath: null,
      sizeBytes: 0,
      url: "https://fitgirl-repacks.site/cover.jpg",
    });

    expect(store.getAssetsToBackfill({ includeFailed: false, limit: 10 })).toEqual([
      { kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/style.css" },
      { kind: "image", source: "style[attr]:css-url", url: "https://fitgirl-repacks.site/hero.webp" },
      { kind: "script", source: "script[src]", url: "https://fitgirl-repacks.site/app.js" },
    ]);
    expect(store.getAssetsToBackfill({ includeFailed: true, limit: 10 }).map(asset => asset.url)).toEqual([
      "https://fitgirl-repacks.site/style.css",
      "https://fitgirl-repacks.site/cover.jpg",
      "https://fitgirl-repacks.site/hero.webp",
      "https://fitgirl-repacks.site/app.js",
    ]);
    expect(store.searchPages("demo", 10)[0]).toMatchObject({ assetCount: 4, downloadedAssetCount: 0 });

    store.close();
  });

  test("selects missing assets for one page", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));
    const target = store.saveSnapshot({
      contentHash: "target",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:00.000Z",
      htmlPath: "archive/pages/target.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Target",
      title: "Target",
      url: "https://fitgirl-repacks.site/target/",
    });
    const other = store.saveSnapshot({
      contentHash: "other",
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-06-28T00:00:01.000Z",
      htmlPath: "archive/pages/other.html",
      lastModified: null,
      sitemapLastModified: null,
      status: 200,
      textContent: "Other",
      title: "Other",
      url: "https://fitgirl-repacks.site/other/",
    });

    store.saveSnapshotReferences(target.id, [], [
      { kind: "image", source: "img[src]", url: "https://fitgirl-repacks.site/target-cover.jpg" },
      { kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/target-style.css" },
    ]);
    store.saveSnapshotReferences(other.id, [], [
      { kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/other-style.css" },
    ]);
    store.saveAssetResult({
      contentHash: null,
      contentType: null,
      fetchedAt: "2026-06-28T00:00:02.000Z",
      httpStatus: 404,
      localPath: null,
      sizeBytes: 0,
      url: "https://fitgirl-repacks.site/target-cover.jpg",
    });

    expect(store.getAssetsToBackfillForPage("https://fitgirl-repacks.site/target/", { includeFailed: false, limit: 10 })).toEqual([
      { kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/target-style.css" },
    ]);
    expect(
      store.getAssetsToBackfillForPage("https://fitgirl-repacks.site/target/", { includeFailed: true, limit: 1 })
    ).toEqual([{ kind: "stylesheet", source: "link[href]", url: "https://fitgirl-repacks.site/target-style.css" }]);
    expect(
      store.getAssetsToBackfillForPage("https://fitgirl-repacks.site/target/", { includeFailed: true, limit: 10 }).map(
        asset => asset.url
      )
    ).toEqual(["https://fitgirl-repacks.site/target-style.css", "https://fitgirl-repacks.site/target-cover.jpg"]);

    store.close();
  });

  test("lists recent queue and asset failures", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({
      priority: 1,
      sitemapLastModified: null,
      source: "page",
      url: "https://fitgirl-repacks.site/fail/",
    });
    const queueItem = store.claimNextQueueItem("2026-06-28T00:00:00.000Z");
    store.failQueueItem(queueItem!.url, new Error("blocked"), "2026-06-28T00:00:01.000Z", 60_000);
    store.saveAssetResult({
      contentHash: null,
      contentType: "text/css",
      fetchedAt: "2026-06-28T00:00:02.000Z",
      httpStatus: 404,
      localPath: null,
      sizeBytes: 0,
      url: "https://fitgirl-repacks.site/missing.css",
    });

    expect(store.getRecentQueueFailures(5)[0]?.lastError).toBe("blocked");
    expect(store.getRecentAssetFailures(5)[0]?.url).toBe("https://fitgirl-repacks.site/missing.css");

    store.close();
  });

  test("migrates old asset status column to http status", async () => {
    const dbPath = join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite");
    const db = new Database(dbPath);
    db.run(`
      create table assets (
        url text primary key,
        first_seen_at text not null,
        last_checked_at text,
        fetched_at text,
        status integer,
        content_type text,
        content_hash text,
        local_path text,
        size_bytes integer default 0
      )
    `);
    db.run(
      `insert into assets (url, first_seen_at, last_checked_at, fetched_at, status, content_type)
       values (?, ?, ?, ?, ?, ?)`,
      [
        "https://fitgirl-repacks.site/missing.css",
        "2026-06-28T00:00:00.000Z",
        "2026-06-28T00:00:02.000Z",
        "2026-06-28T00:00:02.000Z",
        404,
        "text/css",
      ]
    );
    db.close();

    const store = await openArchiveStore(dbPath);
    expect(store.getRecentAssetFailures(5)[0]?.httpStatus).toBe(404);

    store.close();
  });

  test("records archive runs", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));
    const runId = store.startRun(
      {
        command: "bun run scrape:local -- --limit 1",
        kind: "scrape",
      },
      "2026-06-28T00:00:00.000Z"
    );

    store.finishRun(
      runId,
      {
        status: "success",
        summary: { processedCount: 1 },
      },
      "2026-06-28T00:00:01.000Z"
    );

    const run = store.getRecentRuns(5)[0];
    expect(run?.kind).toBe("scrape");
    expect(run?.status).toBe("success");
    expect(run?.summaryJson).toBe('{"processedCount":1}');

    store.close();
  });

  test("gets a queued URL by exact URL", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    store.enqueueUrl({
      priority: 10,
      sitemapLastModified: null,
      source: "manual",
      url: "https://fitgirl-repacks.site/manual/",
    });

    expect(store.getQueueItem("https://fitgirl-repacks.site/manual/")?.source).toBe("manual");
    expect(store.getQueueItem("https://fitgirl-repacks.site/missing/")).toBeNull();

    store.close();
  });
});
