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
          :root { color-scheme: light; font-family: Lato, Arial, Helvetica, sans-serif; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #0f0f0f; color: #2b2b2b; }
          .site { width: min(79rem, 100vw); margin: 0 auto; background: #fff; min-height: 100vh; }
          .site-header { background: #000; border-top: .25rem solid #24890d; }
          .header-main { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 3rem; padding: 0 1.875rem; }
          .site-title { margin: 0; font-size: 1.45rem; line-height: 1.2; font-weight: 700; }
          .site-title a { color: #f887ff; text-decoration: none; }
          .site-title a:hover { color: #fff; }
          .top-nav { display: flex; flex-wrap: wrap; align-items: stretch; gap: 0; margin: 0; }
          .top-nav a { display: flex; align-items: center; min-height: 3rem; padding: 0 1rem; color: #fff; font-size: .78rem; font-weight: 700; text-decoration: none; text-transform: uppercase; }
          .top-nav a:hover, .top-nav a:focus { background: #24890d; color: #fff; }
          main { width: min(72rem, calc(100vw - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
          h1 { margin: 0 0 .5rem; color: #2b2b2b; font-size: 1.75rem; line-height: 1.15; }
          h2 { margin-top: 2rem; color: #2b2b2b; font-size: 1.1rem; }
          a { color: #24890d; text-decoration-thickness: .08em; }
          a:hover { color: #41a62a; }
          small { display: block; margin-top: .25rem; color: #767676; font-size: .78rem; overflow-wrap: anywhere; }
          table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; }
          th, td { padding: .7rem .8rem; border-bottom: 1px solid #e5e5e5; text-align: left; vertical-align: top; }
          th { font-size: .78rem; text-transform: uppercase; color: #2b2b2b; background: #f5f5f5; }
          code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; }
          .search { display: grid; grid-template-columns: minmax(12rem, 2fr) repeat(3, minmax(8rem, 1fr)) auto auto; gap: .5rem; margin-bottom: 1rem; padding: 1rem; background: #f5f5f5; border-top: .25rem solid #24890d; }
          input, select, button, .button { border: 1px solid #d5d5d5; border-radius: 0; font: inherit; }
          input, select { min-width: 0; padding: .75rem .85rem; background: #fff; color: #2b2b2b; }
          button, .button { display: inline-block; padding: .75rem 1rem; background: #24890d; color: #fff; text-decoration: none; border-color: #24890d; font-weight: 700; }
          button:hover, .button:hover { background: #41a62a; color: #fff; border-color: #41a62a; }
          .button.secondary { background: #2b2b2b; color: #fff; border-color: #2b2b2b; }
          .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1rem; }
          .stats div { background: #f5f5f5; border-left: .25rem solid #24890d; padding: .8rem; }
          .stats dt { color: #767676; font-size: .8rem; }
          .stats dd { margin: .15rem 0 0; color: #2b2b2b; font-size: 1.35rem; font-weight: 700; }
          .run-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
          .run-strip div { min-width: 0; padding: .8rem; background: #f5f5f5; border-left: .25rem solid #24890d; }
          .run-strip dt { color: #767676; font-size: .78rem; }
          .run-strip dd { margin: .15rem 0 0; color: #2b2b2b; font-weight: 700; }
          .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem .75rem; }
          .meta-grid div { min-width: 0; padding: .65rem .75rem; background: #f5f5f5; border-left: .2rem solid #24890d; }
          .meta-grid dt { color: #767676; font-size: .78rem; }
          .meta-grid dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
          .page-head { margin-bottom: 1.25rem; padding: 1rem; background: #f5f5f5; border-top: .25rem solid #24890d; }
          .source { overflow-wrap: anywhere; }
          .page-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1.25rem; }
          .page-nav a { display: block; min-width: 0; padding: .75rem .85rem; background: #f5f5f5; border-left: .25rem solid #24890d; text-decoration: none; overflow-wrap: anywhere; }
          .page-nav span { display: block; margin-bottom: .25rem; color: #767676; font-size: .78rem; text-transform: uppercase; }
          .links { columns: 2 24rem; padding-left: 1.1rem; }
          .links li { break-inside: avoid; margin-bottom: .35rem; overflow-wrap: anywhere; }
          .link-status { display: inline-block; margin-left: .4rem; padding: .1rem .35rem; background: #2b2b2b; color: #fff; font-size: .72rem; text-transform: uppercase; vertical-align: .08rem; }
          .link-group { margin-bottom: .75rem; background: #fff; border: 1px solid #ddd; }
          .link-group summary { cursor: pointer; padding: .75rem .9rem; font-weight: 700; }
          .link-group summary span { color: #767676; font-weight: 400; }
          .link-group .links { margin: 0; padding: 0 .9rem .85rem 1.9rem; }
          .empty { padding: 1rem; background: #f5f5f5; border-left: .25rem solid #767676; }
          .queue-note { margin: -.25rem 0 1rem; color: #767676; font-size: .9rem; }
          .command-row { margin-bottom: 1rem; }
          pre { overflow-x: auto; margin: .4rem 0 0; padding: .8rem; background: #2b2b2b; color: #f5f5f5; }
          .diff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
          .diff-grid > div { background: #f5f5f5; border: 1px solid #ddd; padding: .8rem; }
          .diff-grid h3 { margin: 0 0 .5rem; font-size: 1rem; }
          .diff-context { color: #767676; }
          .diff-added, .diff-removed, .diff-context { overflow-wrap: anywhere; line-height: 1.5; }
          .diff-added { background: #dff0d8; padding: .6rem; }
          .diff-removed { background: #f2dede; padding: .6rem; }
          @media (max-width: 44rem) {
            main { width: min(100vw - 1rem, 72rem); }
            .header-main { display: block; padding: .75rem 1rem 0; }
            .top-nav { margin-top: .75rem; }
            .top-nav a { min-height: 2.5rem; padding: 0 .75rem; }
            .search, .stats, .meta-grid, .run-strip { grid-template-columns: 1fr; }
            .page-nav { grid-template-columns: 1fr; }
            .diff-grid { grid-template-columns: 1fr; }
            th:nth-child(2), td:nth-child(2) { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="site">
          <header class="site-header">
            <div class="header-main">
              <p class="site-title"><a href="/">FitGirl Repacks</a></p>
              <nav class="top-nav" aria-label="Archive tools">
                <a href="/">Mirror</a>
                <a href="/__archive">Archive</a>
                <a href="/__archive/ops">Operations</a>
              </nav>
            </div>
          </header>
          <main>
            ${body}
          </main>
        </div>
        ${script}
      </body>
    </html>`;
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
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
