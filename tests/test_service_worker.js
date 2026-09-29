// v1.52.5: the service worker precaches with cache:'reload' (never a stale HTTP-cached
// file), still fails the install if any file fails, and no longer has a dead .catch.
require('./guard.js')(30000);
const fs=require('fs'), vm=require('vm');
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const src=fs.readFileSync(__dirname+'/../service-worker.js','utf8');
function boot(fetchImpl){
  const L={}, puts=[], fetched=[];
  const cache={ put:async(u)=>{ puts.push(u); } };
  const sb={ self:{ addEventListener:(t,f)=>{ L[t]=f; }, skipWaiting(){}, clients:{claim(){}} },
    caches:{ open:async()=>cache, keys:async()=>[], match:async()=>undefined, delete:async()=>true },
    Request:class{ constructor(u,o){ this.url=u; this.cache=o&&o.cache; this.method='GET'; } },
    fetch:async(req)=>{ fetched.push(req); return fetchImpl(req); }, Promise, Error, console };
  vm.runInNewContext(src,sb);
  return { L, puts, fetched };
}
(async()=>{
  const urls=[...src.matchAll(/^\s+'([^']+)',?$/gm)].map(m=>m[1]).concat(src.includes("'./',")?[]:[]);
  let s=boot(async()=>({ ok:true }));
  let p; s.L.install({ waitUntil:x=>{ p=x; } }); await p;
  ok(s.fetched.length>=9&&s.fetched.every(r=>r.cache==='reload'),'every precache request is made with cache:"reload" ('+s.fetched.length+' files)');
  ok(s.puts.length===s.fetched.length,'every fetched file is stored');
  s=boot(async(req)=>({ ok:!/app\.js$/.test(req.url), status:404 }));
  let rejected=false; s.L.install({ waitUntil:x=>{ p=x.catch(()=>{ rejected=true; }); } }); await p;
  ok(rejected,'one failed file fails the whole install (all-or-nothing, like addAll)');
  s=boot(async()=>{ throw new Error('offline'); });
  let out; s.L.fetch({ request:{ method:'GET', mode:'no-cors', url:'x.js' }, respondWith:x=>{ out=x; } });
  let threw=false; try{ await out; }catch(e){ threw=true; }
  ok(threw,'offline and not cached: the request fails cleanly (no undefined response)');
  ok(!/\.catch\(\(\)=>cached\)/.test(src),'the dead .catch(()=>cached) is gone');
  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
