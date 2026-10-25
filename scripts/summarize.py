"""Build the day's county records from capture.mjs output, and what changed since the previous read.

usage: python3 -I summarize.py --registry <county-source-registry.json> --main <commit> --capture <captureDir>
                               --previous <folder with the previous county-pages.json and visible-text/> --out <out.json>
Every Ohio row of the registry gets a record: `complete` only when both reads succeeded at the registered URL and the
county section was found and shown; otherwise `failed` with its reasons. Read-only: works on saved files.
"""
import argparse, email.utils, gzip, hashlib, json, os, re

UA = 'Mozilla/5.0 (compatible; BrineSearchRoadReport/1.0; +https://brinesearch.com)'
CHANNEL = os.environ.get('ODOT_CAPTURE_CHANNEL', 'Local reader: official HTTPS GET and Chromium, honest user agent, GET only')
sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
squash = lambda text: re.sub(r'\s+', ' ', text).strip()


def made_at(date_header):
    """ODOT's Date header (when its server made the copy that was served) as an ISO time."""
    try:
        return email.utils.parsedate_to_datetime(date_header).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (TypeError, ValueError):
        return None


def flight(html):
    return ''.join(json.loads(p) for p in re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html))


def page_dates(stream, county):
    """The page's own entry (published, last modified) and its CMS container's last update."""
    out = {}
    m = re.search(r'"title":"Traffic Impacts in %s County\s*","displayTitle":(?:true|false),"type":"[^"]*","publishedDate":"([^"]+)",'
                  r'"lastModifiedDate":"([^"]+)"' % re.escape(county), stream)
    out['publishedDate'], out['lastModifiedDate'] = (m.group(1), m.group(2)) if m else (None, None)
    found = re.search(r'"name":"Traffic Impacts in %s County\s*- Landing Container"' % re.escape(county), stream)
    if found:
        before = stream[max(0, found.start() - 1500):found.start()]
        updated, versions = re.findall(r'"updatedAt":"([^"]+)"', before), re.findall(r'"publishedVersion":(\d+)', before)
        out['containerUpdatedAt'] = updated[-1] if updated else None
        out['containerPublishedVersion'] = int(versions[-1]) if versions else None
    return out


def cms_body(stream, county):
    """The county's rich-text Body entry in the page data: its CMS id, last update and blocks in reading order."""
    m = re.search(r'"fields":\{"name":"Traffic Impacts in %s County\s*- Body\s*","body":\{' % re.escape(county), stream)
    if not m:
        return None
    document, _ = json.JSONDecoder().raw_decode(stream, m.end() - 1)
    before = stream[max(0, m.start() - 900):m.start()]
    ids, updated, versions = (re.findall(pattern, before) for pattern in
                              (r'"id":"([0-9A-Za-z]{15,})","type":"Entry"', r'"updatedAt":"([^"]+)"', r'"publishedVersion":(\d+)'))

    def inline(node):
        kind = node.get('nodeType')
        if kind == 'text':
            return node.get('value', '')
        if kind == 'embedded-entry-inline':  # a link entry; the page shows its label
            fields = ((node.get('data') or {}).get('target') or {}).get('fields') or {}
            return fields.get('linkLabel') or fields.get('title') or ''
        return ''.join(inline(child) for child in node.get('content', []))

    blocks = []

    def block(node):
        kind = node.get('nodeType', '')
        if kind in ('document', 'unordered-list', 'ordered-list', 'list-item'):
            for child in node.get('content', []):
                block(child)
        elif kind == 'hr':
            blocks.append('---')
        else:
            blocks.append(inline(node))

    block(document)
    return {'entryId': ids[-1] if ids else None, 'updatedAt': updated[-1] if updated else None,
            'publishedVersion': int(versions[-1]) if versions else None, 'blocks': blocks}


def section_lines(text, county):
    """Non-empty lines of the county section in a browser text: the page heading to the Contact heading."""
    lines = [line.strip() for line in text.split('\n')]
    starts = [i for i, line in enumerate(lines) if line == 'Traffic Impacts in %s County' % county]
    if not starts:
        return []
    end = next((i for i in range(starts[-1], len(lines)) if lines[i] == 'Contact'), len(lines))
    return [line for line in lines[starts[-1]:end] if line]


def read_county(capture_dir, source, previous):
    county, key, url = source['county'], source['county'].lower(), source['urls'][0]
    record = {'sourceId': source['sourceId'], 'state': source['state'], 'county': county, 'registeredUrl': url, 'outcome': 'failed', 'reasons': []}
    path = os.path.join(capture_dir, 'records', key + '.json')
    if not os.path.exists(path):
        record['reasons'].append('no capture record')
        return record
    row = json.load(open(path))
    if row.get('fatal'):
        record['reasons'].append('capture error: ' + row['fatal'])
        return record
    plain, browser, reasons = row['plain'], row['browser'], record['reasons']
    hop = plain['hops'][-1] if plain['hops'] else {'headers': {}, 'startedAt': plain.get('at')}
    record['plainGet'] = {'requestedAt': hop.get('startedAt'), 'status': plain.get('status'), 'finalUrl': plain.get('finalUrl'),
                          'redirects': [h.get('location') for h in plain['hops'][:-1]], 'serverDate': hop['headers'].get('date'),
                          'xCache': hop['headers'].get('x-cache'), 'age': hop['headers'].get('age'), 'cloudfrontPop': hop['headers'].get('x-amz-cf-pop'),
                          'copyMadeAt': made_at(hop['headers'].get('date')), 'bytes': plain.get('bytes'), 'sha256': plain.get('sha256'),
                          'odotErrorPage': plain.get('errorPage'), 'error': plain.get('error'),
                          'earlierExpiringCopy': [{key: h.get(key) for key in ('startedAt', 'status')} | {'age': h['headers'].get('age')}
                                                  for h in plain.get('earlierExpiringCopy') or []] or None}
    if plain.get('error'):
        reasons.append('plain GET error: ' + plain['error'])
    elif plain['status'] != 200:
        reasons.append('plain GET status %s' % plain['status'])
    if plain.get('errorPage'):
        reasons.append("ODOT's 404 error page")
    if plain.get('finalUrl') and plain['finalUrl'] != url:
        reasons.append('plain GET ended at ' + plain['finalUrl'])
    dates, body = {}, None
    raw = os.path.join(capture_dir, 'raw', key + '.html.gz')
    if os.path.exists(raw) and plain.get('status') == 200:
        stream = flight(gzip.open(raw).read().decode('utf-8', 'replace'))
        dates, body = page_dates(stream, county), cms_body(stream, county)
    blocks = browser.get('blocks') or []
    text_path = os.path.join(capture_dir, 'visible-text', key + '.txt')
    text = open(text_path).read() if os.path.exists(text_path) else ''
    if browser.get('error'):
        reasons.append('browser error: ' + browser['error'])
    elif browser.get('documentStatus') != 200:
        reasons.append('browser status %s' % browser.get('documentStatus'))
    if browser.get('finalUrl') != url:
        reasons.append('browser ended at %s' % browser.get('finalUrl'))
    if not blocks:
        reasons.append('no county section on the page')
    hidden = sum(1 for block in blocks if block['text'] and not block['visible'])
    if hidden:
        reasons.append('%d hidden blocks in the county section' % hidden)
    if not browser.get('lastModifiedShown'):
        reasons.append('no "Last modified" shown')
    section_text = '\n\n'.join(block['text'] for block in blocks if block['text'])
    heading_path, items = [], []
    for block in blocks:
        if block['tag'] in ('h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(block['tag'][1])
            heading_path = [h for h in heading_path if h[0] < level] + [(level, block['text'])]
        elif block['tag'] in ('p', 'li') and block['text'] and not block['text'].startswith('Last modified:'):
            for chunk in re.split(r'\n\s*\n', block['text']):
                if chunk.strip():
                    links = [link for link in block['links'] if link['text'] and link['text'] in chunk]
                    items.append({'under': [h[1] for h in heading_path], 'text': chunk.strip(), 'links': links})
    # The plain page's Body entry against the browser's section (less the heading, the date and the OHGO frame title).
    shown = [squash(block['text']) for block in blocks if block['text'] and block['tag'] != 'h1'
             and not block['text'].startswith('Last modified:') and block['text'] != 'Local Conditions on OHGO']
    body_blocks = [squash(text) for text in body['blocks'] if text.strip()] if body else []
    body_text, joined_shown = squash(' '.join(body_blocks)), squash(' '.join(shown))
    record['pageData'] = {**dates, 'bodyEntry': None if not body else {'entryId': body['entryId'], 'updatedAt': body['updatedAt'],
                          'publishedVersion': body['publishedVersion'], 'textSha256': sha(body_text), 'text': '\n\n'.join(body_blocks)},
                          'browserBlocksNotInPlainBody': [t for t in shown if t not in body_text],
                          'plainBodyBlocksNotShown': [t for t in body_blocks if t not in joined_shown]}
    record['browser'] = {'startedAt': browser.get('startedAt'), 'documentStatus': browser.get('documentStatus'), 'finalUrl': browser.get('finalUrl'),
                         'title': browser.get('title'), 'lastModifiedShown': browser.get('lastModifiedShown'),
                         'visibleTextSha256': browser.get('visibleTextSha256'), 'visibleTextFile': 'visible-text/%s.txt' % key, 'hiddenBlocksInSection': hidden}
    record['countySection'] = {'sha256': sha(section_text), 'items': len(items), 'text': section_text, 'blocks': items}
    before_path = os.path.join(previous['dir'], 'visible-text', key + '.txt')
    if os.path.exists(before_path):
        now, before = section_lines(text, county), section_lines(open(before_path).read(), county)
        record['sincePreviousRead'] = {'previousReadAt': previous['times'].get(source['sourceId']),
                                       'added': [line for line in now if line not in before and not line.startswith('Last modified:')],
                                       'removed': [line for line in before if line not in now and not line.startswith('Last modified:')]}
    if not reasons:
        record['outcome'] = 'complete'
    return record


def main():
    parser = argparse.ArgumentParser()
    for name in ('registry', 'main', 'capture', 'previous', 'out'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    registry_bytes = open(args.registry, 'rb').read()
    sources = [row for row in json.loads(registry_bytes)['counties'] if row['state'] == 'Ohio']
    previous = {'dir': args.previous, 'times': {}}
    previous_json = os.path.join(args.previous, 'county-pages.json')
    if os.path.exists(previous_json):
        for row in json.load(open(previous_json))['counties']:
            previous['times'][row['sourceId']] = (row.get('plainGet') or {}).get('requestedAt')
    records = [read_county(args.capture, source, previous) for source in sources]
    times = sorted(t for r in records for t in ((r.get('plainGet') or {}).get('requestedAt'), (r.get('browser') or {}).get('startedAt')) if t)
    summary = {'readDateUtc': times[0][:10] if times else None, 'firstRequestAt': times[0] if times else None, 'lastRequestAt': times[-1] if times else None,
               'expected': len(records), 'complete': sum(r['outcome'] == 'complete' for r in records),
               'failed': [{'sourceId': r['sourceId'], 'reasons': r['reasons']} for r in records if r['outcome'] != 'complete'],
               'channel': CHANNEL, 'userAgent': UA,
               'registry': {'path': 'county-sources.json', 'readerCommit': args.main, 'namespace': 'public-ohio-county-advisories/v1',
                            'sha256': hashlib.sha256(registry_bytes).hexdigest(),
                            'subsetSha256': hashlib.sha256(json.dumps(sorted([{key: row[key] for key in ('sourceId', 'state', 'county', 'urls')} for row in sources], key=lambda row: row['sourceId']), sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()}}
    json.dump({'summary': summary, 'counties': records}, open(args.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({key: summary[key] for key in ('readDateUtc', 'firstRequestAt', 'lastRequestAt', 'expected', 'complete')}))
    for r in records:
        change = r.get('sincePreviousRead')
        print(r['county'], r['outcome'], '; '.join(r['reasons']), (r.get('browser') or {}).get('lastModifiedShown'),
              '+%d -%d' % (len(change['added']), len(change['removed'])) if change else '')


if __name__ == '__main__':
    main()
