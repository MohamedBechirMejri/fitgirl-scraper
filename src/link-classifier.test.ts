import { describe, expect, test } from "bun:test";
import { classifyLink, groupLinks } from "./link-classifier";

describe("link classifier", () => {
  test("classifies archive, torrent, download, and external links", () => {
    expect(classifyLink("https://fitgirl-repacks.site/sportal/")).toBe("internal");
    expect(classifyLink("magnet:?xt=urn:btih:abc")).toBe("torrent");
    expect(classifyLink("https://1337x.to/torrent/123/demo/")).toBe("torrent");
    expect(classifyLink("https://datanodes.to/file.rar")).toBe("download");
    expect(classifyLink("https://en.riotpixels.com/games/sportal/")).toBe("external");
  });

  test("groups links in browsing order", () => {
    const groups = groupLinks([
      "https://fitgirl-repacks.site/sportal/",
      "https://en.riotpixels.com/games/sportal/",
      "magnet:?xt=urn:btih:abc",
      "https://datanodes.to/file.rar",
    ]);

    expect(groups.map(group => group.title)).toEqual(["Downloads", "Torrents & Magnets", "Archive Pages", "External"]);
  });
});
