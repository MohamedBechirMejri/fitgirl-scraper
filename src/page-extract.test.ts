import { describe, expect, test } from "bun:test";
import { extractCssAssetReferences, rewriteCssAssetReferences } from "./css-assets";
import {
  extractPageReferences,
  extractSitemapEntries,
  extractSitemapUrls,
  normalizePageLink,
  normalizeUrl,
} from "./page-extract";
import { rewriteSnapshotHtml } from "./snapshot-rewrite";

describe("page extraction", () => {
  test("normalizes crawlable URLs", () => {
    expect(normalizeUrl("/post/#comments", "https://fitgirl-repacks.site/root/")).toBe(
      "https://fitgirl-repacks.site/post/"
    );
    expect(normalizeUrl("mailto:test@example.com", "https://fitgirl-repacks.site/")).toBeNull();
    expect(normalizePageLink("magnet:?xt=urn:btih:123", "https://fitgirl-repacks.site/")).toBe(
      "magnet:?xt=urn:btih:123"
    );
    expect(normalizePageLink("magnet:?xt=urn:btih:123&#038;dn=Demo", "https://fitgirl-repacks.site/")).toBe(
      "magnet:?xt=urn:btih:123&dn=Demo"
    );
  });

  test("extracts sitemap loc entries", () => {
    const xml =
      "<urlset><url><loc>https://fitgirl-repacks.site/a/?x=1&amp;y=2</loc><lastmod>2026-06-28</lastmod></url></urlset>";
    expect(extractSitemapUrls(xml, "https://fitgirl-repacks.site/")).toEqual([
      "https://fitgirl-repacks.site/a/?x=1&y=2",
    ]);
    expect(extractSitemapEntries(xml, "https://fitgirl-repacks.site/")[0]).toEqual({
      lastModified: "2026-06-28",
      url: "https://fitgirl-repacks.site/a/?x=1&y=2",
    });
  });

  test("extracts page links and assets", async () => {
    const refs = await extractPageReferences(
      `
        <html>
          <head>
            <title> Aerial_Knight&#039;s DropShot </title>
            <link rel="stylesheet" href="/style.css">
            <link rel="preload" as="image" href="/preload.jpg">
            <link rel="EditURI" href="/xmlrpc.php?rsd">
            <link rel="canonical" href="/post/">
            <meta property="og:image" content="/og.jpg">
            <style>.hero { background: url("/hero.webp"); }</style>
          </head>
          <body>
            <a href="/game/#comments">Game</a>
            <a href="magnet:?xt=urn:btih:123">Magnet</a>
            <div style="background-image: url('/inline.png')"></div>
            <img src="/cover.jpg" srcset="/small.jpg 1x, /big.jpg 2x">
            <video poster="/poster.jpg"></video>
            <iframe src="https://www.youtube.com/embed/demo"></iframe>
            <script src="/app.js"></script>
          </body>
        </html>
      `,
      "https://fitgirl-repacks.site/post/"
    );

    expect(refs.title).toBe("Aerial_Knight's DropShot");
    expect(refs.textContent).toContain("Game");
    expect(refs.links).toEqual(["https://fitgirl-repacks.site/game/", "magnet:?xt=urn:btih:123"]);
    expect(refs.assets.map(asset => asset.url)).toEqual([
      "https://fitgirl-repacks.site/app.js",
      "https://fitgirl-repacks.site/big.jpg",
      "https://fitgirl-repacks.site/cover.jpg",
      "https://fitgirl-repacks.site/hero.webp",
      "https://fitgirl-repacks.site/inline.png",
      "https://fitgirl-repacks.site/og.jpg",
      "https://fitgirl-repacks.site/poster.jpg",
      "https://fitgirl-repacks.site/preload.jpg",
      "https://fitgirl-repacks.site/small.jpg",
      "https://fitgirl-repacks.site/style.css",
      "https://www.youtube.com/embed/demo",
    ]);
  });

  test("extracts single post metadata without treating index pages as posts", async () => {
    const post = await extractPageReferences(
      `
        <html>
          <head>
            <script type="application/ld+json">{"datePublished":"2026-06-27T19:38:44+00:00","dateModified":"2026-06-27T19:38:45+00:00"}</script>
          </head>
          <body class="single single-post">
            <p>
              Genres/Tags: Action, Shooter<br>
              Companies: Sleepwalking Potatoes, Retrovibe Games<br>
              Languages: RUS/ENG/MULTI9<br>
              Original Size: 2.2 GB<br>
              Repack Size: 1.5 GB
            </p>
            <h3>Download Mirrors (Direct Links)</h3>
            <li>Filehoster: DataNodes</li>
            <a href="magnet:?xt=urn:btih:123">magnet</a>
          </body>
        </html>
      `,
      "https://fitgirl-repacks.site/sportal/"
    );

    expect(post.metadata).toMatchObject({
      companies: ["Sleepwalking Potatoes", "Retrovibe Games"],
      filehosterCount: 1,
      genres: ["Action", "Shooter"],
      languages: "RUS/ENG/MULTI9",
      magnetCount: 1,
      modifiedAt: "2026-06-27T19:38:45+00:00",
      originalSize: "2.2 GB",
      pageType: "post",
      publishedAt: "2026-06-27T19:38:44+00:00",
      repackSize: "1.5 GB",
    });

    const index = await extractPageReferences(
      `<body class="home blog"><p>Genres/Tags: Wrong, Metadata</p></body>`,
      "https://fitgirl-repacks.site/"
    );
    expect(index.metadata.pageType).toBe("collection");
    expect(index.metadata.genres).toEqual([]);
  });

  test("extracts singular company labels without bleeding into genres", async () => {
    const post = await extractPageReferences(
      `
        <body class="single single-post">
          <p>
            Genres/Tags: Action, Science fiction<br>
            Company: Fire &#038; Frost<br>
            Languages: ENG<br>
            Original Size: 1 GB<br>
            Repack Size: 500 MB
          </p>
        </body>
      `,
      "https://fitgirl-repacks.site/company-demo/"
    );

    expect(post.metadata.genres).toEqual(["Action", "Science fiction"]);
    expect(post.metadata.companies).toEqual(["Fire & Frost"]);
  });

  test("rewrites saved pages to local routes", async () => {
    const html = await rewriteSnapshotHtml(
      `<a href="/game/">Game</a><a href="/queued/">Queued</a><link rel="canonical" href="/post/"><img src="/cover.jpg" srcset="/small.jpg 1x, /big.jpg 2x"><iframe src="https://www.youtube.com/embed/demo"></iframe><div style="background:url('/bg.png')"></div><style>.hero{background:url("/hero.webp")}</style>`,
      "https://fitgirl-repacks.site/post/",
      [
        { kind: "image", localPath: "archive/assets/cover.jpg", url: "https://fitgirl-repacks.site/cover.jpg" },
        { kind: "image", localPath: "archive/assets/bg.png", url: "https://fitgirl-repacks.site/bg.png" },
        { kind: "image", localPath: null, url: "https://fitgirl-repacks.site/big.jpg" },
        { kind: "image", localPath: null, url: "https://fitgirl-repacks.site/hero.webp" },
        { kind: "image", localPath: null, url: "https://fitgirl-repacks.site/small.jpg" },
        { kind: "media", localPath: null, url: "https://www.youtube.com/embed/demo" },
        { kind: "other", localPath: null, url: "https://fitgirl-repacks.site/post/" },
      ],
      new Map([["https://fitgirl-repacks.site/game/", "/snapshot/7"]])
    );

    expect(html).toContain('href="/snapshot/7"');
    expect(html).toContain('href="/page?url=https%3A%2F%2Ffitgirl-repacks.site%2Fqueued%2F"');
    expect(html).toContain('rel="canonical" href="/post/"');
    expect(html).toContain('src="/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fcover.jpg"');
    expect(html).toContain(
      'srcset="/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fsmall.jpg 1x, /asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fbig.jpg 2x"'
    );
    expect(html).toContain('src="/asset?url=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fdemo"');
    expect(html).toContain('style="background:url(&quot;/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fbg.png&quot;)"');
    expect(html).toContain('background:url("/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fhero.webp")');
  });

  test("extracts and rewrites CSS asset references", () => {
    const css = `@import "/theme.css"; body { background: url("../img/bg.png"); }`;
    const references = extractCssAssetReferences(css, "https://fitgirl-repacks.site/wp/css/site.css");

    expect(references).toEqual([
      { source: "css-import", url: "https://fitgirl-repacks.site/theme.css" },
      { source: "css-url", url: "https://fitgirl-repacks.site/wp/img/bg.png" },
    ]);

    const rewritten = rewriteCssAssetReferences(css, "https://fitgirl-repacks.site/wp/css/site.css", url =>
      `/asset?url=${encodeURIComponent(url)}`
    );

    expect(rewritten).toContain('@import url("/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Ftheme.css")');
    expect(rewritten).toContain('url("/asset?url=https%3A%2F%2Ffitgirl-repacks.site%2Fwp%2Fimg%2Fbg.png")');
  });
});
