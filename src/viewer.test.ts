import { describe, expect, test } from "bun:test";
import { archiveRequestPath, mirrorUrlCandidates, parseViewerOptions } from "./viewer";

describe("viewer options", () => {
  test("defaults to localhost binding", () => {
    expect(parseViewerOptions([])).toEqual({
      archiveDir: "archive",
      host: "127.0.0.1",
      port: 4173,
    });
  });

  test("accepts explicit host, port, and archive path", () => {
    expect(parseViewerOptions(["--host", "0.0.0.0", "--port", "5000", "--archive", "/tmp/archive"])).toEqual({
      archiveDir: "/tmp/archive",
      host: "0.0.0.0",
      port: 5000,
    });
  });

  test("builds https and http mirror candidates", () => {
    expect(mirrorUrlCandidates("wp-content/site.css", "?ver=1")).toEqual([
      "https://fitgirl-repacks.site/wp-content/site.css?ver=1",
      "http://fitgirl-repacks.site/wp-content/site.css?ver=1",
    ]);
  });

  test("maps internal archive routes", () => {
    expect(archiveRequestPath("/__archive")).toBe("/");
    expect(archiveRequestPath("/__archive/ops")).toBe("/ops");
    expect(archiveRequestPath("/donations/")).toBeNull();
  });
});
