#!/usr/bin/env bash
# Serves the production build on :2069 for the VS Code dev tunnel the mobile app points at, and keeps it up:
#  - restarts `next start` within 2 s if it ever exits (a dead upstream is what the tunnel reports as 502)
#  - keeps the Mac awake while it runs (caffeinate), so the tunnel does not drop when the lid timer fires
# Build first when the code changed:  npx next build
# Run:   scripts/serve-tunnel-backend.sh          (Ctrl+C stops both)
set -u
cd "$(dirname "$0")/.."
caffeinate -dimsu -w $$ &
while true; do
  echo "▸ $(date '+%H:%M:%S') starting next start on :2069"
  NODE_ENV=production npx next start -p 2069
  echo "▸ $(date '+%H:%M:%S') server exited ($?) — restarting in 2 s"
  sleep 2
done
