import { normalizeUrl } from "./page-extract";

export interface CssAssetReference {
  source: "css-import" | "css-url";
  url: string;
}

export function extractCssAssetReferences(css: string, baseUrl: string): CssAssetReference[] {
  const references = new Map<string, CssAssetReference>();

  for (const match of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi)) {
    const url = normalizeUrl(match[1], baseUrl);
    if (url) references.set(`css-import:${url}`, { source: "css-import", url });
  }

  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const url = normalizeUrl(match[1], baseUrl);
    if (url) references.set(`css-url:${url}`, { source: "css-url", url });
  }

  return [...references.values()].sort((left, right) => left.url.localeCompare(right.url));
}

export function rewriteCssAssetReferences(
  css: string,
  baseUrl: string,
  toLocalUrl: (url: string) => string | null
): string {
  return css
    .replace(/@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi, (match, rawUrl: string) => {
      const url = normalizeUrl(rawUrl, baseUrl);
      const localUrl = url ? toLocalUrl(url) : null;
      return localUrl ? `@import url("${localUrl}")` : match;
    })
    .replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, rawUrl: string) => {
      if (rawUrl.startsWith("/asset?")) return match;

      const url = normalizeUrl(rawUrl, baseUrl);
      const localUrl = url ? toLocalUrl(url) : null;
      return localUrl ? `url("${localUrl}")` : match;
    });
}
