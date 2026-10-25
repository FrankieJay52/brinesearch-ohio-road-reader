// Read the registered Ohio county "Traffic Impacts" pages twice each: a plain HTTPS GET and the same URL in Chromium.
// usage: node scripts/capture.mjs county-sources.json <outDir> [<county> ...]
// Read-only: GET requests only, with the honest user agent below. Every browser request is fetched by Node through the
// session proxy (TLS checks stay on). Writes raw/<county>.html.gz, visible-text/<county>.txt and records/<county>.json.
// A county that fails is recorded with its error; the run goes on to the next one.
// A successful CDN read is a source check, not proof that the document changed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {officialFetch} from './official-fetch.mjs';

const UA = 'Mozilla/5.0 (compatible; BrineSearchRoadReport/1.0; +https://brinesearch.com)';
const ERROR_PAGE = 'f15a3511405a5f40b819cbfd21e80858778edfe419624d2c12920f473407583b'; // ODOT's stored 404 page
const KEEP = ['date', 'content-type', 'server', 'x-cache', 'age', 'via', 'x-amz-cf-pop', 'last-modified', 'etag', 'cache-control', 'x-nextjs-cache'];
// Resolve the explicitly installed browser package, without machine-specific paths.
const require = createRequire(process.env.PW_PACKAGE ?? import.meta.url);
const {chromium} = require('playwright-core');
const chromiumPath = process.env.PW_CHROMIUM;
const [registryPath, outDir, ...only] = process.argv.slice(2);
const sha = body => createHash('sha256').update(body).digest('hex');
const sources = JSON.parse(fs.readFileSync(registryPath, 'utf8')).counties.filter(row => row.state === 'Ohio')
  .filter(row => !only.length || only.includes(row.county.toLowerCase()));
for (const dir of ['raw', 'visible-text', 'records']) fs.mkdirSync(path.join(outDir, dir), {recursive: true});

/** One GET, following redirects by hand so each hop is recorded. */
async function plainGet(url) {
  const hops = [];
  for (let current = url; hops.length < 5;) {
    const startedAt = new Date().toISOString();
    const {response,transport} = await officialFetch(current, {redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US'}});
    const body = Buffer.from(await response.arrayBuffer());
    const headers = transport?.sourceHeaders ?? Object.fromEntries(KEEP.filter(key => response.headers.has(key)).map(key => [key, response.headers.get(key)]));
    const hop = {url: current, ...(transport?{transport}:{}), startedAt: transport?.sourceRequestedAt??startedAt, finishedAt: new Date().toISOString(), status: response.status, headers, bytes: body.length, sha256: sha(body)};
    hops.push(hop);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) { hop.location = location; current = new URL(location, current).href; continue; }
    return {hops, body};
  }
  return {hops, body: Buffer.alloc(0)};
}

const browser = await chromium.launch({...(chromiumPath ? {executablePath: chromiumPath} : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
for (const source of sources) {
  const url = source.urls[0], county = source.county.toLowerCase();
  try { await readCounty(source, url, county); } catch (error) {
    fs.writeFileSync(path.join(outDir, 'records', `${county}.json`), JSON.stringify({sourceId: source.sourceId, state: source.state,
      county: source.county, registeredUrl: url, userAgent: UA, fatal: String(error.message ?? error), at: new Date().toISOString()}, null, 1));
    console.log(source.county, 'FAILED', String(error.message ?? error));
  }
}
await browser.close();

async function readCounty(source, url, county) {
  // 1. Plain GET.
  let plain;
  try {
    const {hops, body} = await plainGet(url);
    const last = hops.at(-1), html = body.toString('utf8');
    fs.writeFileSync(path.join(outDir, 'raw', `${county}.html.gz`), zlib.gzipSync(body, {level: 9}));
    plain = {hops, finalUrl: last.url, status: last.status, bytes: body.length, sha256: sha(body), errorPage: sha(body) === ERROR_PAGE,
      title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null, earlierExpiringCopy: null};
  } catch (error) {
    plain = {hops: [], error: String(error.message ?? error), at: new Date().toISOString()};
  }

  // 2. The same URL in Chromium with the same user agent.
  const requests = [];
  const context = await browser.newContext({viewport: {width: 1280, height: 2000}, locale: 'en-US', timezoneId: 'America/New_York', userAgent: UA});
  await context.route('**/*', async route => {
    const request = route.request(), method = request.method(), type = request.resourceType();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') { requests.push({method, url: request.url(), type, blocked: true}); return route.abort('blockedbyclient'); }
    if (['image', 'font', 'media'].includes(type)) return route.abort('blockedbyclient');
    try {
      const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([key]) => !/^(host|content-length|accept-encoding|connection|:)/i.test(key)));
      const {response,transport} = await officialFetch(request.url(), {method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000)});
      const responseBody = Buffer.from(await response.arrayBuffer());
      const responseHeaders = {};
      response.headers.forEach((value, key) => { if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(key)) responseHeaders[key] = value; });
      requests.push({method, url: request.url(), type, status: response.status, bytes: responseBody.length,...(transport?{transport}:{})});
      return route.fulfill({status: response.status, headers: responseHeaders, body: responseBody});
    } catch (error) {
      requests.push({method, url: request.url(), type, failed: String(error.message ?? error)});
      return route.abort('failed');
    }
  });
  const page = await context.newPage();
  const startedAt = new Date().toISOString();
  let status = null, error = null;
  try {
    const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30_000});
    status = response?.status() ?? null;
    await page.waitForLoadState('networkidle', {timeout: 10_000}).catch(() => {});
    await page.waitForTimeout(5_000);
  } catch (e) { error = String(e.message ?? e); }
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  // The county section: block elements from the page heading to the Contact heading, in reading order, with links.
  const blocks = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h1')].find(h => /^Traffic Impacts in /.test(h.textContent.trim()));
    if (!heading) return null;
    const all = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,hr')];
    const out = [];
    for (const element of all.slice(all.indexOf(heading))) {
      const text = element.innerText?.trim() ?? '';
      if (/^H[1-6]$/.test(element.tagName) && text === 'Contact') break;
      if (element.tagName === 'LI' && element.querySelector('p')) continue; // its paragraphs are listed themselves
      out.push({tag: element.tagName.toLowerCase(), text, textContent: element.textContent.replace(/\s+/g, ' ').trim(),
        visible: element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}),
        links: [...element.querySelectorAll('a[href]')].map(a => ({text: a.innerText.trim(), href: a.href}))});
    }
    return out;
  }).catch(() => null);
  fs.writeFileSync(path.join(outDir, 'visible-text', `${county}.txt`), text);
  const browserRead = {startedAt, documentStatus: status, finalUrl: page.url(), error, title: await page.title().catch(() => null),
    visibleTextChars: text.length, visibleTextSha256: sha(text), lastModifiedShown: text.match(/Last modified: ([A-Za-z]+ \d+, \d{4})/)?.[1] ?? null,
    documentTransport: requests.find(row=>row.type==='document'&&row.url===url)?.transport??null,
    hosts: Object.entries(requests.reduce((count, row) => { const host = new URL(row.url).host; count[host] = (count[host] ?? 0) + 1; return count; }, {})),
    xhrOrFetch: requests.filter(row => ['xhr', 'fetch'].includes(row.type)).map(({url: u, status: s, bytes: b, failed}) => ({url: u, status: s, bytes: b, failed})),
    failedRequests: requests.filter(row => row.failed).length, blocks};
  await context.close();
  const record = {sourceId: source.sourceId, state: source.state, county: source.county, registeredUrl: url, userAgent: UA, plain, browser: browserRead};
  fs.writeFileSync(path.join(outDir, 'records', `${county}.json`), JSON.stringify(record, null, 1));
  console.log(source.county, 'plain', plain.status ?? plain.error, plain.bytes ?? '', plain.errorPage ? 'ERROR-PAGE' : '',
    '| browser', status, browserRead.lastModifiedShown, 'text', text.length, 'blocks', blocks?.length ?? null, 'hidden', blocks?.filter(b => !b.visible && b.text).length ?? null, error ?? '');
}
