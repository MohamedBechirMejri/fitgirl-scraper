#!/usr/bin/env bash
set -euo pipefail

host="${FITGIRL_VIEWER_HOST:-127.0.0.1}"
port="${FITGIRL_VIEWER_PORT:-4173}"

bun run view -- --host "$host" --port "$port"
