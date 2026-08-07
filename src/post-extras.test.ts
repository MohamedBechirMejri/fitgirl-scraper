import { describe, expect, test } from "bun:test";
import { extractCoverUrl, extractDescription, extractScreenshots } from "./post-extras";

const HTML = `
  <img src="https://fitgirl-repacks.site/wp-content/uploads/icon.jpg">
  <img src="https://i5.imageban.ru/out/2026/04/05/cover.jpg">
  <img src="https://torrent-stats.info/50cd/stats.png">
  <img src="http://s01.riotpixels.net/data/aa/shot-1.jpg.240p.jpg">
  <img src="http://s01.riotpixels.net/data/bb/shot-2.jpg.240p.jpg">
  <img src="http://s01.riotpixels.net/data/aa/shot-1.jpg.240p.jpg">
`;

describe("post extras", () => {
  test("cover skips site chrome and stat counters", () => {
    expect(extractCoverUrl(HTML)).toBe("https://i5.imageban.ru/out/2026/04/05/cover.jpg");
    expect(extractCoverUrl('<img src="https://torrent-stats.info/x.png">')).toBeNull();
  });

  test("screenshots keep riotpixels previews, deduplicated", () => {
    expect(extractScreenshots(HTML)).toEqual([
      "http://s01.riotpixels.net/data/aa/shot-1.jpg.240p.jpg",
      "http://s01.riotpixels.net/data/bb/shot-2.jpg.240p.jpg",
    ]);
  });

  test("description starts after the marker and decodes entities", () => {
    const text = "Repack Size: 8.8 GB Game Description A war unfolds &#8211; and it&#039;s cold. The end.";
    expect(extractDescription(text)).toBe("A war unfolds – and it's cold. The end.");
  });

  test("long descriptions cut at a sentence boundary", () => {
    const sentence = "This is a full sentence about the game. ";
    const text = `Game Description ${sentence.repeat(30)}`;
    const description = extractDescription(text);
    expect(description).not.toBeNull();
    expect(description?.length).toBeLessThanOrEqual(420);
    expect(description?.endsWith(".")).toBe(true);
  });

  test("missing marker yields null", () => {
    expect(extractDescription("no description section here")).toBeNull();
  });
});
