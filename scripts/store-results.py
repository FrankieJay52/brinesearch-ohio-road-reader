"""Store actual public capture outcomes. Failed/partial reads never overwrite the last complete capture."""
import datetime, hashlib, json, os, pathlib, shutil, sys
source, visible_dir, capture_exit = sys.argv[1:]
capture = json.loads(pathlib.Path(source).read_text())
registry = json.loads(pathlib.Path('county-sources.json').read_text())
expected = {row['sourceId']: row for row in registry['counties']}
assert len(expected) == 20
records = capture['counties']
assert len(records) == len(expected) and {row['sourceId'] for row in records} == set(expected)
for row in records:
    original = expected[row['sourceId']]
    assert row['state'] == original['state'] and row['county'] == original['county']
    assert row['registeredUrl'] == original['urls'][0]
    if row['outcome'] == 'complete':
        path = pathlib.Path(visible_dir) / (row['county'].lower() + '.txt')
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['browser']['visibleTextSha256']
        assert row['plainGet']['status'] == row['browser']['documentStatus'] == 200
        assert row['plainGet']['finalUrl'] == row['browser']['finalUrl'] == row['registeredUrl']
        assert not row['plainGet']['odotErrorPage'] and not row['browser']['hiddenBlocksInSection']
        assert not row['reasons']
        assert row['pageData']['bodyEntry'] and row['countySection']['text']
        assert row['plainGet']['requestedAt'] and row['browser']['startedAt']
complete = sum(row['outcome'] == 'complete' for row in records)
assert complete == capture['summary']['complete']
attempt = pathlib.Path('reports/attempt')
if attempt.exists():
    shutil.rmtree(attempt)
attempt.mkdir(parents=True)
shutil.copyfile(source, attempt / 'county-pages.json')
if pathlib.Path(visible_dir).is_dir():
    shutil.copytree(visible_dir, attempt / 'visible-text')
if complete == len(expected) and int(capture_exit) == 0:
    latest = pathlib.Path('reports/latest')
    if latest.exists():
        shutil.rmtree(latest)
    shutil.copytree(attempt, latest)
receipt = {'schemaVersion': 1, 'stage': 'capture', 'channel': capture['summary']['channel'],
           'readerCommit': capture['summary']['registry']['readerCommit'], 'runUrl': os.environ.get('ODOT_RUN_URL'),
           'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'expected': len(expected), 'attempted': len(records), 'complete': complete,
           'failed': len(records) - complete, 'deferred': 0, 'captureExit': int(capture_exit),
           'allComplete': complete == len(expected) and int(capture_exit) == 0,
           'firstRequestAt': capture['summary']['firstRequestAt'], 'lastRequestAt': capture['summary']['lastRequestAt'],
           'latestCompleteCaptureUpdated': complete == len(expected) and int(capture_exit) == 0}
pathlib.Path('reports/latest-attempt.json').write_text(json.dumps(receipt, indent=2) + '\n')
summary = os.environ.get('GITHUB_STEP_SUMMARY')
if summary:
    with open(summary, 'a') as output:
        output.write(f"\n## County capture\n- Complete: **{complete}/{len(expected)}**\n- Failed: {len(records) - complete}\n- Channel: {receipt['channel']}\n- Actual source times: {receipt['firstRequestAt']} to {receipt['lastRequestAt']}\n- Prior successful evidence is retained on partial/failed reads.\n")
print(json.dumps(receipt))
