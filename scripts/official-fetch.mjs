import fs from 'node:fs';

const OFFICIAL_ORIGIN = 'https://www.transportation.ohio.gov';
const COUNTY_URLS = new Set(JSON.parse(fs.readFileSync(new URL('../county-sources.json', import.meta.url), 'utf8')).counties.flatMap(row => row.urls));

/** Pages may embed unrelated services. Reject them before any outbound request. */
export function officialRequestAllowed(url, method = 'GET') {
 try {
  const target = new URL(url);
  return ['GET', 'HEAD'].includes(method) && target.origin === OFFICIAL_ORIGIN && !target.username && !target.password && !target.hash &&
   (COUNTY_URLS.has(target.href) || /^\/_next\/static\/[^?#]+\.(?:js|css)$/.test(target.pathname));
 } catch { return false; }
}

/** Keep actual official-response provenance separate from the owned transport endpoint. */
export async function officialFetch(url, options={}) {
 if (!officialRequestAllowed(url, options.method ?? 'GET')) throw Error('Request blocked: only registered ODOT pages and required official static JS/CSS GET/HEAD are allowed');
 const original=new URL(url),base=process.env.ODOT_TRANSPORT_BASE;
 // Redirects must return through this guard, including without the owned transport.
 options = {...options, redirect: 'manual'};
 if(!base)return {response:await fetch(url,options),transport:null};
 const endpoint=new URL(base);
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.workers.dev')||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('Invalid owned official-source transport');
 if(!/^[a-f0-9]{64}$/.test(process.env.ODOT_TRANSPORT_CODE_SHA256??''))throw Error('Expected transport source hash required');
 const retrievalUrl=new URL(original.pathname+original.search,endpoint).href,clientRequestedAt=new Date().toISOString();
 const response=await fetch(retrievalUrl,options),sourceUrl=response.headers.get('x-odot-source-url'),sourceRequestedAt=response.headers.get('x-odot-requested-at'),sourceStatus=Number(response.headers.get('x-odot-source-status')),sourceHash=response.headers.get('x-odot-transport-sha256');
 if(sourceUrl!==original.href||sourceStatus!==response.status||sourceHash!==process.env.ODOT_TRANSPORT_CODE_SHA256||!sourceRequestedAt||!Number.isFinite(Date.parse(sourceRequestedAt))||Date.parse(sourceRequestedAt)>Date.now()+300000||Date.parse(sourceRequestedAt)<Date.parse(clientRequestedAt)-60000){await response.body?.cancel();throw Error('Official-source transport identity/status/time/hash failed');}
 const sourceHeaders={};for(const name of ['date','content-type','server','x-cache','age','last-modified','etag','cache-control']){const value=response.headers.get('x-odot-origin-'+name);if(value!==null)sourceHeaders[name]=value;}
 return {response,transport:{kind:'owned Cloudflare Workers official GET',retrievalUrl,clientRequestedAt,sourceUrl,sourceRequestedAt,sourceStatus,codeSha256:sourceHash,sourceHeaders}};
}
