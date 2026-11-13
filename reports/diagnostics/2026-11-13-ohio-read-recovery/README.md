# November 13 bounded Ohio reader recovery

The morning report retained 12 failed Ohio counties. A later, bounded source-only check recovered **11 of those 12**: Hamilton, Mahoning, Meigs, Muskingum, Noble, Portage, Stark, Trumbull, Tuscarawas, Vinton and Washington. The exact official GETs and browser reads ran November 13, 22:58:05–23:00:07 UTC. This is **not a published bulletin or a new full-registry report**. The other eight Ohio counties were not rechecked.

`receipt.json` contains actual request times, per-source status, complete body text, visible-content hashes and hashes of the retained raw/record/text files. Previous reports and their evidence times were not changed. Compare added/removed diagnostic fields with their explicit November 11 baseline; they are not reopening claims.

## Two separate causes

- **Hamilton:** CMS horizontal rules were represented as invented `---` strings, while the actual browser correctly renders no text for a rule. The repair omits only those decorative separators. Every advisory word still has to match, in order.
- **Ten rendered shells:** all ten now render complete through the existing bounded Node/Chromium collector using the configured workspace proxy (`NODE_USE_ENV_PROXY=1`). This is demonstrated recovery of these sources, not a promise that a future browser environment cannot fail. The earlier three-county diagnostic without proxy support failed transport and is not counted as source evidence.
- **Jefferson remains held:** the official rendered link displays `State Route 7 southbound 4`, while the official CMS body includes `State Route 7 southbound 4th Street on-ramp closure near Toronto:`. This is a real upstream rendering omission, also visible in the retained earlier capture. The collector does not delete those words from its expected source body or mark the source complete. The previous county coverage/evidence time must remain unchanged.

The previous normal summarizer reported body disagreements but did not include them in its failure reasons. It now requires exact normalized body agreement, correct county title and heading, and retained source/text hash agreement before completion. The saved-result gate also requires that body agreement. Four focused, network-free checks cover the real Hamilton case, the Jefferson omission, a missing section and retained-text tampering.

## Existing daily task: next step

After review and merge, the existing daily task should check out the collector's exact merged source, keep its current transport configuration and run the same local reader with the workspace proxy enabled when required:

```sh
export NODE_USE_ENV_PROXY=1
export PW_PACKAGE=/opt/codex/cua_node/lib/node_modules/playwright-core/package.json
export PW_CHROMIUM=/usr/bin/chromium
export ODOT_CAPTURE_CHANNEL='Codex daily cloud Node/Chromium reader using configured workspace proxy and owned official GET transport'
node scripts/preflight.mjs
# Only if that exact official preflight succeeds:
bash scripts/read.sh
```

These browser paths describe the current available workspace; a replacement workspace must select its actual installed browser/package. Keep TLS checks enabled and the existing `ODOT_TRANSPORT_BASE` / reviewed code hash. No new scheduler, Worker deployment, Actions run or credential is needed. Review only `outcome=complete` county records for a subsequent strict private publication. Failed counties, including Jefferson until the upstream body renders completely, retain prior alerts and exact evidence times. An enabled schedule is not a completed source check.

The retained 11 complete results can support a separately authorized same-day publication review using their original measured times. They must not be relabeled as a later day's fresh checks. This change itself makes no private publication or database call.
