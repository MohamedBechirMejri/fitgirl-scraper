import type { ArchiveStore, GamePostRow } from "./archive-store";
import { earlierReleases, gamePostSummary, parseGamePost, type GamePost, type GamePostSummary } from "./game-post";
import { parseSnapshotMetadata } from "./viewer-pages";

// Read-only JSON for the nyutab Games app: recent posts, one post in full, and title search.
// A snapshot never changes once saved, so parsed posts are kept by snapshot id.

const PARSED_LIMIT = 4000;
const RELEASES_DEFAULT_DAYS = 30;
const RELEASES_MAX_LIMIT = 1000;
const SEARCH_CANDIDATES = 300;
const SEARCH_DEFAULT_LIMIT = 40;
const SEARCH_MAX_LIMIT = 100;
const COMPANY_QUERY_MIN_LENGTH = 3;

const parsed = new Map<number, GamePost>();

export type SearchMatch = "title" | "company";

/** GET /games/releases.json?since=<ISO date>&limit= — releases and update notices, newest first. */
export async function gameReleasesJson(store: ArchiveStore, params: URLSearchParams): Promise<Response> {
  const since = readSince(params.get("since"));
  if (since === null) return json({ error: "since must be an ISO date" }, 400);
  const limit = clampInteger(params.get("limit"), 300, 1, RELEASES_MAX_LIMIT);

  const posts = await Promise.all(store.gamePostsSince(since, limit).map(readGamePost));
  return json({
    posts: posts.filter(post => post.kind !== "other").map(gamePostSummary),
  });
}

/** GET /games/post.json?url=<post URL> — one post in full, with the versions it replaced. */
export async function gamePostJson(store: ArchiveStore, params: URLSearchParams): Promise<Response> {
  const url = params.get("url")?.trim() ?? "";
  if (!url) return json({ error: "url is required" }, 400);

  const row = store.getGamePost(url);
  if (!row) return json({ error: "post not found" }, 404);

  const post = await readGamePost(row);
  const history = store.getPostHistory(row.url).map(entry => ({
    publishedAt: parseSnapshotMetadata(entry.metadataJson).publishedAt,
    title: entry.title,
  }));
  return json({ post: { ...post, earlierReleases: earlierReleases(history, post.publishedAt) } });
}

/**
 * GET /games/search.json?q=&limit= — releases whose title matches, the best matches first,
 * then releases by a matching company. Notices and news never match.
 */
export async function gameSearchJson(store: ArchiveStore, params: URLSearchParams): Promise<Response> {
  const query = params.get("q")?.trim() ?? "";
  const limit = clampInteger(params.get("limit"), SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT);
  if (!query) return json({ query, results: [] });

  const titleRows = rankTitleMatches(store.searchReleaseTitles(query, SEARCH_CANDIDATES), query).slice(0, limit);
  const seen = new Set(titleRows.map(row => row.url));
  const companyRows =
    titleRows.length < limit && query.length >= COMPANY_QUERY_MIN_LENGTH
      ? store.searchReleaseCompanies(query, limit).filter(row => !seen.has(row.url)).slice(0, limit - titleRows.length)
      : [];

  const results: (GamePostSummary & { match: SearchMatch })[] = [];
  for (const [rows, match] of [[titleRows, "title"], [companyRows, "company"]] as const) {
    for (const row of rows) {
      results.push({ ...gamePostSummary(await readGamePost(row)), match });
    }
  }
  return json({ query, results });
}

/**
 * Title matches, best first: names that start with the query, then names that hold every
 * word of it, then the rest (the words sit in the edition or version). Newest first within each.
 */
export function rankTitleMatches<Row extends { title: string }>(rows: Row[], query: string): Row[] {
  const wanted = searchWords(query);
  const phrase = wanted.join(" ");
  const tier = (row: Row) => {
    const words = searchWords(row.title.replace(/\s[-–,]\s.*$|,\s.*$/, ""));
    if (words.join(" ").startsWith(phrase)) return 0;
    return wanted.every((word, index) =>
      index === wanted.length - 1 ? words.some(candidate => candidate.startsWith(word)) : words.includes(word)
    )
      ? 1
      : 2;
  };
  return rows
    .map((row, order) => ({ row, order, tier: tier(row) }))
    .sort((left, right) => left.tier - right.tier || left.order - right.order)
    .map(entry => entry.row);
}

function searchWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

async function readGamePost(row: GamePostRow): Promise<GamePost> {
  const held = parsed.get(row.snapshotId);
  if (held) return held;

  const html = await Bun.file(row.htmlPath)
    .text()
    .catch(() => null);
  const post = parseGamePost({
    fetchedAt: row.fetchedAt,
    html: html ?? "",
    metadata: parseSnapshotMetadata(row.metadataJson),
    title: row.title,
    url: row.url,
  });
  if (html !== null) {
    if (parsed.size >= PARSED_LIMIT) {
      const oldest = parsed.keys().next().value;
      if (oldest !== undefined) parsed.delete(oldest);
    }
    parsed.set(row.snapshotId, post);
  }
  return post;
}

/** An ISO date as the archive stores publish dates (UTC, "+00:00"); 30 days ago by default. */
function readSince(value: string | null): string | null {
  const time = value ? Date.parse(value) : Date.now() - RELEASES_DEFAULT_DAYS * 86_400_000;
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.min(Math.max(Math.trunc(number), min), max) : fallback;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}
