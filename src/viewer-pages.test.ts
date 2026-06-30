import { describe, expect, test } from "bun:test";
import { mirrorPageHref, renderPageOpenLink } from "./viewer-pages";

describe("viewer pages", () => {
  test("opens archive rows as mirrored site pages", () => {
    expect(mirrorPageHref("https://fitgirl-repacks.site/victoria-3/")).toBe("/victoria-3/");
    expect(mirrorPageHref("https://fitgirl-repacks.site/?s=test")).toBe("/?s=test");
    expect(mirrorPageHref("https://example.test/page/")).toBe(
      "/page?url=https%3A%2F%2Fexample.test%2Fpage%2F"
    );
  });

  test("keeps details available from page rows", () => {
    expect(
      renderPageOpenLink({
        assetCount: 1,
        downloadedAssetCount: 1,
        fetchedAt: "2026-06-30",
        metadataJson: "{}",
        snapshotCount: 1,
        snapshotId: 7,
        snippet: null,
        title: "Victoria 3",
        url: "https://fitgirl-repacks.site/victoria-3/",
      })
    ).toBe('<small><a href="/page?url=https%3A%2F%2Ffitgirl-repacks.site%2Fvictoria-3%2F">Details</a></small>');
  });
});
