#!/usr/bin/env bash
# Official public county GET/browser reads only; no private repositories, credentials or report publication.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
capture_result=0
node scripts/capture.mjs county-sources.json "$work/capture" || capture_result=$?
python3 -I scripts/summarize.py --registry county-sources.json --main "${GITHUB_SHA:-$(git rev-parse HEAD)}" --capture "$work/capture" --previous reports/latest --out "$work/county-pages.json"
python3 -I scripts/store-results.py "$work/county-pages.json" "$work/capture/visible-text" "$capture_result"
