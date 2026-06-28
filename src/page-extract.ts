import { extractCssAssetReferences } from "./css-assets";

export type AssetKind = "image" | "script" | "stylesheet" | "icon" | "media" | "other";

export interface AssetReference {
  kind: AssetKind;
  source: string;
  url: string;
}

export interface PageReferences {
  assets: AssetReference[];
  links: string[];
  metadata: PageMetadata;
  textContent: string;
  title: string;
}

export interface PageMetadata {
  companies: string[];
  filehosterCount: number;
  genres: string[];
  languages: string | null;
  magnetCount: number;
  modifiedAt: string | null;
  originalSize: string | null;
  pageType: "collection" | "post" | "unknown";
  publishedAt: string | null;
  repackSize: string | null;
}

export interface SitemapEntry {
  lastModified: string | null;
  url: string;
}

export function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  const trimmed = decodeHtmlAttribute(rawUrl.trim());
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }

  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function extractSitemapUrls(xml: string, baseUrl: string): string[] {
  return extractSitemapEntries(xml, baseUrl).map(entry => entry.url);
}

export function extractSitemapEntries(xml: string, baseUrl: string): SitemapEntry[] {
  const entries = new Map<string, SitemapEntry>();
  const blocks = [...xml.matchAll(/<(?:url|sitemap)>\s*([\s\S]*?)\s*<\/(?:url|sitemap)>/gi)];

  for (const block of blocks) {
    const loc = block[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!loc) continue;

    const url = normalizeUrl(decodeXml(loc), baseUrl);
    if (!url) continue;

    entries.set(url, {
      lastModified: block[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null,
      url,
    });
  }

  return [...entries.values()].sort((left, right) => left.url.localeCompare(right.url));
}

export function isFitGirlUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "fitgirl-repacks.site";
  } catch {
    return false;
  }
}

export async function extractPageReferences(html: string, pageUrl: string): Promise<PageReferences> {
  const links = new Set<string>();
  const assets = new Map<string, AssetReference>();
  let bodyClass = "";
  const titleParts: string[] = [];
  const textParts: string[] = [];

  const addLink = (rawUrl: string | null): void => {
    if (!rawUrl) return;

    const url = normalizePageLink(rawUrl, pageUrl);
    if (url) links.add(url);
  };

  const addAsset = (rawUrl: string | null, kind: AssetKind, source: string): void => {
    if (!rawUrl) return;

    const url = normalizeUrl(rawUrl, pageUrl);
    if (url) assets.set(`${kind}:${url}`, { kind, source, url });
  };

  const addCssAssets = (css: string | null, source: string): void => {
    if (!css) return;

    for (const reference of extractCssAssetReferences(css, pageUrl)) {
      addAsset(reference.url, cssAssetKind(reference.url, reference.source), `${source}:${reference.source}`);
    }
  };

  await new HTMLRewriter()
    .on("title", {
      text(text) {
        titleParts.push(text.text);
      },
    })
    .on("body", {
      element(element) {
        bodyClass = element.getAttribute("class") ?? "";
      },
      text(text) {
        textParts.push(text.text);
      },
    })
    .on("a[href]", {
      element(element) {
        addLink(element.getAttribute("href"));
      },
    })
    .on("img[src]", {
      element(element) {
        addAsset(element.getAttribute("src"), "image", "img[src]");
      },
    })
    .on("img[srcset], source[srcset]", {
      element(element) {
        for (const url of parseSrcset(element.getAttribute("srcset"))) {
          addAsset(url, "image", "srcset");
        }
      },
    })
    .on("script[src]", {
      element(element) {
        addAsset(element.getAttribute("src"), "script", "script[src]");
      },
    })
    .on("link[href]", {
      element(element) {
        const rel = element.getAttribute("rel") ?? "";
        addAsset(element.getAttribute("href"), linkRelToAssetKind(rel, element.getAttribute("as")), "link[href]");
      },
    })
    .on("meta[content]", {
      element(element) {
        const name = `${element.getAttribute("property") ?? ""} ${element.getAttribute("name") ?? ""}`.toLowerCase();
        if (name.includes("image")) {
          addAsset(element.getAttribute("content"), "image", "meta[content]");
        }
      },
    })
    .on("style", {
      text(text) {
        addCssAssets(text.text, "style");
      },
    })
    .on("[style]", {
      element(element) {
        addCssAssets(element.getAttribute("style"), "style[attr]");
      },
    })
    .on("video[src], audio[src], source[src]", {
      element(element) {
        addAsset(element.getAttribute("src"), "media", "media[src]");
      },
    })
    .on("iframe[src]", {
      element(element) {
        addAsset(element.getAttribute("src"), "media", "iframe[src]");
      },
    })
    .on("video[poster]", {
      element(element) {
        addAsset(element.getAttribute("poster"), "image", "video[poster]");
      },
    })
    .transform(new Response(html))
    .text();

  const textContent = normalizeText(textParts.join(" "));

  return {
    assets: [...assets.values()].sort((left, right) => left.url.localeCompare(right.url)),
    links: [...links].sort(),
    metadata: extractPageMetadata(html, textContent, bodyClass),
    textContent,
    title: normalizeText(titleParts.join("")),
  };
}

export function normalizePageLink(rawUrl: string, baseUrl: string): string | null {
  const trimmed = decodeHtmlAttribute(rawUrl.trim());
  if (trimmed.toLowerCase().startsWith("magnet:?")) return trimmed;
  return normalizeUrl(trimmed, baseUrl);
}

export function emptyPageMetadata(pageType: PageMetadata["pageType"] = "unknown"): PageMetadata {
  return {
    companies: [],
    filehosterCount: 0,
    genres: [],
    languages: null,
    magnetCount: 0,
    modifiedAt: null,
    originalSize: null,
    pageType,
    publishedAt: null,
    repackSize: null,
  };
}

function parseSrcset(srcset: string | null): string[] {
  if (!srcset) return [];

  return srcset
    .split(",")
    .map(item => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function linkRelToAssetKind(rel: string, asValue: string | null): AssetKind {
  const parts = rel.toLowerCase().split(/\s+/);
  const as = asValue?.toLowerCase() ?? "";

  if (parts.includes("stylesheet")) return "stylesheet";
  if (parts.includes("icon") || parts.includes("apple-touch-icon")) return "icon";
  if (as === "image") return "image";
  if (as === "script") return "script";
  if (as === "style") return "stylesheet";
  if (parts.includes("preload") || parts.includes("modulepreload")) return "other";

  return "other";
}

function cssAssetKind(url: string, source: string): AssetKind {
  if (source === "css-import") return "stylesheet";

  const pathname = new URL(url).pathname.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/.test(pathname)) return "image";
  if (/\.(mp4|webm|mp3|ogg|wav)$/.test(pathname)) return "media";
  if (pathname.endsWith(".css")) return "stylesheet";

  return "other";
}

function decodeXml(value: string): string {
  return decodeHtmlAttribute(value);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractPageMetadata(html: string, textContent: string, bodyClass: string): PageMetadata {
  if (bodyClass.includes("home") || bodyClass.includes("blog") || bodyClass.includes("archive")) {
    return emptyPageMetadata("collection");
  }

  if (!bodyClass.includes("single-post")) {
    return emptyPageMetadata();
  }

  // ponytail: FitGirl posts expose these labels as visible text; upgrade only if the theme changes.
  return {
    companies: splitList(readAnyField(textContent, ["Companies:", "Company:"], ["Languages:", "Language:", "Original Size:"])),
    filehosterCount: countMatches(textContent, /Filehoster:/g),
    genres: splitList(readField(textContent, "Genres/Tags:", ["Companies:", "Company:", "Languages:", "Language:"])),
    languages: readField(textContent, "Languages:", ["Original Size:"]) ?? readField(textContent, "Language:", ["Original Size:"]),
    magnetCount: countMatches(html, /href=["']magnet:/gi),
    modifiedAt: readJsonString(html, "dateModified"),
    originalSize: readField(textContent, "Original Size:", ["Repack Size:"]),
    pageType: "post",
    publishedAt: readJsonString(html, "datePublished"),
    repackSize: readField(textContent, "Repack Size:", ["Download Mirrors", "Screenshots", "Game Description"]),
  };
}

function readAnyField(text: string, labels: string[], nextLabels: string[]): string | null {
  for (const label of labels) {
    const value = readField(text, label, nextLabels);
    if (value) return value;
  }
  return null;
}

function readField(text: string, label: string, nextLabels: string[]): string | null {
  const start = text.indexOf(label);
  if (start === -1) return null;

  const rest = text.slice(start + label.length);
  const end = nextLabels
    .map(nextLabel => rest.indexOf(nextLabel))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0];

  return cleanMetadataValue(rest.slice(0, end ?? rest.length));
}

function cleanMetadataValue(value: string): string | null {
  const cleaned = decodeHtmlAttribute(value).replace(/\s+/g, " ").replace(/^[\s:,-]+|[\s:,-]+$/g, "");
  return cleaned || null;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function readJsonString(html: string, key: string): string | null {
  return html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function normalizeText(value: string): string {
  return decodeHtmlAttribute(value).replace(/\s+/g, " ").trim();
}
