import { describe, expect, test } from "bun:test";
import { parseOptions } from "./backfill-assets";

describe("asset backfill cli", () => {
  test("parses weakest rounds", () => {
    expect(parseOptions(["--weakest", "--rounds", "2"])).toMatchObject({
      rounds: 2,
      targetWeakest: true,
      targetLatestPages: false,
      targetUrl: null,
    });
  });

  test("parses latest page rounds", () => {
    expect(parseOptions(["--latest-pages", "--rounds", "3"])).toMatchObject({
      rounds: 3,
      targetLatestPages: true,
      targetWeakest: false,
      targetUrl: null,
    });
  });

  test("keeps rounds scoped to weakest backfills", () => {
    expect(() => parseOptions(["--rounds", "2"])).toThrow("--rounds only works with --weakest or --latest-pages");
    expect(() => parseOptions(["--weakest", "--rounds", "0"])).toThrow("--rounds must be a positive integer");
    expect(() => parseOptions(["--weakest", "--url", "https://fitgirl-repacks.site/demo/"])).toThrow(
      "Use only one of --url, --weakest, or --latest-pages"
    );
    expect(() => parseOptions(["--weakest", "--latest-pages"])).toThrow(
      "Use only one of --url, --weakest, or --latest-pages"
    );
  });
});
