import { isFitGirlUrl } from "./page-extract";

export type LinkKind = "internal" | "download" | "torrent" | "external";

export interface ClassifiedLink {
  kind: LinkKind;
  url: string;
}

export interface LinkGroup {
  kind: LinkKind;
  title: string;
  links: ClassifiedLink[];
}

const GROUPS: Record<LinkKind, string> = {
  download: "Downloads",
  external: "External",
  internal: "Archive Pages",
  torrent: "Torrents & Magnets",
};

const ORDER: LinkKind[] = ["download", "torrent", "internal", "external"];
const DOWNLOAD_HOST_PARTS = [
  "1fichier",
  "buzzheavier",
  "datanodes",
  "ddownload",
  "filecrypt",
  "fuckingfast",
  "gofile",
  "katfile",
  "mediafire",
  "mega.nz",
  "multiup",
  "multiupload",
  "pixeldrain",
  "qiwi",
  "rapidgator",
  "send.cm",
  "turbobit",
];
const TORRENT_HOST_PARTS = ["1337x", "rutor", "tapochek", "torrent"];

export function classifyLink(url: string): LinkKind {
  const lower = url.toLowerCase();
  if (lower.startsWith("magnet:?")) return "torrent";
  if (isFitGirlUrl(url)) return "internal";

  const host = hostname(url);
  if (!host) return "external";
  if (TORRENT_HOST_PARTS.some(part => host.includes(part)) || lower.includes(".torrent")) return "torrent";
  if (DOWNLOAD_HOST_PARTS.some(part => host.includes(part))) return "download";
  if (host === "drive.google.com" || host.endsWith(".drive.google.com")) return "download";

  return "external";
}

export function groupLinks(urls: string[]): LinkGroup[] {
  const groups = new Map<LinkKind, ClassifiedLink[]>();

  for (const url of urls) {
    const kind = classifyLink(url);
    groups.set(kind, [...(groups.get(kind) ?? []), { kind, url }]);
  }

  return ORDER.flatMap(kind => {
    const links = groups.get(kind) ?? [];
    return links.length === 0 ? [] : [{ kind, links, title: GROUPS[kind] }];
  });
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
