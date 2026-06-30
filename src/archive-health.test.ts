import { describe, expect, test } from "bun:test";
import { formatHealthReport, lowestAssetCoverage, pagesWithSelectableMissingAssets } from "./archive-health";
import type { PageListRow } from "./archive-store";

describe("archive health", () => {
  test("ranks pages with weakest asset coverage", () => {
    const pages = [
      page("Ready", 10, 10),
      page("Weak", 1, 10),
      page("Empty", 0, 0),
      page("Worse", 0, 20),
    ];

    expect(lowestAssetCoverage(pages, 2).map(row => row.title)).toEqual(["Worse", "Weak"]);
  });

  test("keeps weak pages actionable", () => {
    const pages = [page("Permanent", 0, 10), page("Actionable", 1, 10)];
    const store = {
      getAssetsToBackfillForPage(url: string) {
        return url.includes("actionable")
          ? [{ kind: "image" as const, source: "img[src]", url: "https://fitgirl-repacks.site/a.jpg" }]
          : [];
      },
    };

    expect(pagesWithSelectableMissingAssets(store, pages).map(row => row.title)).toEqual(["Actionable"]);
  });

  test("formats a compact health report", () => {
    const report = formatHealthReport({
      assetFailures: [{ contentType: null, fetchedAt: null, httpStatus: 404, url: "https://cdn.example/missing.css" }],
      limit: 2,
      pages: [page("Weak", 1, 10)],
      queueFailures: [{ attempts: 2, lastError: "blocked", nextAttemptAt: null, url: "https://fitgirl-repacks.site/fail/" }],
      stats: {
        assets: 10,
        downloadedAssets: 1,
        pages: 1,
        queueDone: 3,
        queueFailed: 1,
        queuePending: 5,
        queueRunning: 0,
        snapshots: 1,
      },
    });

    expect(report).toContain("Assets: 1/10 downloaded (10%), 9 missing");
    expect(report).toContain("Weak");
    expect(report).toContain("Queue: https://fitgirl-repacks.site/fail/ (2 attempts)");
    expect(report).toContain("Assets: https://cdn.example/missing.css (404)");
    expect(report).toContain("assets:backfill -- --css-deps --limit 100");
    expect(report).toContain("assets:backfill -- --latest-pages --rounds 50");
  });
});

function page(title: string, downloadedAssetCount: number, assetCount: number): PageListRow {
  return {
    assetCount,
    downloadedAssetCount,
    fetchedAt: "2026-06-28T00:00:00.000Z",
    metadataJson: "{}",
    snapshotCount: 1,
    snapshotId: 1,
    title,
    url: `https://fitgirl-repacks.site/${title.toLowerCase()}/`,
  };
}
