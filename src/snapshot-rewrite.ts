import { isFitGirlUrl, normalizeUrl } from "./page-extract";
import { rewriteCssAssetReferences } from "./css-assets";
import type { AssetKind } from "./page-extract";

export interface RewriteAsset {
  kind?: AssetKind;
  localPath: string | null;
  url: string;
}

export interface RewriteRoutes {
  assetRoute?: (url: string) => string;
  missingAssetRoute?: (url: string) => string | null;
  missingPageRoute?: (url: string) => string;
  pageRoutes?: Map<string, string>;
}

export async function rewriteSnapshotHtml(
  html: string,
  pageUrl: string,
  assets: RewriteAsset[],
  routes: Map<string, string> | RewriteRoutes = new Map<string, string>()
): Promise<string> {
  const options = routes instanceof Map ? { pageRoutes: routes } : routes;
  const assetRoute = options.assetRoute ?? localAssetRoute;
  const missingAssetRoute = options.missingAssetRoute ?? (() => null);
  const missingPageRoute = options.missingPageRoute ?? localPageRoute;
  const pageRoutes = options.pageRoutes ?? new Map<string, string>();
  const assetRoutes = new Map(
    assets.filter(asset => asset.kind !== "other" || asset.localPath).map(asset => [asset.url, assetRoute(asset.url)])
  );

  const rewriteAsset = (rawUrl: string | null): string | null => {
    if (!rawUrl) return null;

    const url = normalizeUrl(rawUrl, pageUrl);
    return url ? assetRoutes.get(url) ?? missingAssetRoute(url) : null;
  };
  const rewriteCss = (css: string): string =>
    rewriteCssAssetReferences(css, pageUrl, url => assetRoutes.get(url) ?? missingAssetRoute(url));

  const rewritten = await new HTMLRewriter()
    .on("a[href]", {
      element(element) {
        const href = rewritePageHref(element.getAttribute("href"), pageUrl, pageRoutes, missingPageRoute);
        if (href) element.setAttribute("href", href);
      },
    })
    .on("img[src], script[src], video[src], audio[src], source[src], iframe[src]", {
      element(element) {
        const src = rewriteAsset(element.getAttribute("src"));
        if (src) element.setAttribute("src", src);
      },
    })
    .on("video[poster]", {
      element(element) {
        const poster = rewriteAsset(element.getAttribute("poster"));
        if (poster) element.setAttribute("poster", poster);
      },
    })
    .on("link[href]", {
      element(element) {
        const href = rewriteAsset(element.getAttribute("href"));
        if (href) element.setAttribute("href", href);
      },
    })
    .on("meta[content]", {
      element(element) {
        const name = `${element.getAttribute("property") ?? ""} ${element.getAttribute("name") ?? ""}`.toLowerCase();
        const content = name.includes("image") ? rewriteAsset(element.getAttribute("content")) : null;
        if (content) element.setAttribute("content", content);
      },
    })
    .on("[style]", {
      element(element) {
        const style = element.getAttribute("style");
        if (style) element.setAttribute("style", rewriteCss(style));
      },
    })
    .on("style", {
      text(text) {
        if (text.text) text.replace(rewriteCss(text.text));
      },
    })
    .on("img[srcset], source[srcset]", {
      element(element) {
        const srcset = rewriteSrcset(element.getAttribute("srcset"), pageUrl, assetRoutes, missingAssetRoute);
        if (srcset) element.setAttribute("srcset", srcset);
      },
    })
    .transform(new Response(html))
    .text();

  return rewriteSameSiteLiterals(rewritten);
}

export function localAssetRoute(url: string): string {
  return `/asset?url=${encodeURIComponent(url)}`;
}

export function localMirrorRoute(url: string): string {
  if (!isFitGirlUrl(url)) return localAssetRoute(url);

  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function localPageRoute(url: string): string {
  return `/page?url=${encodeURIComponent(url)}`;
}

function rewriteSameSiteLiterals(html: string): string {
  return html.replace(/https?:\/\/fitgirl-repacks\.site(?=\/|[?#"'])/g, "");
}

function rewritePageHref(
  rawHref: string | null,
  pageUrl: string,
  pageRoutes: Map<string, string>,
  missingPageRoute: (url: string) => string
): string | null {
  if (!rawHref || rawHref.trim().startsWith("#")) return null;

  const url = normalizeUrl(rawHref, pageUrl);
  if (!url || !isFitGirlUrl(url)) return null;

  let hash = "";
  try {
    hash = new URL(rawHref, pageUrl).hash;
  } catch {
    // Hash is nice-to-have; normalizeUrl already proved the link is usable.
  }

  return `${pageRoutes.get(url) ?? missingPageRoute(url)}${hash}`;
}

function rewriteSrcset(
  srcset: string | null,
  pageUrl: string,
  assetRoutes: Map<string, string>,
  missingAssetRoute: (url: string) => string | null
): string | null {
  if (!srcset) return null;

  return srcset
    .split(",")
    .map(item => {
      const parts = item.trim().split(/\s+/);
      const url = normalizeUrl(parts[0] ?? "", pageUrl);
      if (url) {
        parts[0] = assetRoutes.get(url) ?? missingAssetRoute(url) ?? parts[0];
      }

      return parts.join(" ");
    })
    .join(", ");
}
