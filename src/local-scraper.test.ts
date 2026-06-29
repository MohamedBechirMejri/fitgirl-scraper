import { describe, expect, test } from "bun:test";
import {
  discoveredLinksToQueueInputs,
  isCrawlableSitePage,
  readScrapeLimit,
  shouldSeedSitemaps,
  shouldStopRunForStatus,
  wasCheckedRecently,
} from "./local-scraper";

describe("local scraper freshness", () => {
  test("refresh-days controls sitemap unchanged skips", () => {
    expect(wasCheckedRecently("2026-06-01T00:00:00.000Z", "2026-06-15T00:00:00.000Z", 30)).toBe(true);
    expect(wasCheckedRecently("2026-06-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z", 30)).toBe(false);
    expect(wasCheckedRecently("2026-06-01T00:00:00.000Z", "2026-06-01T00:00:01.000Z", 0)).toBe(false);
  });

  test("blocking status codes stop the scrape run", () => {
    expect(shouldStopRunForStatus(403)).toBe(true);
    expect(shouldStopRunForStatus(429)).toBe(true);
    expect(shouldStopRunForStatus(500)).toBe(false);
  });

  test("unlimited runs need an explicit all flag", () => {
    expect(() => readScrapeLimit(["--limit", "0"], null)).toThrow("--limit 0 requires --all");
    expect(readScrapeLimit(["--limit", "0", "--all"], null)).toBe(0);
    expect(readScrapeLimit([], "https://fitgirl-repacks.site/sportal/")).toBe(1);
  });

  test("sitemap seeding skips when the local queue already has work", () => {
    expect(shouldSeedSitemaps(false, { done: 0, failed: 0, pending: 0, running: 0 })).toBe(true);
    expect(shouldSeedSitemaps(false, { done: 0, failed: 0, pending: 10, running: 0 })).toBe(false);
    expect(shouldSeedSitemaps(true, { done: 0, failed: 0, pending: 10, running: 0 })).toBe(true);
  });

  test("discovered crawling keeps same-site pages and drops noisy endpoints", () => {
    const links = [
      "https://fitgirl-repacks.site/category/updates/",
      "https://fitgirl-repacks.site/category/updates/#comments",
      "https://fitgirl-repacks.site/wp-json/wp/v2/posts",
      "https://fitgirl-repacks.site/xmlrpc.php?rsd",
      "https://fitgirl-repacks.site/wp-content/uploads/demo.jpg",
      "https://example.com/offsite/",
    ];

    expect(discoveredLinksToQueueInputs(links, "https://fitgirl-repacks.site/source/", 10)).toEqual([
      {
        priority: 9,
        sitemapLastModified: null,
        source: "page",
        url: "https://fitgirl-repacks.site/category/updates/",
      },
    ]);
  });

  test("crawlable page filter rejects wordpress internals and assets", () => {
    expect(isCrawlableSitePage("https://fitgirl-repacks.site/page/2/")).toBe(true);
    expect(isCrawlableSitePage("https://fitgirl-repacks.site/wp-admin/")).toBe(false);
    expect(isCrawlableSitePage("https://fitgirl-repacks.site/feed/")).toBe(false);
    expect(isCrawlableSitePage("https://fitgirl-repacks.site/wp-content/uploads/demo.webp")).toBe(false);
    expect(isCrawlableSitePage("https://fitgirl-repacks.site/search/?q=demo")).toBe(false);
  });
});
