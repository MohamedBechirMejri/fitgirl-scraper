import type { PageMetadata } from "./page-extract";
import { extractCoverUrl, extractScreenshots } from "./post-extras";

// A FitGirl post read as a game: what the repack is, what it costs, and how it looks.
// FitGirl updates a repack in place: the same URL gets a new version, a new publish
// date and "Updated" next to its number, then a short "Repack Updated" notice links to it.

export type GamePostKind = "release" | "update-notice" | "other";

export interface GamePostSummary {
  url: string;
  kind: GamePostKind;
  /** FitGirl's repack number (#6680); it stays with the game across updates. */
  number: number | null;
  /** The post title without the site suffix. */
  title: string;
  name: string;
  edition: string | null;
  version: string | null;
  /** What ships with the game: "2 DLCs + Bonus OST". */
  extras: string | null;
  dlcCount: number | null;
  /** FitGirl marked this repack as an update of an earlier release of the same post. */
  isUpdate: boolean;
  /** The game only runs through a hypervisor bypass, with the security trade-offs that brings. */
  hypervisor: boolean;
  publishedAt: string | null;
  modifiedAt: string | null;
  companies: string[];
  genres: string[];
  languages: string | null;
  originalSize: string | null;
  repackSize: string | null;
  cover: string | null;
  /** Full-size screenshots, in the post's order. */
  screenshots: string[];
  steamAppId: number | null;
  /** The first sentences of the game description. */
  summary: string | null;
  /** For an update notice, the release it announces. */
  updates: string | null;
}

export interface SizeRange {
  min: string;
  max: string | null;
}

export interface OptionalPart {
  label: string;
  files: string[];
  note: string | null;
}

export interface RepackFacts {
  basedOn: string | null;
  download: SizeRange | null;
  installSize: string | null;
  installTime: string | null;
  /** Free memory the installer needs. */
  memory: string | null;
  lossless: boolean;
  selectiveDownload: boolean;
  optionalParts: OptionalPart[];
  /** Every "Repack Features" line, as written. */
  features: string[];
}

export interface EarlierRelease {
  publishedAt: string;
  title: string;
  version: string | null;
}

export interface GamePost extends GamePostSummary {
  fetchedAt: string | null;
  /** Paragraphs and list items of the game description. */
  description: string[];
  /** Included DLCs and bonuses, when the post lists them. */
  dlcs: string[];
  /** Short Steam trailers the post embeds. */
  trailers: string[];
  repack: RepackFacts;
}

export interface GamePostInput {
  fetchedAt: string | null;
  html: string;
  metadata: PageMetadata;
  title: string;
  url: string;
}

const SITE_SUFFIX = /\s*[-–]\s*FitGirl Repacks\s*$/i;
const NOTICE_TITLE = /\s+Repack Updated$/i;
const NOTICE_TEXT = /just a notice for my subscribers about freshly updated/i;
const EDITION_WORDS = /\b(?:edition|bundle|collection|cut|remaster(?:ed)?|goty|game of the year|pack)\b/i;
const SUMMARY_LENGTH = 420;
const OPTIONAL_FILE = /fg-(?:optional|selective)-[\w-]+?(?:\.part\d+\.rar|\.bin)/gi;
const SCREENSHOT_HOSTS_HTTPS = /^http:\/\/(s\d+\.riotpixels\.net|i\d+\.imageban\.ru|i\d+\.fastpic\.(?:ru|org))\//i;

export function parseGamePost(input: GamePostInput): GamePost {
  const content = entryContent(input.html);
  const title = decodeEntities(input.title).replace(SITE_SUFFIX, "").trim();
  const header = readHeader(content);
  const kind = postKind(title, content, input.metadata);
  const names =
    kind === "update-notice" ? noticeNames(title, content) : splitReleaseTitle(title, header.name, header.details);
  const description = descriptionBlocks(content);
  const features = listItems(sectionList(content, "Repack Features"));

  return {
    url: input.url,
    kind,
    number: header.number,
    title,
    ...names,
    dlcCount: dlcCount(names.extras),
    isUpdate: header.updated,
    hypervisor: header.hypervisor || features.some(line => /hypervisor bypass/i.test(line)),
    publishedAt: input.metadata.publishedAt,
    modifiedAt: input.metadata.modifiedAt,
    companies: input.metadata.companies.map(decodeEntities),
    genres: input.metadata.genres.map(decodeEntities),
    languages: input.metadata.languages,
    originalSize: input.metadata.originalSize,
    repackSize: input.metadata.repackSize ? decodeEntities(input.metadata.repackSize) : null,
    cover: kind === "release" ? httpsImage(extractCoverUrl(content)) : null,
    screenshots: kind === "release" ? screenshots(content) : [],
    steamAppId: steamAppId(content),
    summary: shortText(description.text),
    updates: kind === "update-notice" ? noticeTarget(content) : null,
    fetchedAt: input.fetchedAt,
    description: description.text,
    dlcs: description.dlcs,
    trailers: trailers(content),
    repack: repackFacts(features, content, input.metadata.repackSize),
  };
}

export function gamePostSummary(post: GamePost): GamePostSummary {
  return {
    url: post.url,
    kind: post.kind,
    number: post.number,
    title: post.title,
    name: post.name,
    edition: post.edition,
    version: post.version,
    extras: post.extras,
    dlcCount: post.dlcCount,
    isUpdate: post.isUpdate,
    hypervisor: post.hypervisor,
    publishedAt: post.publishedAt,
    modifiedAt: post.modifiedAt,
    companies: post.companies,
    genres: post.genres,
    languages: post.languages,
    originalSize: post.originalSize,
    repackSize: post.repackSize,
    cover: post.cover,
    screenshots: post.screenshots,
    steamAppId: post.steamAppId,
    summary: post.summary,
    updates: post.updates,
  };
}

/**
 * The versions of a post the archive saw before its current one, newest first: one entry
 * per earlier publish date, since FitGirl re-dates a post when she updates the repack.
 */
export function earlierReleases(
  history: { publishedAt: string | null; title: string }[],
  currentPublishedAt: string | null
): EarlierRelease[] {
  const seen = new Set(currentPublishedAt ? [currentPublishedAt] : []);
  const releases: EarlierRelease[] = [];
  for (const entry of history) {
    if (!entry.publishedAt || seen.has(entry.publishedAt)) continue;
    if (currentPublishedAt && entry.publishedAt > currentPublishedAt) continue;
    seen.add(entry.publishedAt);
    const title = decodeEntities(entry.title).replace(SITE_SUFFIX, "").trim();
    releases.push({ publishedAt: entry.publishedAt, title, version: splitReleaseTitle(title).version });
  }
  return releases.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

interface ReleaseNames {
  name: string;
  edition: string | null;
  version: string | null;
  extras: string | null;
}

/**
 * "Cosmic Fear: Deluxe Edition – v1.1 + Bonus DLC" → name, edition, version and extras.
 * The post header already separates the name (bold) from the release details (gray),
 * so the title is only the fallback.
 */
export function splitReleaseTitle(
  title: string,
  headerName: string | null = null,
  headerDetails: string | null = null
): ReleaseNames {
  let name = headerName ?? "";
  let details = headerDetails;

  if (!name) {
    const split = title.match(/^(.+?)(?:\s[-–]\s|,\s(?=v\d|build\b|rev\b|r\d|update\b|patch\b|\d))(.+)$/i)
      ?? title.match(/^(.+?)\s(\+\s.+)$/);
    name = split?.[1] ?? title;
    details = split?.[2] ?? null;
  } else if (details === null && plainDashes(title).startsWith(plainDashes(name))) {
    details = title.slice(name.length).replace(/^\s*(?:[-–,]\s*)?/, "") || null;
  }

  const { base, edition: nameEdition } = splitEdition(name.trim());
  const parsed = splitDetails(details ?? "");
  return {
    name: base,
    edition: nameEdition ?? parsed.edition,
    version: parsed.version,
    extras: parsed.extras,
  };
}

/** The site's page titles use a hyphen where the post header uses an en dash. */
function plainDashes(text: string): string {
  return text.replace(/[–—]/g, "-");
}

function splitEdition(name: string): { base: string; edition: string | null } {
  const match = name.match(/^(.*?\S)(?:\s*[:–—]\s+|\s+-\s+|\s+\+\s+)([^:–—]+)$/);
  if (match && EDITION_WORDS.test(match[2])) {
    return { base: match[1].trim(), edition: match[2].trim() };
  }
  return { base: name, edition: null };
}

function splitDetails(details: string): { edition: string | null; version: string | null; extras: string | null } {
  const text = details.trim();
  if (!text) return { edition: null, version: null, extras: null };

  const plus = topLevelIndex(text, " + ");
  const head = (text.startsWith("+ ") ? "" : plus === -1 ? text : text.slice(0, plus)).trim();
  const extras = text.startsWith("+ ") ? text.slice(2).trim() : plus === -1 ? null : text.slice(plus + 3).trim();

  const comma = topLevelIndex(head, ", ");
  if (comma !== -1 && EDITION_WORDS.test(head.slice(0, comma))) {
    return {
      edition: head.slice(0, comma).trim(),
      version: head.slice(comma + 2).trim() || null,
      extras: extras || null,
    };
  }
  if (EDITION_WORDS.test(head) && !/^(?:v\d|build\b)/i.test(head)) {
    return { edition: head, version: null, extras: extras || null };
  }
  return { edition: null, version: head || null, extras: extras || null };
}

function topLevelIndex(text: string, needle: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0 && text.startsWith(needle, index)) return index;
  }
  return -1;
}

function dlcCount(extras: string | null): number | null {
  if (!extras) return null;
  const counted = extras.match(/(\d+)\s+(?:bonus\s+)?DLCs?\b/i);
  if (counted) return Number(counted[1]);
  return /\bDLC\b/i.test(extras) && !/\ball\s+DLCs\b/i.test(extras) ? 1 : null;
}

interface PostHeader {
  details: string | null;
  hypervisor: boolean;
  name: string | null;
  number: number | null;
  updated: boolean;
}

function readHeader(content: string): PostHeader {
  const header = content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "";
  const strong = header.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? null;
  const badge = plainText(strong === null ? header : header.slice(0, header.indexOf("<strong>")));
  // "#6680", "#6680 Updated"; a joke number such as "#7-1/7-1" is no number at all.
  const number = badge.match(/^#(\d+)(?=\s|$)/)?.[1];
  if (!number) {
    return { details: null, hypervisor: false, name: null, number: null, updated: false };
  }

  const detailsHtml = strong?.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? null;
  const nameHtml = strong === null ? null : detailsHtml === null ? strong : strong.slice(0, strong.search(/<span/i));
  return {
    details: detailsHtml === null ? null : plainText(detailsHtml) || null,
    hypervisor: /\bhypervisor\b/i.test(badge),
    name: nameHtml === null ? null : plainText(nameHtml) || null,
    number: Number(number),
    updated: /\bupdated\b/i.test(badge),
  };
}

function postKind(title: string, content: string, metadata: PageMetadata): GamePostKind {
  if (NOTICE_TITLE.test(title) || NOTICE_TEXT.test(content)) return "update-notice";
  return metadata.pageType === "post" && metadata.repackSize ? "release" : "other";
}

function noticeNames(title: string, content: string): ReleaseNames {
  const text = plainText(content);
  const version = text.match(/updated to (.+?)(?: and includes (.+?))?\.(?:\s|$)/i);
  return {
    name: title.replace(NOTICE_TITLE, "").trim(),
    edition: null,
    version: version?.[1]?.trim() ?? null,
    extras: version?.[2]?.trim() ?? null,
  };
}

function noticeTarget(content: string): string | null {
  for (const match of content.matchAll(/<a[^>]+href="([^"]+)"/gi)) {
    const href = decodeEntities(match[1]);
    if (/^https?:\/\/fitgirl-repacks\.site\/[^?#]+/i.test(href)) return href.replace(/^http:/i, "https:");
  }
  return null;
}

function screenshots(content: string): string[] {
  const section = sectionHtml(content, /Screenshots/i);
  const sources = section === null
    ? extractScreenshots(content)
    : [...section.matchAll(/<img[^>]+src="([^"]+)"/gi)].map(match => decodeEntities(match[1]));
  return [...new Set(sources.map(fullSizeScreenshot).filter((url): url is string => url !== null))];
}

function fullSizeScreenshot(url: string): string | null {
  return httpsImage(url.replace(/\.240p\.jpg$/i, ""));
}

function httpsImage(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  // WordPress's image proxy serves a 150 × 200 thumbnail unless asked for the original.
  return url.replace(SCREENSHOT_HOSTS_HTTPS, "https://$1/").replace(/^(https:\/\/i\d\.wp\.com\/[^?#]+)[?#].*$/i, "$1");
}

function trailers(content: string): string[] {
  const sources = [...content.matchAll(/<source[^>]+src="([^"]+)"/gi)].map(match => decodeEntities(match[1]));
  return [...new Set(sources.filter(url => /^https:\/\//i.test(url)))];
}

function steamAppId(content: string): number | null {
  const match = content.match(/store_trailers\/(\d+)\//)
    ?? content.match(/store\.steampowered\.com\/app\/(\d+)/)
    ?? content.match(/steamstatic\.com\/(?:store_item_assets\/)?steam\/apps\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

function repackFacts(features: string[], content: string, repackSize: string | null): RepackFacts {
  const find = (pattern: RegExp) => {
    for (const line of features) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };

  const selectiveDownload =
    /selective download/i.test(repackSize ?? "") || features.some(line => /^selective download/i.test(line));
  return {
    basedOn: find(/^Based on (.+)$/i),
    download: downloadRange(features, repackSize),
    installSize: find(/^HDD space after installation:\s*(?:up to\s*)?(.+)$/i),
    installTime: find(/^Installation (?:is .*?)?takes\s+(.+?)(?:\s*\((?:depending|depends)[^)]*\))?$/i),
    memory: find(/^At least ([\d.]+\s*[GM]B) of free RAM/i),
    lossless: features.some(line => /100% Lossless/i.test(line)),
    selectiveDownload,
    optionalParts: selectiveDownload ? optionalParts(content) : [],
    features,
  };
}

/** "compressed from 113.1 to 32.7~44.3 GB" or the post's "from 38.8 GB" / "7.6/7.8 GB". */
export function downloadRange(features: string[], repackSize: string | null): SizeRange | null {
  for (const line of features) {
    const match = line.match(/compressed from .+? to ([\d.,]+)\s*([KMGT]B)?\s*(?:[~/]\s*([\d.,]+)\s*([KMGT]B)?)?/i);
    if (match) {
      const unit = match[4] ?? match[2] ?? "GB";
      return {
        min: `${match[1]} ${(match[2] ?? unit).toUpperCase()}`,
        max: match[3] ? `${match[3]} ${unit.toUpperCase()}` : null,
      };
    }
  }

  const size = decodeEntities(repackSize ?? "").replace(/\[[^\]]*\]/g, "").trim();
  const match = size.match(/^(?:from\s+)?([\d.,]+)\s*(?:([KMGT]B)\s*)?(?:\/\s*([\d.,]+)\s*)?([KMGT]B)/i);
  if (!match) return null;
  const unit = match[4].toUpperCase();
  return {
    min: `${match[1]} ${(match[2] ?? unit).toUpperCase()}`,
    max: match[3]
      ? `${match[3]} ${unit}`
      : /^from\s/i.test(size)
        ? null
        : `${match[1]} ${(match[2] ?? unit).toUpperCase()}`,
  };
}

/**
 * The parts a Selective Download repack lets you skip: the post's "Selective Download"
 * list when it has one, otherwise the optional file names its download lists carry.
 */
function optionalParts(content: string): OptionalPart[] {
  const section = spoilerContent(content, /^Selective Download$/i);
  if (section !== null) {
    return listItems(section).map(item => {
      const files = [...new Set(item.match(OPTIONAL_FILE) ?? [])];
      const note = item.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() ?? null;
      const label = files.length > 0 ? optionalLabel(files[0]) : item.replace(/\s*\([^)]*\)\s*$/, "");
      return { label, files, note };
    });
  }

  const parts = new Map<string, Set<string>>();
  for (const file of decodeEntities(content).match(OPTIONAL_FILE) ?? []) {
    const label = optionalLabel(file);
    parts.set(label, (parts.get(label) ?? new Set()).add(file));
  }
  return [...parts].map(([label, files]) => ({ label, files: [...files].sort(), note: null }));
}

/** "fg-optional-japanese-videos.part2.rar" → "japanese videos". */
function optionalLabel(file: string): string {
  return file
    .replace(/^fg-(?:optional|selective)-/i, "")
    .replace(/(?:\.part\d+\.rar|\.bin)$/i, "")
    .replace(/-\d+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

interface Description {
  dlcs: string[];
  text: string[];
}

function descriptionBlocks(content: string): Description {
  const dlcs: string[] = [];
  const dlcList = /<(?:b|strong)>\s*(Included[^<]*?)\s*<\/(?:b|strong)>\s*(?:<\/p>)?\s*(?:<br\s*\/?>)?\s*<ul>([\s\S]*?)<\/ul>/gi;
  for (const match of content.matchAll(dlcList)) {
    dlcs.push(...listItems(match[2]));
  }

  const spoiler = spoilerContent(content, /^Game Description$/i);
  if (spoiler === null) return { dlcs, text: [] };

  const text = spoiler
    .replace(dlcList, "")
    .split(/<\/?p[^>]*>|<br\s*\/?>|<\/?li[^>]*>|<\/?ul[^>]*>/i)
    .map(plainText)
    .filter(block => block.length > 0);
  return { dlcs: [...new Set(dlcs)], text };
}

function shortText(blocks: string[]): string | null {
  const text = blocks.join(" ").trim();
  if (!text) return null;
  if (text.length <= SUMMARY_LENGTH) return text;

  const cut = text.slice(0, SUMMARY_LENGTH);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

function entryContent(html: string): string {
  const start = html.indexOf('<div class="entry-content">');
  if (start === -1) return html;
  const end = html.indexOf("<!-- .entry-content -->", start);
  return html.slice(start, end === -1 ? undefined : end);
}

/** The HTML after an h3 whose text matches `heading`, up to the next h3. */
function sectionHtml(content: string, heading: RegExp): string | null {
  for (const match of content.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) {
    if (!heading.test(plainText(match[1]))) continue;
    const start = (match.index ?? 0) + match[0].length;
    const next = content.slice(start).search(/<h3[^>]*>/i);
    return content.slice(start, next === -1 ? undefined : start + next);
  }
  return null;
}

function sectionList(content: string, heading: string): string {
  const section = sectionHtml(content, new RegExp(`^${heading}$`, "i"));
  return section?.match(/<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
}

/** The body of the first collapsed block ("spoiler") whose title matches. */
function spoilerContent(content: string, title: RegExp): string | null {
  const spoilers =
    /<div class="su-spoiler-title"[^>]*>(?:<span[^>]*><\/span>)?([\s\S]*?)<\/div><div class="su-spoiler-content[^"]*">([\s\S]*?)<\/div><\/div>/gi;
  for (const match of content.matchAll(spoilers)) {
    if (title.test(plainText(match[1]))) return match[2];
  }
  return null;
}

function listItems(html: string): string[] {
  return html
    .split(/<li[^>]*>/i)
    .slice(1)
    .map(item => plainText(item.replace(/<\/li>[\s\S]*$/i, "")))
    .filter(item => item.length > 0);
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}
