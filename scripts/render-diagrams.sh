#!/usr/bin/env bash
# Renders every content/diagrams/*.mmd to public/blog/diagrams/<name>.svg using mermaid-cli
# with the hand-drawn look. Run locally (uses the Playwright Chromium already on this machine);
# the SVGs are committed, so the Netlify build never needs a browser.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/blog/diagrams
count=0
for src in content/diagrams/*.mmd; do
  [ -e "$src" ] || continue
  name=$(basename "$src" .mmd)
  out="public/blog/diagrams/$name.svg"
  if [ "${FORCE:-}" != "1" ] && [ -f "$out" ] && [ "$out" -nt "$src" ]; then
    continue
  fi
  npx -y @mermaid-js/mermaid-cli@11 -q \
    -p scripts/blog/puppeteer.json -c scripts/blog/mermaid.json \
    -i "$src" -o "$out" -b transparent --svgId "d-$name"
  count=$((count + 1))
  echo "rendered $out"
done
echo "done ($count rendered)"
