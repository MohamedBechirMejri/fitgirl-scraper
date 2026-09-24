import { describe, expect, test } from "bun:test";
import { downloadRange, earlierReleases, parseGamePost, splitReleaseTitle } from "./game-post";
import { emptyPageMetadata, type PageMetadata } from "./page-extract";

// Trimmed from a real post: header, facts, screenshots, features, description and optional files.
const RELEASE_HTML = `
<article><div class="entry-content">
<h3><span style="color: #339966;">#1276 Updated <span style="color: white">&nbsp;HYPERVISOR&nbsp;</span></span> <strong>Age of Empires II: Definitive Edition <span style="color: #808080;">v101.103.38051.0 (#169123) + 15 DLCs/Bonuses</span></strong></h3>
<p><a href="https://en.riotpixels.com/games/aoe2/"><img class="alignleft" src="https://i3.imageban.ru/out/2021/08/11/cover.jpg" /></a><br />
Genres/Tags: Strategy, RTS<br />Repack Size: <strong>from 12.3 GB</strong> [Selective Download]</p>
<h3>Download Mirrors (Torrent)</h3>
<ul><li><a href="magnet:?xt=urn:btih:ABC">magnet</a> <img src="https://torrent-stats.info/0af0/stats.png"></li></ul>
<h3>Screenshots (Click to enlarge)</h3>
<p><a href="https://en.riotpixels.com/x/1/"><img src="http://s01.riotpixels.net/data/a0/33/shot-1.jpg.240p.jpg"></a><a href="https://en.riotpixels.com/x/2/"><img src="http://s01.riotpixels.net/data/9d/b0/shot-2.jpg.240p.jpg"></a><br />
<a href="https://en.riotpixels.com/x/"><video muted=""><source src="https://video.fastly.steamstatic.com/store_trailers/813780/1857295517/2877cb/1750825274/microtrailer.webm" type="video/webm"></video></a></p>
<h3>Repack Features</h3>
<ul>
<li>Based on Age.of.Empires.II.Definitive.Edition-RUNE scene ISO release (52,654,440,448 bytes)
<li>Selective Download feature: you can skip downloading and installing of Enhanced Graphics Pack
<li>100% Lossless &#038; MD5 Perfect: all files are identical to originals after installation
<li>Significantly smaller archive size (compressed from 49 to 12.3~32.4 GB, depending on selected components)
<li>Installation takes 9-50 minutes (depending on your system and selected components)
<li>HDD space after installation: up to 85.5 GB
<li>At least 2 GB of free RAM (inc. virtual) required for installing this repack
</ul>
<div class="su-spoiler"><div class="su-spoiler-title" tabindex="0" role="button"><span class="su-spoiler-icon"></span>Game Description</div><div class="su-spoiler-content su-u-clearfix su-u-trim">
Age of Empires II: Definitive Edition celebrates the 20th anniversary of one of the most popular strategy games ever.</p>
<p>Explore all the original campaigns like never before &#8211; over 200 hours of gameplay.</p>
<p><b>Included DLCs:</b></p>
<ul>
<li>Lords of the West
<li>Dawn of the Dukes
</ul>
</div></div>
<div class="su-spoiler"><div class="su-spoiler-title" tabindex="0" role="button"><span class="su-spoiler-icon"></span>Selective Download</div><div class="su-spoiler-content su-u-clearfix su-u-trim">
<p>Here is the list of selective/optional files:</p>
<ul>
<li>fg-optional-hd-pack.bin + fg-optional-hd-pack-2.bin (Download only if you have an Ultra HD display)
<li>fg-selective-french.bin
</ul>
</div></div>
</div><!-- .entry-content --></article>`;

const NOTICE_HTML = `<div class="entry-content">
<p>This is just a notice for my subscribers about freshly updated <strong><a href="https://fitgirl-repacks.site/escape-simulator-2/" target="_blank">Escape Simulator 2 repack</a></strong>. Now it&#8217;s updated to v22719r and includes 2 DLCs/Bonuses.</p>
</div><!-- .entry-content -->`;

function metadata(overrides: Partial<PageMetadata>): PageMetadata {
  return { ...emptyPageMetadata("post"), ...overrides };
}

describe("parseGamePost", () => {
  test("reads a release: names from the header, the update badge, facts, art and optional files", () => {
    const post = parseGamePost({
      fetchedAt: "2026-09-13T02:00:00.000Z",
      html: RELEASE_HTML,
      metadata: metadata({ publishedAt: "2026-09-13T01:00:06+00:00", repackSize: "from 12.3 GB [Selective Download]" }),
      title: "Age of Empires II: Definitive Edition - v101.103.38051.0 (#169123) + 15 DLCs/Bonuses - FitGirl Repacks",
      url: "https://fitgirl-repacks.site/age-of-empires-2-definitive-edition/",
    });

    expect(post.kind).toBe("release");
    expect(post.number).toBe(1276);
    expect(post.isUpdate).toBe(true);
    expect(post.hypervisor).toBe(true);
    expect(post).toMatchObject({
      name: "Age of Empires II",
      edition: "Definitive Edition",
      version: "v101.103.38051.0 (#169123)",
      extras: "15 DLCs/Bonuses",
      dlcCount: 15,
    });
    expect(post.cover).toBe("https://i3.imageban.ru/out/2021/08/11/cover.jpg");
    expect(post.screenshots).toEqual([
      "https://s01.riotpixels.net/data/a0/33/shot-1.jpg",
      "https://s01.riotpixels.net/data/9d/b0/shot-2.jpg",
    ]);
    expect(post.steamAppId).toBe(813780);
    expect(post.trailers).toHaveLength(1);
    expect(post.repack).toMatchObject({
      download: { min: "12.3 GB", max: "32.4 GB" },
      installSize: "85.5 GB",
      installTime: "9-50 minutes",
      memory: "2 GB",
      lossless: true,
      selectiveDownload: true,
      optionalParts: [
        {
          label: "hd pack",
          files: ["fg-optional-hd-pack.bin", "fg-optional-hd-pack-2.bin"],
          note: "Download only if you have an Ultra HD display",
        },
        { label: "french", files: ["fg-selective-french.bin"], note: null },
      ],
    });
    expect(post.description).toEqual([
      "Age of Empires II: Definitive Edition celebrates the 20th anniversary of one of the most popular strategy games ever.",
      "Explore all the original campaigns like never before – over 200 hours of gameplay.",
    ]);
    expect(post.dlcs).toEqual(["Lords of the West", "Dawn of the Dukes"]);
    expect(post.summary).toStartWith("Age of Empires II: Definitive Edition celebrates");
  });

  test("reads a Repack Updated notice as a pointer to its release", () => {
    const post = parseGamePost({
      fetchedAt: null,
      html: NOTICE_HTML,
      metadata: metadata({ publishedAt: "2026-09-23T18:42:46+00:00" }),
      title: "Escape Simulator 2 Repack Updated - FitGirl Repacks",
      url: "https://fitgirl-repacks.site/escape-simulator-2-repack-updated/",
    });

    expect(post).toMatchObject({
      kind: "update-notice",
      name: "Escape Simulator 2",
      version: "v22719r",
      extras: "2 DLCs/Bonuses",
      updates: "https://fitgirl-repacks.site/escape-simulator-2/",
      cover: null,
    });
  });

  test("without a Selective Download list, optional parts come from the file names the post lists", () => {
    const post = parseGamePost({
      fetchedAt: null,
      html: `<div class="entry-content">
        <h3>Repack Features</h3><ul><li>Selective Download feature: you may skip Japanese videos and bonus content</ul>
        <a href="https://datanodes.to/a/FF7_--_fitgirl-repacks.site_--_fg-optional-japanese-videos.part1.rar">x</a>
        <a href="https://datanodes.to/b/FF7_--_fitgirl-repacks.site_--_fg-optional-japanese-videos.part2.rar">x</a>
        <a href="https://datanodes.to/c/FF7_--_fitgirl-repacks.site_--_fg-optional-bonus-content.bin">x</a>
        <h3>Backwards Compatibility</h3><ul><li>fg-optional-bonus-content.bin</ul>
      </div><!-- .entry-content -->`,
      metadata: metadata({ repackSize: "from 130.6 GB [Selective Download]" }),
      title: "FINAL FANTASY VII REBIRTH: Digital Deluxe Edition, v1.005 - FitGirl Repacks",
      url: "https://fitgirl-repacks.site/final-fantasy-7-rebirth/",
    });

    expect(post.repack.optionalParts).toEqual([
      {
        label: "japanese videos",
        files: ["fg-optional-japanese-videos.part1.rar", "fg-optional-japanese-videos.part2.rar"],
        note: null,
      },
      { label: "bonus content", files: ["fg-optional-bonus-content.bin"], note: null },
    ]);
  });

  test("news posts without a repack size are neither releases nor notices", () => {
    const post = parseGamePost({
      fetchedAt: null,
      html: "<div class=\"entry-content\"><p>Updates digest</p></div>",
      metadata: metadata({}),
      title: "Updates Digest for September 21, 2026 - FitGirl Repacks",
      url: "https://fitgirl-repacks.site/updates-digest-for-september-21-2026/",
    });
    expect(post.kind).toBe("other");
  });
});

describe("splitReleaseTitle", () => {
  test("falls back to the page title when the header has no details", () => {
    expect(splitReleaseTitle("Granblue Fantasy Versus: Rising - Legendary Edition, v2.61 + 64 DLCs/Bonuses")).toEqual({
      name: "Granblue Fantasy Versus: Rising",
      edition: "Legendary Edition",
      version: "v2.61",
      extras: "64 DLCs/Bonuses",
    });
    expect(splitReleaseTitle("Polylithic, v1.0.0.24")).toMatchObject({ name: "Polylithic", version: "v1.0.0.24" });
    expect(splitReleaseTitle("Low-Budget Repairs + Bonus App")).toMatchObject({
      name: "Low-Budget Repairs",
      version: null,
      extras: "Bonus App",
    });
    expect(splitReleaseTitle("Sunken Realms")).toEqual({ name: "Sunken Realms", edition: null, version: null, extras: null });
  });

  test("keeps commas inside a version and dates in a build name", () => {
    expect(splitReleaseTitle("", "No Man’s Sky", "v7.0 (178763, Cosmos Update) + 2 DLCs + Bonus OST")).toMatchObject({
      version: "v7.0 (178763, Cosmos Update)",
      extras: "2 DLCs + Bonus OST",
    });
    expect(splitReleaseTitle("", "iRacing Studios NASCAR 26", "Build September 10, 2026 + 2 DLCs")).toMatchObject({
      version: "Build September 10, 2026",
      extras: "2 DLCs",
    });
  });

  test("uses the page title for the details a header leaves out, across dash styles", () => {
    expect(splitReleaseTitle("SILENT HILL: Townfall - Deluxe Edition, v1.4.153521", "SILENT HILL: Townfall – Deluxe Edition")).toEqual({
      name: "SILENT HILL: Townfall",
      edition: "Deluxe Edition",
      version: "v1.4.153521",
      extras: null,
    });
  });
});

describe("downloadRange", () => {
  test("prefers the compressed-size line, then the post's repack size", () => {
    expect(downloadRange(["Smaller archive size (compressed from 1.2 GB to 972 MB)"], "972 MB")).toEqual({
      min: "972 MB",
      max: null,
    });
    expect(downloadRange([], "7.6/7.8 GB")).toEqual({ min: "7.6 GB", max: "7.8 GB" });
    expect(downloadRange([], "from 38.8 GB [Selective Download]")).toEqual({ min: "38.8 GB", max: null });
    expect(downloadRange([], "10.3 GB")).toEqual({ min: "10.3 GB", max: "10.3 GB" });
    expect(downloadRange([], null)).toBeNull();
  });
});

describe("earlierReleases", () => {
  test("lists each earlier publish date once, newest first, without the current one", () => {
    const history = [
      { publishedAt: "2026-09-23T00:00:16+00:00", title: "Shape of Dreams - v1.4.0.13 + DLC - FitGirl Repacks" },
      { publishedAt: "2026-06-21T13:30:16+00:00", title: "Shape of Dreams - v1.2.1.7 - FitGirl Repacks" },
      { publishedAt: "2026-06-21T13:30:16+00:00", title: "Shape of Dreams - v1.2.1.7 - FitGirl Repacks" },
      { publishedAt: "2026-05-02T10:00:16+00:00", title: "Shape of Dreams - v1.1 - FitGirl Repacks" },
    ];
    expect(earlierReleases(history, "2026-09-23T00:00:16+00:00")).toEqual([
      { publishedAt: "2026-06-21T13:30:16+00:00", title: "Shape of Dreams - v1.2.1.7", version: "v1.2.1.7" },
      { publishedAt: "2026-05-02T10:00:16+00:00", title: "Shape of Dreams - v1.1", version: "v1.1" },
    ]);
  });
});
