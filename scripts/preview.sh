#!/usr/bin/env bash
# Launch a local preview of Universal Beam.
# Runs the dev server in the foreground — press Ctrl-C to stop.
# macOS/Linux equivalent of preview.ps1.
#
#   Usage:  ./scripts/preview.sh [port]      (default 5197)
#
# 5197 is this app's port in the registry (Docs_UNI_SIM/dev-preview.md).
# --strictPort means a port clash fails loudly instead of silently serving
# this app on another app's port.
# First run installs deps if node_modules is missing.
#
# NOTE — pairing needs the internet even locally. The dev server serves the UI,
# but two tabs still find each other through the rendezvous Worker at
# opensource.unisim.co.uk/rtc/room. Point that elsewhere by setting
# VITE_RENDEZVOUS_ORIGIN (e.g. a local `wrangler dev` of opensource-portal).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${1:-5197}"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run)…"
  npm install
fi

echo "Universal Beam → http://localhost:$PORT"
exec npm run dev -- --port "$PORT" --strictPort
