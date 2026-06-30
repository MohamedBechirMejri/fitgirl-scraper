import { describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { saveAssets } from "./asset-downloader";
import { openArchiveStore } from "./archive-store";

describe("asset downloader", () => {
  test("downloads CSS dependencies", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/style.css") {
          return new Response('@import "/theme.css"; body { background: url("/bg.png"); }', {
            headers: { "content-type": "text/css" },
          });
        }

        if (url.pathname === "/theme.css") {
          return new Response("body { color: black; }", {
            headers: { "content-type": "text/css" },
          });
        }

        if (url.pathname === "/bg.png") {
          return new Response("image-ok", {
            headers: { "content-type": "image/png" },
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
    const root = await mkdtemp(join(tmpdir(), "fitgirl-assets-"));
    const store = await openArchiveStore(join(root, "archive.sqlite"));
    const baseUrl = `http://localhost:${server.port}`;

    try {
      await saveAssets(
        store,
        {
          archiveDir: root,
          assetDepth: 1,
          delayMs: 0,
          maxRequests: 10,
          timeoutMs: 1_000,
        },
        [{ kind: "stylesheet", source: "test", url: `${baseUrl}/style.css` }]
      );

      expect(store.getAsset(`${baseUrl}/style.css`)?.localPath).toBeTruthy();
      expect(store.getAsset(`${baseUrl}/theme.css`)?.localPath).toBeTruthy();
      expect(store.getAsset(`${baseUrl}/bg.png`)?.localPath).toBeTruthy();
    } finally {
      store.close();
      server.stop();
    }
  });

  test("caps CSS dependency requests", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/style.css") {
          return new Response('@import "/theme.css";', {
            headers: { "content-type": "text/css" },
          });
        }

        if (url.pathname === "/theme.css") {
          return new Response('body { background: url("/bg.png"); src: url("/font.woff2?ver=23"); }', {
            headers: { "content-type": "text/css" },
          });
        }

        if (url.pathname === "/bg.png") {
          return new Response("image-ok", {
            headers: { "content-type": "image/png" },
          });
        }

        if (url.pathname === "/font.woff2") {
          return new Response("font-ok", {
            headers: { "content-type": "font/woff2" },
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
    const root = await mkdtemp(join(tmpdir(), "fitgirl-assets-"));
    const store = await openArchiveStore(join(root, "archive.sqlite"));
    const baseUrl = `http://localhost:${server.port}`;

    try {
      await saveAssets(
        store,
        {
          archiveDir: root,
          assetDepth: 2,
          delayMs: 0,
          maxRequests: 2,
          timeoutMs: 1_000,
        },
        [{ kind: "stylesheet", source: "test", url: `${baseUrl}/style.css` }]
      );

      expect(store.getAsset(`${baseUrl}/style.css`)?.localPath).toBeTruthy();
      expect(store.getAsset(`${baseUrl}/theme.css`)?.localPath).toBeTruthy();
      expect(store.getAsset(`${baseUrl}/bg.png`)).toMatchObject({ localPath: null });
      expect(store.getAsset(`${baseUrl}/font.woff2?ver=23`)).toMatchObject({ localPath: null });
    } finally {
      store.close();
      server.stop();
    }
  });
});
