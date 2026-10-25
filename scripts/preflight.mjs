import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {officialFetch} from './official-fetch.mjs';
const registry=JSON.parse(fs.readFileSync('county-sources.json','utf8'));
const source=registry.counties.find(row=>row.state==='Ohio'&&row.county==='Monroe');
if(!source||registry.counties.length!==20)throw Error('Invalid public county source list');
const result={schemaVersion:1,stage:'preflight',channel:process.env.ODOT_CAPTURE_CHANNEL??'Local official GET',readerCommit:process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),requestedAt:new Date().toISOString(),sourceId:source.sourceId,url:source.urls[0],expected:registry.counties.length,attempted:1,complete:0,failed:1,deferred:registry.counties.length-1,served:false};
try{
 const {response,transport}=await officialFetch(result.url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; BrineSearchRoadReport/1.0; +https://brinesearch.com)','accept':'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(30_000)});
 const body=Buffer.from(await response.arrayBuffer());
 result.status=response.status;result.finalUrl=transport?.sourceUrl??response.url;result.bytes=body.length;result.sha256=createHash('sha256').update(body).digest('hex');
 result.transport=transport;if(transport)result.requestedAt=transport.sourceRequestedAt;
 result.serverDate=transport?transport.sourceHeaders.date??null:response.headers.get('date');result.cache=transport?transport.sourceHeaders['x-cache']??null:response.headers.get('x-cache');
 result.served=response.status===200&&result.finalUrl===result.url&&result.sha256!=='f15a3511405a5f40b819cbfd21e80858778edfe419624d2c12920f473407583b'&&body.toString('utf8').includes('Traffic Impacts in Monroe County');
 if(result.served){result.failed=0;result.note='Plausible official county body. Full20 county/browser/hash checks still required.';}
 else result.note='Official county access unavailable from this runner. No county is declared clear or complete.';
}catch(error){result.error=String(error.message??error);result.note='No completed county check; retain previous successful evidence.';}
result.finishedAt=new Date().toISOString();fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/latest-attempt.json',JSON.stringify(result,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`served=${result.served?'yes':'no'}\n`);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Official ODOT access preflight\n- Served: **${result.served?'yes':'no'}**\n- HTTP status: ${result.status??'unavailable'}\n- County: Monroe\n- Checked at: ${result.requestedAt}\n- ${result.note}\n\nA served preflight is not a completed20county check.\n`);
console.log(JSON.stringify({served:result.served,status:result.status,bytes:result.bytes,sha256:result.sha256,requestedAt:result.requestedAt}));
