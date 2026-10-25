/** Keep actual official-response provenance separate from the owned transport endpoint. */
export async function officialFetch(url, options={}) {
 const original=new URL(url),base=process.env.ODOT_TRANSPORT_BASE;
 if(!base||original.origin!=='https://www.transportation.ohio.gov')return {response:await fetch(url,options),transport:null};
 const endpoint=new URL(base);
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.workers.dev')||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('Invalid owned official-source transport');
 if(!/^[a-f0-9]{64}$/.test(process.env.ODOT_TRANSPORT_CODE_SHA256??''))throw Error('Expected transport source hash required');
 const retrievalUrl=new URL(original.pathname+original.search,endpoint).href,clientRequestedAt=new Date().toISOString();
 const response=await fetch(retrievalUrl,options),sourceUrl=response.headers.get('x-odot-source-url'),sourceRequestedAt=response.headers.get('x-odot-requested-at'),sourceStatus=Number(response.headers.get('x-odot-source-status')),sourceHash=response.headers.get('x-odot-transport-sha256');
 if(sourceUrl!==original.href||sourceStatus!==response.status||sourceHash!==process.env.ODOT_TRANSPORT_CODE_SHA256||!sourceRequestedAt||!Number.isFinite(Date.parse(sourceRequestedAt))||Date.parse(sourceRequestedAt)>Date.now()+300000||Date.parse(sourceRequestedAt)<Date.parse(clientRequestedAt)-60000){await response.body?.cancel();throw Error('Official-source transport identity/status/time/hash failed');}
 const sourceHeaders={};for(const name of ['date','content-type','server','x-cache','age','last-modified','etag','cache-control']){const value=response.headers.get('x-odot-origin-'+name);if(value!==null)sourceHeaders[name]=value;}
 return {response,transport:{kind:'owned Cloudflare Workers official GET',retrievalUrl,clientRequestedAt,sourceUrl,sourceRequestedAt,sourceStatus,codeSha256:sourceHash,sourceHeaders}};
}
