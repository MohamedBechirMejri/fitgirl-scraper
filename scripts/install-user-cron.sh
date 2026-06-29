#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(pwd -P)"
install_bun=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-bun)
      install_bun=1
      shift
      ;;
    --repo-dir)
      repo_dir="$(cd "$2" && pwd -P)"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$repo_dir/package.json" ]]; then
  echo "Run from the fitgirl-scraper repo or pass --repo-dir." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  if [[ "$install_bun" != 1 ]]; then
    echo "Bun is missing. Re-run with --install-bun or install Bun first." >&2
    exit 1
  fi

  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun still is not available in PATH after install." >&2
  exit 1
fi

cd "$repo_dir"
bun install --frozen-lockfile
chmod +x scripts/run-local-archive-cycle.sh
chmod +x scripts/run-viewer.sh
mkdir -p archive

repo_shell="$(printf "%q" "$repo_dir")"
path_shell="$(printf "%q" "$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin")"
cycle="cd $repo_shell && mkdir -p archive && PATH=$path_shell flock -n archive/fitgirl-archive.lock scripts/run-local-archive-cycle.sh >> archive/cron.log 2>&1"
viewer="cd $repo_shell && mkdir -p archive && PATH=$path_shell flock -n archive/fitgirl-viewer.lock scripts/run-viewer.sh >> archive/viewer.log 2>&1"
tmp="$(mktemp)"

crontab -l 2>/dev/null | sed '/# fitgirl-archive start/,/# fitgirl-archive end/d' > "$tmp" || true
cat >> "$tmp" <<CRON
# fitgirl-archive start
@reboot sleep 600 && $cycle
0 * * * * $cycle
@reboot sleep 60 && $viewer
* * * * $viewer
# fitgirl-archive end
CRON
crontab "$tmp"
rm -f "$tmp"

echo "Installed fitgirl archive and viewer cron entries."
crontab -l | sed -n '/# fitgirl-archive start/,/# fitgirl-archive end/p'
