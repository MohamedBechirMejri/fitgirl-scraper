import { describe, expect, test } from "bun:test";
import { parseOptions } from "./backfill-assets";

describe("asset backfill cli", () => {
  test("parses weakest rounds", () => {
    expect(parseOptions(["--weakest", "--rounds", "2"])).toMatchObject({
      rounds: 2,
      targetWeakest: true,
      targetUrl: null,
    });
  });

  test("keeps rounds scoped to weakest backfills", () => {
    expect(() => parseOptions(["--rounds", "2"])).toThrow("--rounds only works with --weakest");
    expect(() => parseOptions(["--weakest", "--rounds", "0"])).toThrow("--rounds must be a positive integer");
    expect(() => parseOptions(["--weakest", "--url", "https://fitgirl-repacks.site/demo/"])).toThrow(
      "Use either --url or --weakest"
    );
  });
});
