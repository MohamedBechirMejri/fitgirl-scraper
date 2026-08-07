import { describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { openArchiveStore } from "./archive-store";
import type { PageMetadata } from "./page-extract";

function metadata(overrides: Partial<PageMetadata>): PageMetadata {
  return {
    companies: [],
    filehosterCount: 0,
    genres: [],
    languages: null,
    magnetCount: 0,
    modifiedAt: null,
    originalSize: null,
    pageType: "post",
    publishedAt: null,
    repackSize: null,
    ...overrides,
  };
}

describe("latestPublishedPosts", () => {
  test("returns posts newest first and skips collections and undated pages", async () => {
    const store = await openArchiveStore(join(await mkdtemp(join(tmpdir(), "fitgirl-store-")), "archive.sqlite"));

    const entries: [string, PageMetadata][] = [
      ["https://fitgirl-repacks.site/older-game/", metadata({ publishedAt: "2026-08-01T10:00:00.000Z", genres: ["RPG"] })],
      ["https://fitgirl-repacks.site/newest-game/", metadata({ publishedAt: "2026-08-07T09:00:00.000Z", repackSize: "2.1 GB" })],
      ["https://fitgirl-repacks.site/all-repacks/", metadata({ pageType: "collection", publishedAt: "2026-08-06T00:00:00.000Z" })],
      ["https://fitgirl-repacks.site/undated/", metadata({})],
    ];

    for (const [url, pageMetadata] of entries) {
      store.saveSnapshot({
        contentHash: url,
        contentType: "text/html",
        etag: null,
        fetchedAt: "2026-08-07T12:00:00.000Z",
        htmlPath: "archive/pages/demo.html",
        lastModified: null,
        metadata: pageMetadata,
        sitemapLastModified: null,
        status: 200,
        textContent: url,
        title: url,
        url,
      });
    }

    const posts = store.latestPublishedPosts(10);

    expect(posts.map((post) => post.url)).toEqual([
      "https://fitgirl-repacks.site/newest-game/",
      "https://fitgirl-repacks.site/older-game/",
    ]);

    expect(store.latestPublishedPosts(1).map((post) => post.url)).toEqual([
      "https://fitgirl-repacks.site/newest-game/",
    ]);

    store.close();
  });
});
