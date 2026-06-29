export interface LayoutInput {
  body: string;
  script?: string;
  title: string;
}

export function layout({ body, script = "", title }: LayoutInput): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f5f5f3; color: #171717; }
          main { width: min(72rem, calc(100vw - 2rem)); margin: 0 auto; padding: 1.25rem 0 3rem; }
          h1 { margin: 0 0 .5rem; font-size: 1.75rem; line-height: 1.15; }
          h2 { margin-top: 2rem; font-size: 1.1rem; }
          a { color: #0f5c8c; text-decoration-thickness: .08em; }
          small { display: block; margin-top: .25rem; color: #6b6b6b; font-size: .78rem; overflow-wrap: anywhere; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #deded8; }
          th, td { padding: .7rem .8rem; border-bottom: 1px solid #ecece6; text-align: left; vertical-align: top; }
          th { font-size: .78rem; text-transform: uppercase; color: #62625c; background: #fbfbf8; }
          code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; }
          .search { display: grid; grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(8rem, 1fr)) auto auto; gap: .5rem; margin-bottom: 1rem; }
          input, select, button, .button { border: 1px solid #c9c9c1; border-radius: 6px; font: inherit; }
          input, select { min-width: 0; padding: .75rem .85rem; background: #fff; }
          button, .button { display: inline-block; padding: .75rem 1rem; background: #171717; color: #fff; text-decoration: none; }
          .button.secondary { background: #fff; color: #171717; }
          .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1rem; }
          .stats div { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: .8rem; }
          .stats dt { color: #62625c; font-size: .8rem; }
          .stats dd { margin: .15rem 0 0; font-size: 1.35rem; font-weight: 700; }
          .run-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
          .run-strip div { min-width: 0; padding: .8rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .run-strip dt { color: #62625c; font-size: .78rem; }
          .run-strip dd { margin: .15rem 0 0; font-weight: 700; }
          .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem .75rem; }
          .meta-grid div { min-width: 0; padding: .65rem .75rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .meta-grid dt { color: #62625c; font-size: .78rem; }
          .meta-grid dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
          .page-head { margin-bottom: 1.25rem; }
          .source { overflow-wrap: anywhere; }
          .page-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1.25rem; }
          .page-nav a { display: block; min-width: 0; padding: .75rem .85rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; text-decoration: none; overflow-wrap: anywhere; }
          .page-nav span { display: block; margin-bottom: .25rem; color: #62625c; font-size: .78rem; text-transform: uppercase; }
          .links { columns: 2 24rem; padding-left: 1.1rem; }
          .links li { break-inside: avoid; margin-bottom: .35rem; overflow-wrap: anywhere; }
          .link-status { display: inline-block; margin-left: .4rem; padding: .1rem .35rem; border-radius: 4px; background: #ecece6; color: #4b4b45; font-size: .72rem; text-transform: uppercase; vertical-align: .08rem; }
          .link-group { margin-bottom: .75rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .link-group summary { cursor: pointer; padding: .75rem .9rem; font-weight: 700; }
          .link-group summary span { color: #62625c; font-weight: 400; }
          .link-group .links { margin: 0; padding: 0 .9rem .85rem 1.9rem; }
          .empty { padding: 1rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .queue-note { margin: -.25rem 0 1rem; color: #62625c; font-size: .9rem; }
          .top-nav { display: flex; gap: 1rem; margin-bottom: 1rem; }
          .command-row { margin-bottom: 1rem; }
          pre { overflow-x: auto; margin: .4rem 0 0; padding: .8rem; background: #fff; border: 1px solid #deded8; border-radius: 8px; }
          .diff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
          .diff-grid > div { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: .8rem; }
          .diff-grid h3 { margin: 0 0 .5rem; font-size: 1rem; }
          .diff-context { color: #62625c; }
          .diff-added, .diff-removed, .diff-context { overflow-wrap: anywhere; line-height: 1.5; }
          .diff-added { background: #e8f5e9; padding: .6rem; border-radius: 6px; }
          .diff-removed { background: #fdecea; padding: .6rem; border-radius: 6px; }
          @media (max-width: 44rem) {
            main { width: min(100vw - 1rem, 72rem); }
            .search, .stats, .meta-grid, .run-strip { grid-template-columns: 1fr; }
            .page-nav { grid-template-columns: 1fr; }
            .diff-grid { grid-template-columns: 1fr; }
            th:nth-child(2), td:nth-child(2) { display: none; }
          }
        </style>
      </head>
      <body>
        <main>
          <nav class="top-nav">
            <a href="/">Mirror</a>
            <a href="/__archive">Archive</a>
            <a href="/ops">Operations</a>
          </nav>
          ${body}
        </main>
        ${script}
      </body>
    </html>`;
}

export function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export function notFound(message: string): Response {
  return new Response(message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
