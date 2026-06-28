import { readFile } from "fs/promises";
import { join, resolve, sep } from "path";
import { openArchiveStore } from "./archive-store";
import { extractPageReferences } from "./page-extract";

const DEFAULT_ARCHIVE_DIR = "archive";
const DEFAULT_LIMIT = 0;

interface BackfillSnapshotsOptions {
  archiveDir: string;
  limit: number;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const options = parseOptions(args);
  const archiveRoot = resolve(options.archiveDir);
  const store = await openArchiveStore(join(options.archiveDir, "fitgirl.sqlite"));
  const runId = store.startRun({
    command: formatCommand("bun run snapshots:backfill", args),
    kind: "snapshot-backfill",
  });

  let refreshedCount = 0;
  let skippedCount = 0;

  try {
    const snapshots = store.getSnapshotsForBackfill(options.limit);

    for (const snapshot of snapshots) {
      const path = resolveStoredPath(snapshot.htmlPath, archiveRoot);
      if (!path) {
        skippedCount++;
        continue;
      }

      try {
        const references = await extractPageReferences(await readFile(path, "utf-8"), snapshot.url);
        store.saveSnapshotExtraction(snapshot.id, {
          metadata: references.metadata,
          textContent: references.textContent,
          title: references.title,
        });
        store.saveSnapshotReferences(snapshot.id, references.links, references.assets);
        refreshedCount++;
      } catch (error) {
        skippedCount++;
        console.error(`Snapshot backfill failed for snapshot ${snapshot.id}`, error);
      }
    }

    console.log(`Snapshots: ${refreshedCount} refreshed, ${skippedCount} skipped.`);
    store.finishRun(runId, {
      status: "success",
      summary: {
        refreshedCount,
        selectedSnapshots: snapshots.length,
        skippedCount,
      },
    });
  } catch (error) {
    store.finishRun(runId, {
      error,
      status: "failed",
      summary: { refreshedCount, skippedCount },
    });
    throw error;
  } finally {
    store.close();
  }
}

function parseOptions(args: string[]): BackfillSnapshotsOptions {
  return {
    archiveDir: readStringFlag(args, "--archive", DEFAULT_ARCHIVE_DIR),
    limit: readNumberFlag(args, "--limit", DEFAULT_LIMIT),
  };
}

function readStringFlag(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const raw = readStringFlag(args, name, String(fallback));
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a positive integer or 0`);
  }

  return value;
}

function resolveStoredPath(storedPath: string, archiveRoot: string): string | null {
  const path = resolve(process.cwd(), storedPath);
  return path === archiveRoot || path.startsWith(`${archiveRoot}${sep}`) ? path : null;
}

function formatCommand(baseCommand: string, args: string[]): string {
  const suffix = args.map(arg => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
  return suffix ? `${baseCommand} -- ${suffix}` : baseCommand;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
