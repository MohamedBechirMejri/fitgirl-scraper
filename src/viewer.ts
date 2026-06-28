import { readFile } from "fs/promises";
import { join, resolve, sep } from "path";
import {
  openArchiveStore,
  type ArchiveSearchFacets,
  type ArchiveSearchFilters,
  type ArchiveRunRow,
  type ArchiveStore,
  type AssetFailureRow,
  type CrawlQueueItem,
  type PageListRow,
  type PageNavigation,
  type QueueFailureRow,
  type SnapshotAssetRow,
  type SnapshotRow,
} from "./archive-store";
import { rewriteCssAssetReferences } from "./css-assets";
import { groupLinks, type ClassifiedLink, type LinkGroup } from "./link-classifier";
import type { PageMetadata } from "./page-extract";
import { localAssetRoute, rewriteSnapshotHtml } from "./snapshot-rewrite";
import { diffText, summarizeDiff, type TextDiff } from "./text-diff";

const DEFAULT_ARCHIVE_DIR = "archive";
const DEFAULT_PORT = 4173;

interface ViewerOptions {
  archiveDir: string;
  port: number;
}

async function main(): Promise<void> {
  const options = parseOptions(Bun.argv.slice(2));
  const archiveRoot = resolve(options.archiveDir);
  const store = await openArchiveStore(join(options.archiveDir, "fitgirl.sqlite"));

  const server = Bun.serve({
    port: options.port,
    async fetch(request) {
      return handleRequest(request, store, archiveRoot);
    },
  });

  console.log(`Archive viewer: http://localhost:${server.port}`);

  process.on("SIGINT", () => {
    store.close();
    server.stop();
    process.exit(0);
  });
}

async function handleRequest(request: Request, store: ArchiveStore, archiveRoot: string): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/") {
      return html(renderHome(store, readSearchFilters(url.searchParams)));
    }

    if (url.pathname === "/page") {
      return html(renderPage(store, url.searchParams.get("url") ?? ""));
    }

    if (url.pathname === "/search.json") {
      return searchJson(store, readSearchFilters(url.searchParams));
    }

    if (url.pathname === "/ops") {
      return html(renderOps(store));
    }

    if (url.pathname === "/diff") {
      return html(renderDiff(store, Number(url.searchParams.get("before")), Number(url.searchParams.get("after"))));
    }

    if (url.pathname.startsWith("/snapshot/")) {
      return renderSnapshot(store, archiveRoot, Number(url.pathname.split("/").at(-1)));
    }

    if (url.pathname === "/asset") {
      return serveAsset(store, url.searchParams.get("url"), archiveRoot);
    }

    return notFound("Route not found.");
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}

function renderHome(store: ArchiveStore, filters: ArchiveSearchFilters): string {
  const stats = store.getStats();
  const facets = store.getSearchFacets(40);
  const pages = store.searchPages(filters, 100);

  return layout({
    body: `
      ${renderSearchForm(filters, facets)}

      <dl class="stats">
        <div><dt>Pages</dt><dd>${stats.pages}</dd></div>
        <div><dt>Snapshots</dt><dd>${stats.snapshots}</dd></div>
        <div><dt>Assets</dt><dd>${stats.downloadedAssets}/${stats.assets}</dd></div>
        <div><dt>Queue</dt><dd>${stats.queuePending}/${stats.queueFailed}</dd></div>
      </dl>
      <p><a class="button secondary" href="/ops">Operations</a></p>
      <p class="queue-note">Queue shows pending/failed. Done: ${stats.queueDone}. Running: ${stats.queueRunning}.</p>

      <section id="search-results" data-search-results>
        ${renderSearchResults(pages)}
      </section>
    `,
    script: renderInstantSearchScript(),
    title: "FitGirl Archive",
  });
}

function renderOps(store: ArchiveStore): string {
  const stats = store.getStats();
  const missingAssets = stats.assets - stats.downloadedAssets;
  const runs = store.getRecentRuns(10);
  const queueFailures = store.getRecentQueueFailures(10);
  const assetFailures = store.getRecentAssetFailures(10);

  return layout({
    body: `
      <header class="page-head">
        <h1>Operations</h1>
      </header>

      <dl class="stats">
        <div><dt>Queued</dt><dd>${stats.queuePending}</dd></div>
        <div><dt>Failed Queue</dt><dd>${stats.queueFailed}</dd></div>
        <div><dt>Missing Assets</dt><dd>${missingAssets}</dd></div>
        <div><dt>Snapshots</dt><dd>${stats.snapshots}</dd></div>
      </dl>

      <section>
        <h2>Next Commands</h2>
        ${renderCommand("Crawl next pages", "bun run scrape:local -- --limit 25 --delay-ms 3000")}
        ${renderCommand("Backfill missing assets", "bun run assets:backfill -- --limit 50 --delay-ms 2000 --asset-depth 2")}
        ${renderCommand("Retry failed assets", "bun run assets:backfill -- --limit 25 --retry-failed --delay-ms 3000")}
      </section>

      <section>
        <h2>Recent Runs</h2>
        ${runs.length === 0 ? `<p class="empty">No recorded runs yet.</p>` : renderRuns(runs)}
      </section>

      <section>
        <h2>Failed Queue</h2>
        ${queueFailures.length === 0 ? `<p class="empty">No failed queue items.</p>` : renderQueueFailures(queueFailures)}
      </section>

      <section>
        <h2>Failed Assets</h2>
        ${assetFailures.length === 0 ? `<p class="empty">No failed assets.</p>` : renderAssetFailures(assetFailures)}
      </section>
    `,
    title: "Operations",
  });
}

function renderPage(store: ArchiveStore, pageUrl: string): string {
  const latest = store.getLatestSnapshotForUrl(pageUrl);
  if (!latest) {
    return renderMissingPage(store, pageUrl);
  }

  const snapshots = store.getSnapshotsForUrl(pageUrl);
  const links = store.getSnapshotLinks(latest.id);
  const assets = store.getSnapshotAssets(latest.id);
  const metadata = parseSnapshotMetadata(latest.metadataJson);
  const navigation = store.getPageNavigation(latest.url);

  return layout({
    body: `
      <p><a href="/">Back</a></p>
      <header class="page-head">
        <h1>${escapeHtml(latest.title)}</h1>
        <a class="source" href="${escapeHtml(latest.url)}">${escapeHtml(latest.url)}</a>
        <p>
          <a class="button" href="/snapshot/${latest.id}">Open latest snapshot</a>
        </p>
      </header>

      ${renderPageNavigation(navigation)}
      ${renderMetadata(metadata)}

      <section>
        <h2>Snapshots</h2>
        <table>
          <thead><tr><th>Fetched</th><th>Status</th><th>Hash</th><th></th></tr></thead>
          <tbody>
            ${snapshots.map((snapshot, index) => renderSnapshotRow(snapshot, snapshots[index + 1])).join("")}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Links</h2>
        ${renderLinkGroups(groupLinks(links))}
      </section>

      <section>
        <h2>Assets</h2>
        <p class="queue-note">${renderAssetCompleteness(assets.filter(asset => Boolean(asset.localPath)).length, assets.length)} local.</p>
        <table>
          <thead><tr><th>Kind</th><th>Status</th><th>Size</th><th>URL</th></tr></thead>
          <tbody>
            ${assets.map(renderAssetRow).join("")}
          </tbody>
        </table>
      </section>
    `,
    title: latest.title,
  });
}

function renderDiff(store: ArchiveStore, beforeId: number, afterId: number): string {
  if (!Number.isInteger(beforeId) || !Number.isInteger(afterId)) {
    return layout({
      body: `<p class="empty">Invalid snapshot IDs.</p>`,
      title: "Invalid Diff",
    });
  }

  const before = store.getSnapshot(beforeId);
  const after = store.getSnapshot(afterId);

  if (!before || !after || before.url !== after.url) {
    return layout({
      body: `<p class="empty">Snapshots are missing or do not belong to the same URL.</p>`,
      title: "Missing Diff",
    });
  }

  const diff = diffText(before.textContent, after.textContent);

  return layout({
    body: `
      <p><a href="/page?url=${encodeURIComponent(after.url)}">Back</a></p>
      <header class="page-head">
        <h1>${escapeHtml(after.title || before.title)}</h1>
        <a class="source" href="${escapeHtml(after.url)}">${escapeHtml(after.url)}</a>
      </header>

      <dl class="stats">
        <div><dt>Before</dt><dd>#${before.id}</dd></div>
        <div><dt>After</dt><dd>#${after.id}</dd></div>
        <div><dt>Removed</dt><dd>${diff.removed.length}</dd></div>
        <div><dt>Added</dt><dd>${diff.added.length}</dd></div>
      </dl>
      <p class="queue-note">${escapeHtml(summarizeDiff(diff))}</p>

      ${renderDiffBlock(diff)}
    `,
    title: "Snapshot Diff",
  });
}

function renderMissingPage(store: ArchiveStore, pageUrl: string): string {
  const queueItem = pageUrl ? store.getQueueItem(pageUrl) : null;
  const command = pageUrl
    ? `bun run scrape:local -- --url ${pageUrl} --delay-ms 3000`
    : "bun run scrape:local -- --limit 25 --delay-ms 3000";

  return layout({
    body: `
      <p><a href="/">Back</a></p>
      <header class="page-head">
        <h1>Missing Snapshot</h1>
        <a class="source" href="${escapeHtml(pageUrl || "")}">${escapeHtml(pageUrl || "No URL provided")}</a>
      </header>
      <p class="empty">No local snapshot is saved for this URL yet.</p>
      ${queueItem ? renderQueueItem(queueItem) : `<p class="queue-note">This URL is not in the local queue yet.</p>`}
      ${renderCommand("Fetch this page", command)}
    `,
    title: "Missing Snapshot",
  });
}

function renderQueueItem(item: CrawlQueueItem): string {
  return `
    <dl class="stats">
      <div><dt>Status</dt><dd>${escapeHtml(item.status)}</dd></div>
      <div><dt>Source</dt><dd>${escapeHtml(item.source)}</dd></div>
      <div><dt>Attempts</dt><dd>${item.attempts}</dd></div>
      <div><dt>Priority</dt><dd>${item.priority}</dd></div>
    </dl>
    ${item.lastError ? `<p class="empty">${escapeHtml(item.lastError)}</p>` : ""}
  `;
}

function renderPageNavigation(navigation: PageNavigation): string {
  if (!navigation.previous && !navigation.next) return "";

  return `
    <nav class="page-nav" aria-label="Adjacent archived pages">
      ${renderAdjacentPage("Previous", navigation.previous)}
      ${renderAdjacentPage("Next", navigation.next)}
    </nav>
  `;
}

function renderAdjacentPage(label: string, page: PageNavigation["previous"]): string {
  if (!page) return `<span></span>`;

  return `
    <a href="/page?url=${encodeURIComponent(page.url)}">
      <span>${escapeHtml(label)}</span>
      ${escapeHtml(page.title)}
      <small>${escapeHtml(page.fetchedAt ?? "")}</small>
    </a>
  `;
}

function renderLinkGroups(groups: LinkGroup[]): string {
  if (groups.length === 0) return `<p class="empty">No links saved for this snapshot.</p>`;

  return groups
    .map(
      group => `
        <details class="link-group" open>
          <summary>${escapeHtml(group.title)} <span>${group.links.length}</span></summary>
          <ul class="links">${group.links.map(renderSnapshotLink).join("")}</ul>
        </details>
      `
    )
    .join("");
}

function renderSnapshotLink(link: ClassifiedLink): string {
  const url = link.url;
  const href = link.kind === "internal" ? `/page?url=${encodeURIComponent(url)}` : url;
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(url)}</a></li>`;
}

function renderMetadata(metadata: PageMetadata): string {
  const rows = [
    ["Published", metadata.publishedAt],
    ["Modified", metadata.modifiedAt],
    ["Genres", metadata.genres.join(", ")],
    ["Companies", metadata.companies.join(", ")],
    ["Languages", metadata.languages],
    ["Original", metadata.originalSize],
    ["Repack", metadata.repackSize],
    ["Filehosters", metadata.filehosterCount ? String(metadata.filehosterCount) : null],
    ["Magnets", metadata.magnetCount ? String(metadata.magnetCount) : null],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (metadata.pageType !== "post" || rows.length === 0) return "";

  return `
    <section>
      <h2>Metadata</h2>
      <dl class="meta-grid">
        ${rows
          .map(
            ([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `
          )
          .join("")}
      </dl>
    </section>
  `;
}

async function renderSnapshot(store: ArchiveStore, archiveRoot: string, snapshotId: number): Promise<Response> {
  if (!Number.isInteger(snapshotId)) {
    return notFound("Snapshot not found.");
  }

  const snapshot = store.getSnapshot(snapshotId);
  if (!snapshot) {
    return notFound("Snapshot not found.");
  }

  const htmlPath = resolveStoredPath(snapshot.htmlPath, archiveRoot);
  if (!htmlPath) {
    return notFound("Snapshot file is outside the archive.");
  }

  const sourceHtml = await readFile(htmlPath, "utf-8");
  const assets = store.getSnapshotAssets(snapshot.id);
  const rewrittenHtml = await rewriteSnapshotHtml(sourceHtml, snapshot.url, assets);
  const toolbar = `
    <nav style="position:sticky;top:0;z-index:2147483647;padding:10px 14px;background:#111;color:#fff;font:14px system-ui,sans-serif">
      <a style="color:#fff" href="/page?url=${encodeURIComponent(snapshot.url)}">Archive</a>
      <span style="margin-left:12px">${escapeHtml(snapshot.title)}</span>
      <span style="margin-left:12px;color:#bbb">${escapeHtml(snapshot.fetchedAt)}</span>
    </nav>
  `;

  return new Response(injectAfterBody(rewrittenHtml, toolbar), {
    headers: {
      "content-security-policy": "default-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

async function serveAsset(store: ArchiveStore, assetUrl: string | null, archiveRoot: string): Promise<Response> {
  if (!assetUrl) {
    return notFound("Asset not found.");
  }

  const asset = store.getAsset(assetUrl);
  if (!asset?.localPath) {
    return notFound("Asset not found.");
  }

  const path = resolveStoredPath(asset.localPath, archiveRoot);
  if (!path) {
    return notFound("Asset is outside the archive.");
  }

  if (isCssAsset(asset.contentType, asset.url)) {
    const css = await readFile(path, "utf-8");
    const body = rewriteCssAssetReferences(css, asset.url, url => localAssetRoute(url));

    return new Response(body, {
      headers: { "content-type": "text/css; charset=utf-8" },
    });
  }

  return new Response(Bun.file(path));
}

function renderCommand(label: string, command: string): string {
  return `
    <div class="command-row">
      <strong>${escapeHtml(label)}</strong>
      <pre><code>${escapeHtml(command)}</code></pre>
    </div>
  `;
}

function renderQueueFailures(rows: QueueFailureRow[]): string {
  return `
    <table>
      <thead><tr><th>URL</th><th>Attempts</th><th>Next Retry</th><th>Error</th></tr></thead>
      <tbody>
        ${rows
          .map(
            row => `
              <tr>
                <td>${escapeHtml(row.url)}</td>
                <td>${row.attempts}</td>
                <td>${escapeHtml(row.nextAttemptAt ?? "")}</td>
                <td>${escapeHtml(row.lastError ?? "")}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderRuns(rows: ArchiveRunRow[]): string {
  return `
    <table>
      <thead><tr><th>Kind</th><th>Status</th><th>Started</th><th>Command</th><th>Summary</th></tr></thead>
      <tbody>
        ${rows
          .map(
            row => `
              <tr>
                <td>${escapeHtml(row.kind)}</td>
                <td>${escapeHtml(row.status)}</td>
                <td>${escapeHtml(row.startedAt)}</td>
                <td><code>${escapeHtml(row.command)}</code>${row.error ? `<small>${escapeHtml(row.error)}</small>` : ""}</td>
                <td><small>${escapeHtml(formatRunSummary(row))}</small></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAssetFailures(rows: AssetFailureRow[]): string {
  return `
    <table>
      <thead><tr><th>URL</th><th>Status</th><th>Fetched</th><th>Type</th></tr></thead>
      <tbody>
        ${rows
          .map(
            row => `
              <tr>
                <td>${escapeHtml(row.url)}</td>
                <td>${escapeHtml(String(row.httpStatus ?? ""))}</td>
                <td>${escapeHtml(row.fetchedAt ?? "")}</td>
                <td>${escapeHtml(row.contentType ?? "")}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSearchForm(filters: ArchiveSearchFilters, facets: ArchiveSearchFacets): string {
  const clear = hasSearchFilters(filters) ? `<a class="button secondary" href="/">Clear</a>` : "";

  return `
    <form class="search" action="/" method="get" data-instant-search>
      <input name="q" type="search" value="${escapeHtml(filters.query)}" placeholder="Search title or URL" autofocus>
      ${renderFacetSelect("genre", "Genre", filters.genre, facets.genres)}
      ${renderFacetSelect("company", "Company", filters.company, facets.companies)}
      ${renderFacetSelect("language", "Language", filters.language, facets.languages)}
      <button type="submit">Search</button>
      ${clear}
    </form>
  `;
}

function renderSearchResults(pages: PageListRow[]): string {
  return pages.length === 0 ? `<p class="empty">No archived pages found.</p>` : renderPageTable(pages);
}

function renderFacetSelect(name: keyof ArchiveSearchFilters, label: string, value: string, rows: { value: string }[]): string {
  return `
    <select name="${name}" aria-label="${escapeHtml(label)}">
      <option value="">${escapeHtml(label)}</option>
      ${rows
        .map(
          row => `
            <option value="${escapeHtml(row.value)}"${row.value === value ? " selected" : ""}>${escapeHtml(row.value)}</option>
          `
        )
        .join("")}
    </select>
  `;
}

function renderPageTable(pages: PageListRow[]): string {
  return `
    <table>
      <thead><tr><th>Title</th><th>Fetched</th><th>Snapshots</th><th>Assets</th></tr></thead>
      <tbody>
        ${pages
          .map(
            page => `
              <tr>
                <td>
                  <a href="/page?url=${encodeURIComponent(page.url)}">${escapeHtml(page.title)}</a>
                  <small>${escapeHtml(page.url)}</small>
                  ${renderPageBadges(page)}
                </td>
                <td>${escapeHtml(page.fetchedAt ?? "")}</td>
                <td>${page.snapshotCount}</td>
                <td>${renderAssetCompleteness(page.downloadedAssetCount, page.assetCount)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAssetCompleteness(downloaded: number, total: number): string {
  if (total === 0) return "No assets";
  return `${downloaded}/${total} (${Math.round((downloaded / total) * 100)}%)`;
}

function renderPageBadges(page: PageListRow): string {
  const metadata = parseSnapshotMetadata(page.metadataJson);
  const values = [metadata.languages, ...metadata.genres.slice(0, 4)].filter((value): value is string => Boolean(value));
  if (values.length === 0) return "";

  return `<small>${values.map(escapeHtml).join(" · ")}</small>`;
}

function renderSnapshotRow(snapshot: SnapshotRow, previous?: SnapshotRow): string {
  const compareLink = previous
    ? `<a href="/diff?before=${previous.id}&after=${snapshot.id}">Compare</a>`
    : "";

  return `
    <tr>
      <td>${escapeHtml(snapshot.fetchedAt)}</td>
      <td>${snapshot.status}</td>
      <td><code>${escapeHtml(snapshot.contentHash.slice(0, 12))}</code></td>
      <td><a href="/snapshot/${snapshot.id}">Open</a>${compareLink ? ` · ${compareLink}` : ""}</td>
    </tr>
  `;
}

function renderDiffBlock(diff: TextDiff): string {
  return `
    <section>
      <h2>Changed Text</h2>
      <div class="diff-grid">
        <div>
          <h3>Removed</h3>
          <p class="diff-context">${escapeHtml(diff.sharedPrefix.join(" "))}</p>
          <p class="diff-removed">${escapeHtml(diff.removed.join(" ") || "No removed text.")}</p>
          <p class="diff-context">${escapeHtml(diff.sharedSuffix.join(" "))}</p>
        </div>
        <div>
          <h3>Added</h3>
          <p class="diff-context">${escapeHtml(diff.sharedPrefix.join(" "))}</p>
          <p class="diff-added">${escapeHtml(diff.added.join(" ") || "No added text.")}</p>
          <p class="diff-context">${escapeHtml(diff.sharedSuffix.join(" "))}</p>
        </div>
      </div>
    </section>
  `;
}

function renderAssetRow(asset: SnapshotAssetRow): string {
  const assetLink = asset.localPath
    ? `<a href="${localAssetRoute(asset.url)}">${escapeHtml(asset.url)}</a>`
    : escapeHtml(asset.url);

  return `
    <tr>
      <td>${escapeHtml(asset.kind)}</td>
      <td>${escapeHtml(String(asset.httpStatus ?? ""))}</td>
      <td>${formatBytes(asset.sizeBytes)}</td>
      <td>${assetLink}<small>${escapeHtml(asset.contentType ?? "")}</small></td>
    </tr>
  `;
}

function layout({ body, script = "", title }: { body: string; script?: string; title: string }): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f5f5f3; color: #171717; }
          main { width: min(72rem, calc(100vw - 2rem)); margin: 0 auto; padding: 1.25rem 0 3rem; }
          h1 { margin: 0 0 .5rem; font-size: 1.75rem; line-height: 1.15; }
          h2 { margin-top: 2rem; font-size: 1.1rem; }
          a { color: #0f5c8c; text-decoration-thickness: .08em; }
          small { display: block; margin-top: .25rem; color: #6b6b6b; font-size: .78rem; overflow-wrap: anywhere; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #deded8; }
          th, td { padding: .7rem .8rem; border-bottom: 1px solid #ecece6; text-align: left; vertical-align: top; }
          th { font-size: .78rem; text-transform: uppercase; color: #62625c; background: #fbfbf8; }
          code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; }
          .search { display: grid; grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(8rem, 1fr)) auto auto; gap: .5rem; margin-bottom: 1rem; }
          input, select, button, .button { border: 1px solid #c9c9c1; border-radius: 6px; font: inherit; }
          input, select { min-width: 0; padding: .75rem .85rem; background: #fff; }
          button, .button { display: inline-block; padding: .75rem 1rem; background: #171717; color: #fff; text-decoration: none; }
          .button.secondary { background: #fff; color: #171717; }
          .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1rem; }
          .stats div { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: .8rem; }
          .stats dt { color: #62625c; font-size: .8rem; }
          .stats dd { margin: .15rem 0 0; font-size: 1.35rem; font-weight: 700; }
          .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem .75rem; }
          .meta-grid div { min-width: 0; padding: .65rem .75rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .meta-grid dt { color: #62625c; font-size: .78rem; }
          .meta-grid dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
          .page-head { margin-bottom: 1.25rem; }
          .source { overflow-wrap: anywhere; }
          .page-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1.25rem; }
          .page-nav a { display: block; min-width: 0; padding: .75rem .85rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; text-decoration: none; overflow-wrap: anywhere; }
          .page-nav span { display: block; margin-bottom: .25rem; color: #62625c; font-size: .78rem; text-transform: uppercase; }
          .links { columns: 2 24rem; padding-left: 1.1rem; }
          .links li { break-inside: avoid; margin-bottom: .35rem; overflow-wrap: anywhere; }
          .link-group { margin-bottom: .75rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .link-group summary { cursor: pointer; padding: .75rem .9rem; font-weight: 700; }
          .link-group summary span { color: #62625c; font-weight: 400; }
          .link-group .links { margin: 0; padding: 0 .9rem .85rem 1.9rem; }
          .empty { padding: 1rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .queue-note { margin: -.25rem 0 1rem; color: #62625c; font-size: .9rem; }
          .top-nav { display: flex; gap: 1rem; margin-bottom: 1rem; }
          .command-row { margin-bottom: 1rem; }
          pre { overflow-x: auto; margin: .4rem 0 0; padding: .8rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .diff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
          .diff-grid > div { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: .8rem; }
          .diff-grid h3 { margin: 0 0 .5rem; font-size: 1rem; }
          .diff-context { color: #62625c; }
          .diff-added, .diff-removed, .diff-context { overflow-wrap: anywhere; line-height: 1.5; }
          .diff-added { background: #e8f5e9; padding: .6rem; border-radius: 6px; }
          .diff-removed { background: #fdecea; padding: .6rem; border-radius: 6px; }
          @media (max-width: 44rem) {
            main { width: min(100vw - 1rem, 72rem); }
            .search, .stats, .meta-grid { grid-template-columns: 1fr; }
            .page-nav { grid-template-columns: 1fr; }
            .diff-grid { grid-template-columns: 1fr; }
            th:nth-child(2), td:nth-child(2) { display: none; }
          }
        </style>
      </head>
      <body>
        <main>
          <nav class="top-nav">
            <a href="/">Archive</a>
            <a href="/ops">Operations</a>
          </nav>
          ${body}
        </main>
        ${script}
      </body>
    </html>`;
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function searchJson(store: ArchiveStore, filters: ArchiveSearchFilters): Response {
  return new Response(JSON.stringify({ html: renderSearchResults(store.searchPages(filters, 100)) }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function renderInstantSearchScript(): string {
  return `
    <script>
      (() => {
        const form = document.querySelector("[data-instant-search]");
        const results = document.querySelector("[data-search-results]");
        if (!form || !results || !window.fetch) return;

        let controller = null;
        let timer = 0;

        const search = () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const params = new URLSearchParams(new FormData(form));
            for (const [key, value] of [...params.entries()]) {
              if (!value) params.delete(key);
            }

            if (controller) controller.abort();
            controller = new AbortController();

            try {
              const response = await fetch("/search.json?" + params.toString(), {
                headers: { accept: "application/json" },
                signal: controller.signal,
              });
              if (!response.ok) return;

              const body = await response.json();
              results.innerHTML = body.html;
              history.replaceState(null, "", params.toString() ? "/?" + params.toString() : "/");
            } catch (error) {
              if (error.name !== "AbortError") console.error(error);
            }
          }, 120);
        };

        form.addEventListener("input", search);
        form.addEventListener("change", search);
        form.addEventListener("submit", event => {
          event.preventDefault();
          search();
        });
      })();
    </script>
  `;
}

function notFound(message: string): Response {
  return new Response(message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function injectAfterBody(html: string, snippet: string): string {
  return html.replace(/<body([^>]*)>/i, `<body$1>${snippet}`);
}

function resolveStoredPath(storedPath: string, archiveRoot: string): string | null {
  const path = resolve(process.cwd(), storedPath);
  return path === archiveRoot || path.startsWith(`${archiveRoot}${sep}`) ? path : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isCssAsset(contentType: string | null, url: string): boolean {
  return contentType?.includes("css") || new URL(url).pathname.endsWith(".css");
}

function parseSnapshotMetadata(metadataJson: string): PageMetadata {
  try {
    return { ...emptyMetadata(), ...(JSON.parse(metadataJson) as Partial<PageMetadata>) };
  } catch {
    return emptyMetadata();
  }
}

function emptyMetadata(): PageMetadata {
  return {
    companies: [],
    filehosterCount: 0,
    genres: [],
    languages: null,
    magnetCount: 0,
    modifiedAt: null,
    originalSize: null,
    pageType: "unknown",
    publishedAt: null,
    repackSize: null,
  };
}

function formatRunSummary(row: ArchiveRunRow): string {
  if (!row.summaryJson) return row.finishedAt ? `Finished ${row.finishedAt}` : "Still running";

  try {
    const summary = JSON.parse(row.summaryJson) as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof summary.processedCount === "number") parts.push(`processed ${summary.processedCount}`);
    if (typeof summary.prunedCount === "number") parts.push(`pruned ${summary.prunedCount}`);
    if (typeof summary.seededCount === "number") parts.push(`seeded ${summary.seededCount}`);
    if (typeof summary.selectedAssets === "number") parts.push(`selected ${summary.selectedAssets}`);
    if (typeof summary.selectedSnapshots === "number") parts.push(`selected ${summary.selectedSnapshots}`);
    if (typeof summary.refreshedCount === "number") parts.push(`refreshed ${summary.refreshedCount}`);
    if (typeof summary.updatedCount === "number") parts.push(`updated ${summary.updatedCount}`);
    if (typeof summary.skippedCount === "number") parts.push(`skipped ${summary.skippedCount}`);

    return parts.length > 0 ? parts.join(", ") : row.summaryJson;
  } catch {
    return row.summaryJson;
  }
}

function parseOptions(args: string[]): ViewerOptions {
  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    port: readNumberFlag(args, "--port", DEFAULT_PORT),
  };
}

function readSearchFilters(params: URLSearchParams): ArchiveSearchFilters {
  return {
    company: params.get("company")?.trim() ?? "",
    genre: params.get("genre")?.trim() ?? "",
    language: params.get("language")?.trim() ?? "",
    query: params.get("q")?.trim() ?? "",
  };
}

function hasSearchFilters(filters: ArchiveSearchFilters): boolean {
  return Boolean(filters.query || filters.genre || filters.company || filters.language);
}

function readStringFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const value = Number(readStringFlag(args, name, String(fallback)));

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
