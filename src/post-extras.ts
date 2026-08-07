const IMG_SRC = /<img[^>]+src="([^"]+)"/g;
const SCREENSHOT_SRC = /<img[^>]+src="(http[^"]*riotpixels[^"]+\.240p\.jpg)"/g;
const NUMERIC_ENTITY = /&#(\d+);/g;

export function extractCoverUrl(html: string): string | null {
  for (const match of html.matchAll(IMG_SRC)) {
    const src = match[1] ?? "";
    if (src.includes("torrent-stats") || src.includes("fitgirl-repacks.site/wp-content")) {
      continue;
    }
    return src;
  }
  return null;
}

export function extractScreenshots(html: string): string[] {
  const screenshots: string[] = [];
  for (const match of html.matchAll(SCREENSHOT_SRC)) {
    const src = match[1];
    if (src && !screenshots.includes(src)) {
      screenshots.push(src);
    }
  }
  return screenshots;
}

function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY, (_, code: string) => String.fromCharCode(Number(code)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

export function extractDescription(textContent: string, maxLength = 420): string | null {
  const marker = "Game Description";
  const start = textContent.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const clean = decodeEntities(textContent.slice(start + marker.length).trim());
  if (clean.length === 0) {
    return null;
  }
  if (clean.length <= maxLength) {
    return clean;
  }

  const cut = clean.slice(0, maxLength);
  const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastSentenceEnd > 120 ? cut.slice(0, lastSentenceEnd + 1) : `${cut.trimEnd()}…`;
}
