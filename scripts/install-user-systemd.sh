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

linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
if [[ "$linger" != yes ]]; then
  echo "Enabling linger for $USER so the user timer survives reboot/logout."
  sudo loginctl enable-linger "$USER"
fi

cd "$repo_dir"
bun install --frozen-lockfile
chmod +x scripts/run-local-archive-cycle.sh
chmod +x scripts/run-viewer.sh

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/fitgirl-archive.service" <<SERVICE
[Unit]
Description=FitGirl local archive maintenance

[Service]
Type=oneshot
WorkingDirectory=$repo_dir
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$repo_dir/scripts/run-local-archive-cycle.sh
SERVICE

cat > "$unit_dir/fitgirl-archive.timer" <<'TIMER'
[Unit]
Description=Run FitGirl local archive maintenance

[Timer]
OnBootSec=10min
OnUnitInactiveSec=1h
Persistent=true
RandomizedDelaySec=5min
Unit=fitgirl-archive.service

[Install]
WantedBy=timers.target
TIMER

cat > "$unit_dir/fitgirl-viewer.service" <<SERVICE
[Unit]
Description=FitGirl local archive viewer

[Service]
WorkingDirectory=$repo_dir
Environment=PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$repo_dir/scripts/run-viewer.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now fitgirl-archive.timer
systemctl --user enable --now fitgirl-viewer.service

echo "Installed fitgirl archive timer and viewer service."
systemctl --user list-timers fitgirl-archive.timer
systemctl --user status fitgirl-viewer.service --no-pager
