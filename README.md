# Public Ohio county advisory reader

Collects the public Ohio Department of Transportation county advisory pages listed in `county-sources.json`. Each county is read through an official HTTPS GET and Chromium. Complete county text, links, visible-text hashes, actual request times and source outcomes are retained. A failed read is never a clear-road report.

This repository contains public source collection only. It has no destination data, route geometry, private application code, owner data, database connection or publication credential. It does not publish a driving bulletin or decide whether a road affects a particular route.

## Manual test and cost boundary

Run **Actions → Read public Ohio county advisories → Run workflow**. The workflow uses the standard `ubuntu-latest` runner in this public repository. It has a ten-minute cap, no paid/larger runner, no Actions cache and no artifact-storage uploads. Small public results are saved as ordinary Git commits. See [GitHub's public-repository runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

The workflow has only a manual trigger. There is no daily schedule. A successful access preflight is followed by the full 20-county read; the job succeeds only if all 20 are complete. ODOT may serve one network and refuse another, so successful access must be measured, not assumed.

`reports/latest-attempt.json` states the most recent actual outcome. `reports/attempt/` retains the latest full read attempt, including partial failures. `reports/latest/` changes only after a complete successful capture; its old times stay old if a later read fails. Partial results and omitted counties require explicit handling by any consumer.

## Evidence rules

- `checkedAt` comes from the actual successful source request, never from opening the saved file.
- CDN copy date/age and the document's modification date are distinct from retrieval time. No cache-expiry sleeps or fabricated document updates.
- Failed/partial reads, vanished notices and estimated completion dates do not establish reopening.
- Source receipts identify this public GitHub runner honestly. Results do not prove truck suitability, private access, exact restriction extent or all-road coverage.
- The public registry contains only source ID, state, county and official URLs. Its `subsetSha256` is SHA256 of the source-ID-sorted four-field rows serialized with sorted keys, ASCII escaping and compact JSON separators. A private consumer must derive and compare its own expected public-source subset, not mistake this for a full private registry hash.
- Review each source's body, links, statuses and times before using its facts. A scheduler being enabled is not a successful source read.

## Local use

Requires Node 22+, Python 3 and Git. Install with `npm ci --ignore-scripts --no-audit --no-fund` and `npx playwright install chromium`. Run `node scripts/preflight.mjs`, then `bash scripts/read.sh` only when access is served. `ODOT_CAPTURE_CHANNEL` is required and must identify the actual producer. An installed browser can be selected through `PW_CHROMIUM`; `PW_PACKAGE` may name an installed Playwright package JSON. These options do not change evidence requirements or source access rules.

## Optional owned free Workers transport

When a producer network cannot retrieve the official pages, `scripts/worker-transport.mjs` permits only the exact20registered county paths and their observed official `/_next/static/` JavaScript/CSS resources. It always fetches the fixed official ODOT host, accepts no arbitrary URL, has no scheduled handler and streams the unchanged upstream body. It contains no private data or keys.

An operator can use `ODOT_TRANSPORT_BASE` (an owned HTTPS Workers address) and `ODOT_TRANSPORT_CODE_SHA256` (the exact reviewed Worker source hash). Configure that same non-secret hash on the Worker as `TRANSPORT_CODE_SHA256`. The collector requires exact upstream URL/status/hash and genuine upstream request time. Actual Worker source headers, source time and transport URL are recorded separately; the Worker's own response Date is never used as ODOT's copy date. Existing county/browser/body/hash checks remain required. A transport preflight is not a completed20county report or proof of future availability.
