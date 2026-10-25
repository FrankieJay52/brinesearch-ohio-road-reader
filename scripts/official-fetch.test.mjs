import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {officialFetch, officialRequestAllowed} from './official-fetch.mjs';

const origin = 'https://www.transportation.ohio.gov';
const registry = JSON.parse(fs.readFileSync(new URL('../county-sources.json', import.meta.url), 'utf8'));
const athens = registry.counties.find(row => row.county === 'Athens').urls[0];

function environment(t, key, value) {
 const previous = process.env[key];
 process.env[key] = value;
 t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

test('rejects unrelated embeds, other paths, credentials and write methods before fetch', async t => {
 const outbound = t.mock.method(globalThis, 'fetch', () => { throw Error('No network request is permitted by this fixture'); });
 const rejected = ['https://www.youtube.com/embed/fixture', 'https://example.invalid/asset.js', `${origin}/`, `${origin}/api/anything`, `${athens}?other=1`, `${athens}#other`, athens.replace('https:', 'http:'), athens.replace('www.transportation.ohio.gov', 'www.transportation.ohio.gov.example.invalid'), athens.replace('https://', 'https://name:password@'), 'not a URL'];
 for (const url of rejected) await assert.rejects(officialFetch(url), /Request blocked/);
 for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) await assert.rejects(officialFetch(athens, {method}), /Request blocked/);
 assert.equal(outbound.mock.callCount(), 0);
});

test('all registered pages and official JS/CSS retain GET/HEAD access with manual redirects', async t => {
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  assert.equal(options.redirect, 'manual');
  return new Response('fixture', {status: 200});
 });
 environment(t, 'ODOT_TRANSPORT_BASE', '');
 assert.equal(registry.counties.length, 20);
 for (const row of registry.counties) for (const url of row.urls) {
  assert.equal(officialRequestAllowed(url), true);
  assert.equal((await officialFetch(url)).response.status, 200);
 }
 for (const suffix of ['js', 'css']) for (const method of ['GET', 'HEAD']) {
  const url = `${origin}/_next/static/chunks/fixture.${suffix}?v=1`;
  assert.equal((await officialFetch(url, {method})).response.status, 200);
 }
 assert.equal(officialRequestAllowed(`${origin}/_next/static/not-code.html`), false);
});

test('an official redirect cannot automatically fetch an unrelated destination', async t => {
 const outbound = t.mock.method(globalThis, 'fetch', async (_url, options) => {
  assert.equal(options.redirect, 'manual');
  return new Response(null, {status: 302, headers: {location: 'https://example.invalid/redirect'}});
 });
 environment(t, 'ODOT_TRANSPORT_BASE', '');
 const {response} = await officialFetch(athens, {redirect: 'follow'});
 await assert.rejects(officialFetch(new URL(response.headers.get('location'), athens)), /Request blocked/);
 assert.equal(outbound.mock.callCount(), 1);
});

test('owned transport retains exact source identity, time, status and code guards', async t => {
 const base = 'https://fixture.workers.dev/';
 const code = 'a'.repeat(64);
 environment(t, 'ODOT_TRANSPORT_BASE', base);
 environment(t, 'ODOT_TRANSPORT_CODE_SHA256', code);
 let claimedUrl = athens, claimedCode = code, claimedTime = new Date().toISOString(), claimedStatus = '200';
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  assert.equal(String(url), new URL(new URL(athens).pathname, base).href);
  assert.equal(options.redirect, 'manual');
  return new Response('fixture', {status: 200, headers: {'x-odot-source-url': claimedUrl, 'x-odot-source-status': claimedStatus, 'x-odot-requested-at': claimedTime, 'x-odot-transport-sha256': claimedCode}});
 });
 assert.equal((await officialFetch(athens)).transport.sourceUrl, athens);
 claimedUrl = 'https://example.invalid/';
 await assert.rejects(officialFetch(athens), /identity\/status\/time\/hash failed/);
 claimedUrl = athens; claimedCode = 'b'.repeat(64);
 await assert.rejects(officialFetch(athens), /identity\/status\/time\/hash failed/);
 claimedCode = code; claimedTime = '2020-01-01T00:00:00Z';
 await assert.rejects(officialFetch(athens), /identity\/status\/time\/hash failed/);
 claimedTime = new Date().toISOString(); claimedStatus = '404';
 await assert.rejects(officialFetch(athens), /identity\/status\/time\/hash failed/);
});

test('real Chromium ignores an embedded video while preserving rendered county content, with no external network', () => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'odot-origin-fixture-'));
 try {
  const fixture = '<!doctype html><html><head><title>Traffic Impacts in Athens County</title><link rel="stylesheet" href="/_next/static/css/fixture.css"></head><body><h1>Traffic Impacts in Athens County</h1><p>Fixture restriction remains visible.</p><iframe src="https://www.youtube.com/embed/fixture"></iframe><script src="/_next/static/chunks/fixture.js"></script><h2>Contact</h2></body></html>';
  const registryPath = path.join(temporary, 'registry.json'), outboundPath = path.join(temporary, 'outbound.jsonl');
  fs.writeFileSync(registryPath, JSON.stringify({counties: [registry.counties.find(row => row.county === 'Athens')]}));
  const preloadPath = path.join(temporary, 'fixture-fetch.mjs');
  fs.writeFileSync(preloadPath, `import fs from 'node:fs';\nglobalThis.fetch = async (input, options) => {\n const url = new URL(input); fs.appendFileSync(${JSON.stringify(outboundPath)}, JSON.stringify(url.href)+'\\n');\n if (url.origin !== ${JSON.stringify(origin)}) throw Error('Unexpected outbound origin');\n if (url.href === ${JSON.stringify(athens)}) return new Response(${JSON.stringify(fixture)}, {headers:{'content-type':'text/html'}});\n if (url.pathname === '/_next/static/css/fixture.css') return new Response('body { color: black; }',{headers:{'content-type':'text/css'}});\n if (url.pathname === '/_next/static/chunks/fixture.js') return new Response('document.body.dataset.rendered="yes"',{headers:{'content-type':'application/javascript'}});\n throw Error('Unexpected outbound path');\n};\n`);
  const out = path.join(temporary, 'capture');
  const environment = {...process.env, ODOT_TRANSPORT_BASE: '', PW_CHROMIUM: process.env.PW_CHROMIUM || '/usr/bin/chromium'};
  execFileSync(process.execPath, ['--import', preloadPath, 'scripts/capture.mjs', registryPath, out], {cwd: new URL('..', import.meta.url), env: environment, timeout: 20000, encoding: 'utf8'});
  const record = JSON.parse(fs.readFileSync(path.join(out, 'records/athens.json'), 'utf8'));
  const outbound = fs.readFileSync(outboundPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(outbound.length, 4); // plain HTML, browser HTML, official CSS and JS.
  assert.ok(outbound.every(url => new URL(url).origin === origin));
  assert.ok(record.browser.hosts.some(([host]) => host === 'www.youtube.com')); // attempted embed was locally aborted.
  assert.equal(record.browser.documentStatus, 200);
  assert.equal(record.browser.error, null);
  assert.equal(record.browser.failedRequests, 0);
  assert.ok(record.browser.blocks.some(block => block.text === 'Fixture restriction remains visible.' && block.visible));
  const visible = fs.readFileSync(path.join(out, 'visible-text/athens.txt'), 'utf8');
  assert.equal(record.browser.visibleTextSha256, createHash('sha256').update(visible).digest('hex'));
 } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
