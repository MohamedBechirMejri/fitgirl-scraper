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
  const missingPageRoute = options.missingPageRoute ?? localPageRoute;
  const pageRoutes = options.pageRoutes ?? new Map<string, string>();
  const assetRoutes = new Map(assets.filter(asset => asset.kind !== "other").map(asset => [asset.url, assetRoute(asset.url)]));

  const rewriteAsset = (rawUrl: string | null): string | null => {
    if (!rawUrl) return null;

    const url = normalizeUrl(rawUrl, pageUrl);
    return url ? assetRoutes.get(url) ?? null : null;
  };
  const rewriteCss = (css: string): string => rewriteCssAssetReferences(css, pageUrl, url => assetRoutes.get(url) ?? null);

  const rewritten = await new HTMLRewriter()
    .on("a[href]", {
      element(element) {
        const url = normalizeUrl(element.getAttribute("href") ?? "", pageUrl);
        if (url && isFitGirlUrl(url)) {
          element.setAttribute("href", pageRoutes.get(url) ?? missingPageRoute(url));
        }
      },
    })
    .on("img[src], script[src], video[src], audio[src], source[src], iframe[src]", {
      element(element) {
        const src = rewriteAsset(element.getAttribute("src"));
        if (src) element.setAttribute("src", src);
      },
    })
    .on("link[href]", {
      element(element) {
        const href = rewriteAsset(element.getAttribute("href"));
        if (href) element.setAttribute("href", href);
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
        const srcset = rewriteSrcset(element.getAttribute("srcset"), pageUrl, assetRoutes);
        if (srcset) element.setAttribute("srcset", srcset);
      },
    })
    .transform(new Response(html))
    .text();

  return rewritten;
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

function rewriteSrcset(srcset: string | null, pageUrl: string, assetRoutes: Map<string, string>): string | null {
  if (!srcset) return null;

  return srcset
    .split(",")
    .map(item => {
      const parts = item.trim().split(/\s+/);
      const url = normalizeUrl(parts[0] ?? "", pageUrl);
      if (url) {
        parts[0] = assetRoutes.get(url) ?? parts[0];
      }

      return parts.join(" ");
    })
    .join(", ");
}
