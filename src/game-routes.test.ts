import { describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { openArchiveStore, type ArchiveStore } from "./archive-store";
import { gameSearchJson } from "./game-routes";
import { emptyPageMetadata, type PageMetadata } from "./page-extract";

// Every saved body carries the site menu and sidebar, so the body below names games that
// the post is not about. Search must go by titles.
const SIDEBAR = "Menu Final Fantasy VII Rebirth Popular Repacks Anno 117";

async function storeWith(posts: { slug: string; title: string; body?: string; metadata: Partial<PageMetadata> }[]) {
  const dir = await mkdtemp(join(tmpdir(), "fitgirl-games-"));
  const store = await openArchiveStore(join(dir, "archive.sqlite"));
  for (const post of posts) {
    const url = `https://fitgirl-repacks.site/${post.slug}/`;
    const htmlPath = join(dir, `${post.slug}.html`);
    await Bun.write(htmlPath, `<div class="entry-content"><p>${post.body ?? ""}</p></div><!-- .entry-content -->`);
    store.saveSnapshot({
      contentHash: url,
      contentType: "text/html",
      etag: null,
      fetchedAt: "2026-09-23T12:00:00.000Z",
      htmlPath,
      lastModified: null,
      metadata: { ...emptyPageMetadata("post"), ...post.metadata },
      sitemapLastModified: null,
      status: 200,
      textContent: `${post.title} ${post.body ?? ""} ${SIDEBAR}`,
      title: `${post.title} - FitGirl Repacks`,
      url,
    });
  }
  return store;
}

async function search(store: ArchiveStore, query: string): Promise<{ name: string; match: string }[]> {
  const response = await gameSearchJson(store, new URLSearchParams({ q: query }));
  const body = (await response.json()) as { results: { name: string; match: string }[] };
  return body.results.map(({ name, match }) => ({ name, match }));
}

describe("game search", () => {
  test("matches titles only, names that start with the query first, then companies", async () => {
    const store = await storeWith([
      {
        slug: "final-fantasy-vii-rebirth",
        title: "FINAL FANTASY VII REBIRTH - Digital Deluxe Edition, v1.005",
        metadata: { publishedAt: "2026-06-05T10:00:00+00:00", repackSize: "130.6 GB", companies: ["Square Enix"] },
      },
      {
        slug: "dissidia-final-fantasy-nt",
        title: "Dissidia Final Fantasy NT - v1.2",
        metadata: { publishedAt: "2026-09-20T10:00:00+00:00", repackSize: "40 GB" },
      },
      {
        slug: "dragon-quest-xi",
        title: "Dragon Quest XI S - v1.0",
        metadata: { publishedAt: "2026-07-01T10:00:00+00:00", repackSize: "20 GB", companies: ["Square Enix"] },
      },
      {
        slug: "final-fantasy-vii-rebirth-repack-updated",
        title: "FINAL FANTASY VII REBIRTH Repack Updated",
        body: "This is just a notice for my subscribers about freshly updated FINAL FANTASY VII REBIRTH repack.",
        metadata: { publishedAt: "2026-09-21T10:00:00+00:00" },
      },
      {
        slug: "anno-117-pax-romana",
        title: "Anno 117: Pax Romana - v1.4.1",
        metadata: { publishedAt: "2026-04-09T10:00:00+00:00", repackSize: "32.7 GB" },
      },
    ]);

    expect(await search(store, "final fant")).toEqual([
      { name: "FINAL FANTASY VII REBIRTH", match: "title" },
      { name: "Dissidia Final Fantasy NT", match: "title" },
    ]);
    // "Anno 117" sits in every body's sidebar; only its own post may match.
    expect(await search(store, "anno")).toEqual([{ name: "Anno 117: Pax Romana", match: "title" }]);
    expect(await search(store, "square enix")).toEqual([
      { name: "Dragon Quest XI S", match: "company" },
      { name: "FINAL FANTASY VII REBIRTH", match: "company" },
    ]);
    expect(await search(store, "rebirth repack updated")).toEqual([]);
    store.close();
  });
});
