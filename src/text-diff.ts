export interface TextDiff {
  added: string[];
  removed: string[];
  sharedPrefix: string[];
  sharedSuffix: string[];
}

export function diffText(before: string, after: string): TextDiff {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  let prefixLength = 0;

  while (
    prefixLength < beforeTokens.length &&
    prefixLength < afterTokens.length &&
    beforeTokens[prefixLength] === afterTokens[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeTokens.length - prefixLength &&
    suffixLength < afterTokens.length - prefixLength &&
    beforeTokens[beforeTokens.length - 1 - suffixLength] === afterTokens[afterTokens.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  return {
    added: afterTokens.slice(prefixLength, afterTokens.length - suffixLength),
    removed: beforeTokens.slice(prefixLength, beforeTokens.length - suffixLength),
    sharedPrefix: beforeTokens.slice(Math.max(0, prefixLength - 30), prefixLength),
    sharedSuffix: beforeTokens.slice(beforeTokens.length - suffixLength, beforeTokens.length - suffixLength + 30),
  };
}

export function summarizeDiff(diff: TextDiff): string {
  return `${diff.removed.length} removed, ${diff.added.length} added`;
}

function tokenize(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}
