import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mirrorAssetPath, mirrorPagePath, staticMirrorRoute } from "./export-mirror";

describe("mirror export paths", () => {
  const mirrorRoot = "/tmp/fitgirl-mirror";

  test("maps WordPress pages to index files", () => {
    expect(mirrorPagePath("https://fitgirl-repacks.site/", mirrorRoot)).toBe(join(mirrorRoot, "index.html"));
    expect(mirrorPagePath("https://fitgirl-repacks.site/donations/", mirrorRoot)).toBe(
      join(mirrorRoot, "donations", "index.html")
    );
    expect(mirrorPagePath("https://fitgirl-repacks.site/readme.html", mirrorRoot)).toBe(
      join(mirrorRoot, "readme.html")
    );
  });

  test("maps same-site assets to original paths without query strings", () => {
    const url = "https://fitgirl-repacks.site/wp-content/themes/site.css?ver=1";

    expect(staticMirrorRoute(url)).toBe("/wp-content/themes/site.css?ver=1");
    expect(mirrorAssetPath(url, mirrorRoot)).toBe(join(mirrorRoot, "wp-content", "themes", "site.css"));
  });

  test("maps external assets into a stable local bucket", () => {
    const route = staticMirrorRoute("https://secure.gravatar.com/avatar/demo.png?s=80");

    expect(route).toMatch(/^\/__external-assets\/[a-f0-9]{16}\.png$/);
    expect(mirrorAssetPath("https://secure.gravatar.com/avatar/demo.png?s=80", mirrorRoot)).toContain(
      join("__external-assets")
    );
  });
});
