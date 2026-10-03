#!/usr/bin/env bash
# Deploy the pushed feat/web-app head to myqode-testing (server 220) without disturbing anything that is running.
#   bash scripts/deploy-testing.sh            push first: it deploys origin/feat/web-app, not your working copy
#
# 1. Build in a separate copy (/var/www/.myqode-testing-build) at low CPU and disk priority, so the running
#    myqode-testing keeps serving and the other apps on the server keep their CPU. A failed build changes nothing.
# 2. Swap the new build in (two renames on one disk) and restart myqode-testing (a few seconds).
# 3. Run scripts/smoke-test.mjs; if any check fails, put the previous build and commit back automatically.
# Never touches /var/www/my-qode (the old live site).
set -euo pipefail
SSH="admin@101.53.132.220"
LIVE=/var/www/myqode-testing
BUILD=/var/www/.myqode-testing-build
URL=https://myqode-testing.qodeinvest.com
here="$(cd "$(dirname "$0")/.." && pwd)"

git -C "$here" fetch -q origin feat/web-app
SHA=$(git -C "$here" rev-parse FETCH_HEAD)
echo "→ Deploying $(git -C "$here" log -1 --format='%h %s' "$SHA")"

ssh -o BatchMode=yes "$SSH" "LIVE=$LIVE BUILD=$BUILD SHA=$SHA bash -s" <<'REMOTE' 2>&1 | grep -v -E "NOTICE|prohibited|prosecuted|logged and monitored|\*\*\*\*"
set -euo pipefail
if [ ! -d "$BUILD/.git" ]; then
  git clone -q "$LIVE" "$BUILD"
  git -C "$BUILD" remote set-url origin "$(git -C "$LIVE" remote get-url origin)"
fi
cd "$BUILD"
git fetch -q origin feat/web-app
git checkout -q -f "$SHA"
git clean -q -fd -e node_modules -e .next -e '.env*'
# same dependencies and settings as the running copy, so the build matches what will run it
ln -sfn "$LIVE/node_modules" node_modules
for f in "$LIVE"/.env*; do [ -f "$f" ] && ln -sfn "$f" "$(basename "$f")"; done
OLD=$(git -C "$LIVE" rev-parse HEAD)
if ! git -C "$LIVE" diff --quiet "$OLD" "$SHA" -- package.json package-lock.json 2>/dev/null; then
  echo "! package.json or package-lock.json changed since the running build: run npm ci in $LIVE first if a dependency was added"
fi
rm -rf .next
echo "→ Building (low priority)…"
if ! nice -n 15 ionice -c2 -n7 env NODE_OPTIONS=--max-old-space-size=6144 npx next build > /tmp/myqode-testing-build.log 2>&1; then
  tail -25 /tmp/myqode-testing-build.log
  echo "✗ Build failed; myqode-testing was not changed"
  exit 1
fi
echo "✓ Built"
git -C "$LIVE" fetch -q origin feat/web-app
git -C "$LIVE" reset -q --keep "$SHA"
echo "$OLD" > "$LIVE/.deploy-previous-sha"
rm -rf "$LIVE/.next-prev"
mv "$LIVE/.next" "$LIVE/.next-prev"
mv "$BUILD/.next" "$LIVE/.next"
pm2 restart myqode-testing --update-env > /dev/null
echo "✓ Swapped in and restarted (previous build kept as .next-prev, commit ${OLD:0:7})"
REMOTE
[ "${PIPESTATUS[0]}" -eq 0 ] || exit 1

# give Next a moment to come up, then check it
for i in $(seq 1 30); do curl -fs -m 5 -o /dev/null "$URL/api/mobile/app-version" && break; sleep 2; done
if node "$here/scripts/smoke-test.mjs" "$URL"; then
  echo "✓ Deployed $(git -C "$here" log -1 --format=%h "$SHA") to $URL"
  exit 0
fi

echo "✗ Smoke test failed: rolling back"
ssh -o BatchMode=yes "$SSH" "LIVE=$LIVE bash -s" <<'REMOTE' 2>&1 | grep -v -E "NOTICE|prohibited|prosecuted|logged and monitored|\*\*\*\*"
set -euo pipefail
cd "$LIVE"
[ -d .next-prev ] || { echo "no previous build to restore"; exit 1; }
rm -rf .next-failed; mv .next .next-failed; mv .next-prev .next
git reset -q --keep "$(cat .deploy-previous-sha)"
pm2 restart myqode-testing --update-env > /dev/null
echo "↩ Restored commit $(git rev-parse --short HEAD); the failed build is in $LIVE/.next-failed"
REMOTE
exit 1
