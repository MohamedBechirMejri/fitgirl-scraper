import type { ArchiveSearchFacets, ArchiveSearchFilters, PageListRow } from "./archive-store";
import type { PageMetadata } from "./page-extract";
import { escapeHtml } from "./viewer-shell";

export function renderSearchForm(filters: ArchiveSearchFilters, facets: ArchiveSearchFacets): string {
  const clear = hasSearchFilters(filters) ? `<a class="button secondary" href="/__archive">Clear</a>` : "";

  return `
    <form class="search" action="/__archive" method="get" data-instant-search>
      <input name="q" type="search" value="${escapeHtml(filters.query)}" placeholder="Search title or URL" autofocus>
      ${renderFacetSelect("genre", "Genre", filters.genre, facets.genres)}
      ${renderFacetSelect("company", "Company", filters.company, facets.companies)}
      ${renderFacetSelect("language", "Language", filters.language, facets.languages)}
      <button type="submit">Search</button>
      ${clear}
    </form>
  `;
}

export function renderSearchResults(pages: PageListRow[]): string {
  return pages.length === 0 ? `<p class="empty">No archived pages found.</p>` : renderPageTable(pages);
}

export function renderPageTable(pages: PageListRow[]): string {
  return `
    <table>
      <thead><tr><th>Title</th><th>Fetched</th><th>Snapshots</th><th>Assets</th></tr></thead>
      <tbody>
        ${pages
          .map(
            page => `
              <tr>
                <td>
                  <a href="${escapeHtml(mirrorPageHref(page.url))}">${escapeHtml(page.title)}</a>
                  ${renderPageOpenLink(page)}
                  <small>${escapeHtml(page.url)}</small>
                  ${page.snippet ? `<small>${escapeHtml(page.snippet)}</small>` : ""}
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

export function renderPageOpenLink(page: PageListRow): string {
  return page.snapshotId ? `<small><a href="${archivePageHref(page.url)}">Details</a></small>` : "";
}

export function mirrorPageHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "fitgirl-repacks.site") return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Fall through to the details page for malformed URLs.
  }

  return `/page?url=${encodeURIComponent(url)}`;
}

export function archivePageHref(url: string): string {
  return `/__archive/page?url=${encodeURIComponent(url)}`;
}

export function renderAssetCompleteness(downloaded: number, total: number): string {
  if (total === 0) return "No assets";
  return `${downloaded}/${total} (${Math.round((downloaded / total) * 100)}%)`;
}

export function parseSnapshotMetadata(metadataJson: string): PageMetadata {
  try {
    return { ...emptyMetadata(), ...(JSON.parse(metadataJson) as Partial<PageMetadata>) };
  } catch {
    return emptyMetadata();
  }
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

function renderPageBadges(page: PageListRow): string {
  const metadata = parseSnapshotMetadata(page.metadataJson);
  const values = [metadata.languages, ...metadata.genres.slice(0, 4)].filter((value): value is string => Boolean(value));
  if (values.length === 0) return "";

  return `<small>${values.map(escapeHtml).join(" · ")}</small>`;
}

function hasSearchFilters(filters: ArchiveSearchFilters): boolean {
  return Boolean(filters.query || filters.genre || filters.company || filters.language);
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
