import { describe, expect, test } from "bun:test";
import {
  archiveRequestPath,
  archiveSearchPath,
  injectAfterBody,
  mirrorSnapshotUrlCandidates,
  mirrorUrlCandidates,
  parseViewerOptions,
} from "./viewer";

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

  test("builds slash-tolerant snapshot candidates without changing asset paths", () => {
    expect(mirrorSnapshotUrlCandidates("/game")).toEqual([
      "https://fitgirl-repacks.site/game",
      "http://fitgirl-repacks.site/game",
      "https://fitgirl-repacks.site/game/",
      "http://fitgirl-repacks.site/game/",
    ]);
    expect(mirrorSnapshotUrlCandidates("/wp-content/site.css", "?ver=1")).toEqual([
      "https://fitgirl-repacks.site/wp-content/site.css?ver=1",
      "http://fitgirl-repacks.site/wp-content/site.css?ver=1",
    ]);
  });

  test("maps internal archive routes", () => {
    expect(archiveRequestPath("/__archive")).toBe("/");
    expect(archiveRequestPath("/__archive/ops")).toBe("/ops");
    expect(archiveRequestPath("/donations/")).toBeNull();
  });

  test("maps WordPress search params to archive search params", () => {
    expect(archiveSearchPath(new URLSearchParams("s=victoria+3"))).toBe("/__archive?q=victoria+3");
    expect(archiveSearchPath(new URLSearchParams("q=elden&s=ignored"))).toBe("/__archive?q=elden");
  });

  test("injects archive tools even when saved html has no body tag", () => {
    expect(injectAfterBody("<html><body class=\"home\">Page</body></html>", "<nav>Tools</nav>")).toBe(
      "<html><body class=\"home\"><nav>Tools</nav>Page</body></html>"
    );
    expect(injectAfterBody("<main>Page</main>", "<nav>Tools</nav>")).toBe("<nav>Tools</nav><main>Page</main>");
  });
});
