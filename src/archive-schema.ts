import { Database } from "bun:sqlite";

export function migrateArchiveSchema(db: Database): void {
  db.run("pragma journal_mode = WAL");
  db.run("pragma busy_timeout = 5000");
  db.run("pragma foreign_keys = ON");

  db.run(`
    create table if not exists pages (
      url text primary key,
      first_seen_at text not null,
      last_checked_at text not null,
      sitemap_last_modified text,
      latest_snapshot_id integer
    )
  `);
  addColumnIfMissing(db, "pages", "sitemap_last_modified text");

  db.run(`
    create table if not exists snapshots (
      id integer primary key autoincrement,
      url text not null references pages(url),
      fetched_at text not null,
      status integer not null,
      content_type text,
      etag text,
      last_modified text,
      content_hash text not null,
      html_path text not null,
      title text not null,
      text_content text not null default '',
      metadata_json text not null default '{}',
      unique(url, content_hash)
    )
  `);
  addColumnIfMissing(db, "snapshots", "text_content text not null default ''");
  addColumnIfMissing(db, "snapshots", "metadata_json text not null default '{}'");

  db.run(`
    create table if not exists snapshot_links (
      snapshot_id integer not null references snapshots(id) on delete cascade,
      url text not null,
      primary key (snapshot_id, url)
    )
  `);

  db.run(`
    create table if not exists assets (
      url text primary key,
      first_seen_at text not null,
      last_checked_at text,
      fetched_at text,
      http_status integer,
      content_type text,
      content_hash text,
      local_path text,
      size_bytes integer default 0
    )
  `);
  renameColumnIfPresent(db, "assets", "status", "http_status");

  db.run(`
    create table if not exists snapshot_assets (
      snapshot_id integer not null references snapshots(id) on delete cascade,
      asset_url text not null references assets(url),
      kind text not null,
      source text not null,
      primary key (snapshot_id, asset_url)
    )
  `);

  db.run(`
    create table if not exists crawl_queue (
      url text primary key,
      source text not null,
      status text not null default 'pending',
      priority integer not null default 0,
      sitemap_last_modified text,
      discovered_at text not null,
      updated_at text not null,
      attempts integer not null default 0,
      last_error text,
      next_attempt_at text,
      last_started_at text,
      last_finished_at text
    )
  `);
  db.run(`
    create table if not exists archive_runs (
      id integer primary key autoincrement,
      kind text not null,
      command text not null,
      status text not null,
      started_at text not null,
      finished_at text,
      summary_json text,
      error text
    )
  `);
  db.run("create virtual table if not exists snapshot_search using fts5(title, url, body)");
  db.run(
    `insert or replace into snapshot_search(rowid, title, url, body)
     select id, title, url, text_content from snapshots`
  );

  db.run("create index if not exists snapshots_url_id_idx on snapshots(url, id desc)");
  db.run("create index if not exists snapshot_assets_kind_idx on snapshot_assets(kind)");
  db.run("create index if not exists snapshot_links_url_idx on snapshot_links(url)");
  db.run("create index if not exists crawl_queue_status_idx on crawl_queue(status, priority desc)");
  db.run("create index if not exists archive_runs_started_idx on archive_runs(started_at desc)");
}

function addColumnIfMissing(db: Database, table: string, definition: string): void {
  try {
    db.run(`alter table ${table} add column ${definition}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
      throw error;
    }
  }
}

function renameColumnIfPresent(db: Database, table: string, from: string, to: string): void {
  const columns = tableColumns(db, table);
  if (!columns.includes(from) || columns.includes(to)) return;
  db.run(`alter table ${table} rename column ${from} to ${to}`);
}

function tableColumns(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`pragma table_info(${table})`).all().map(column => column.name);
}
