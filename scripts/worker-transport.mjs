// Official ODOT-only transport. No arbitrary URL, private data, credentials or scheduled work.
const COUNTY_PATHS = new Set(["/travel/driving/traffic-advisories/traffic-athens","/travel/driving/traffic-advisories/traffic-belmont","/travel/driving/traffic-advisories/traffic-carroll","/travel/driving/traffic-advisories/traffic-columbiana","/travel/driving/traffic-advisories/traffic-coshocton","/travel/driving/traffic-advisories/traffic-guernsey","/travel/driving/traffic-advisories/traffic-hamilton","/travel/driving/traffic-advisories/traffic-harrison","/travel/driving/traffic-advisories/traffic-jefferson","/travel/driving/traffic-advisories/traffic-mahoning","/travel/driving/traffic-advisories/traffic-meigs","/travel/driving/traffic-advisories/traffic-monroe","/travel/driving/traffic-advisories/traffic-muskingum","/travel/driving/traffic-advisories/traffic-noble","/travel/driving/traffic-advisories/traffic-portage","/travel/driving/traffic-advisories/traffic-stark","/travel/driving/traffic-advisories/traffic-trumbull","/travel/driving/traffic-advisories/traffic-tuscarawas","/travel/driving/traffic-advisories/traffic-vinton","/travel/driving/traffic-advisories/traffic-washington"]);
const ORIGIN = 'https://www.transportation.ohio.gov';
const SOURCE_HEADERS = ['date','content-type','server','x-cache','age','last-modified','etag','cache-control'];
export default {
 async fetch(request, env) {
  if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
  const incoming=new URL(request.url);
  const county=COUNTY_PATHS.has(incoming.pathname)&&!incoming.search;
  // These public JS/CSS paths are observed resources of the registered county pages.
  const asset=/^\/_next\/static\/[^?#]+\.(?:js|css)$/.test(incoming.pathname);
  if (!county&&!asset) return new Response('Only registered public county pages and their static JS/CSS are allowed',{status:403});
  if (!/^[a-f0-9]{64}$/.test(env.TRANSPORT_CODE_SHA256??'')) return new Response('Transport provenance missing',{status:503});
  const sourceUrl=ORIGIN+incoming.pathname+incoming.search,requestedAt=new Date().toISOString();
  try {
   const upstream=await fetch(sourceUrl,{method:request.method,redirect:'manual',headers:{'user-agent':'Mozilla/5.0 (compatible; BrineSearchRoadReport/1.0; +https://brinesearch.com)','accept':county?'text/html,application/xhtml+xml':'*/*'},signal:AbortSignal.timeout(30000)});
   const headers=new Headers({'Content-Type':upstream.headers.get('content-type')??'application/octet-stream','Cache-Control':'no-store','X-ODOT-Source-URL':sourceUrl,'X-ODOT-Requested-At':requestedAt,'X-ODOT-Source-Status':String(upstream.status),'X-ODOT-Transport-SHA256':env.TRANSPORT_CODE_SHA256});
   for (const name of SOURCE_HEADERS) {const value=upstream.headers.get(name);if(value!==null)headers.set('X-ODOT-Origin-'+name,value);}
   if(upstream.headers.has('location'))headers.set('Location',upstream.headers.get('location'));
   return new Response(upstream.body,{status:upstream.status,headers});
  } catch(error) {return Response.json({sourceUrl,requestedAt,error:String(error.message??error),sourceCheckCompleted:false},{status:502,headers:{'Cache-Control':'no-store'}})}
 }
};
