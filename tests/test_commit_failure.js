// v1.52.1: a write only counts as saved once its transaction COMMITS. IndexedDB reports the
// put() request first and commits afterwards; a quota failure shows up as a transaction abort.
// Until v1.52.0 the helpers resolved on the request, so a dropped write looked saved.
// The fake transaction below behaves like a real one: request success first, then abort.
// Run: node test_commit_failure.js [path-to-project-dir/]   (must FAIL on v1.52.0 and earlier)
process.on('unhandledRejection',e=>{ if(!(e&&e.code==='ERR_MODULE_NOT_FOUND')) console.log('UNHANDLED',e&&e.stack||e); });
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let alerts=[]; w.alert=m=>alerts.push(String(m)); const last=()=>alerts[alerts.length-1]||'';
const note=(id,t)=>({id,title:t||id,category:'C',type:'markdown',mime:'text/markdown',content:'body '+id,addedAt:1,updatedAt:1});
// Makes the next `n` write transactions on the given store fail at COMMIT with QuotaExceededError
// (after their request has reported success), then behave normally again.
const failCommits=(store,count)=>w.eval(`(()=>{
  if(!window.__realDb) window.__realDb = window.__getDb();
  window.__failLeft = ${count}; window.__failStore = ${JSON.stringify(store)};
  window.__setDb(new Proxy(window.__realDb, { get(t,k){
    if(k!=='transaction'){ const v=t[k]; return typeof v==='function'? v.bind(t) : v; }
    return (names,mode)=>{
      if(mode==='readwrite' && window.__failLeft>0 && [].concat(names).includes(window.__failStore)){
        window.__failLeft--;
        const fake={ error:null, oncomplete:null, onabort:null, onerror:null,
          objectStore(){ return { put(){ return req(); }, delete(){ return req(); } }; } };
        function req(){ const r={}; setTimeout(()=>{ if(r.onsuccess) r.onsuccess({target:r}); setTimeout(()=>{ fake.error=new DOMException('The quota has been exceeded.','QuotaExceededError'); if(fake.onabort) fake.onabort(); },0); },0); return r; }
        return fake;
      }
      return t.transaction(names,mode);
    };
  }}));
})()`);
const heal=()=>w.eval('window.__failLeft=0');
const rejects=async(f,name)=>{ try{ await f(); return false; }catch(e){ return !name || (e&&e.name===name); } };

(async()=>{
  await sleep(300);
  await w.eval("createPasscode('test1234')");
  await w.put(note('a'));

  // 1. the raw helpers
  await failCommits('items',1);
  ok(await rejects(()=>w.putRaw({...note('x')}),'QuotaExceededError'),'putRaw rejects with QuotaExceededError when the commit fails');
  await failCommits('items',1);
  ok(await rejects(()=>w.eval("delRaw('a')"),'QuotaExceededError'),'delRaw rejects when the commit fails');
  await heal();
  ok(!!(await w.getOne('a')),'the item whose delete failed is still there');

  // 2. put() through the write queue: rejects with a quota error, and the queue keeps working
  await failCommits('items',1);
  const isQ=w.eval('isQuotaError');
  let err=null; try{ await w.put(note('b')); }catch(e){ err=e; }
  ok(!!err&&isQ(err),'put() rejects with an error isQuotaError recognises (so the existing "storage is full" messages appear)');
  await heal(); await w.put(note('c'));
  ok(!!(await w.getOne('c')),'the write queue still works after a failed write');
  ok(!(await w.getAll()).some(x=>x.id==='b'),'the failed item is not on the shelf');

  // 3. settings and security stores
  await failCommits('settings',1);
  ok(await rejects(()=>w.putPrefs({theme:'auto'}),'QuotaExceededError'),'putPrefs rejects when the commit fails');
  await failCommits('security',1);
  ok(await rejects(()=>w.putAuth({id:'auth'}),'QuotaExceededError'),'putAuth rejects when the commit fails');
  await heal();

  // 4. import: stops at the first item that does not fit, counts only what was really stored
  const before=(await w.getAll()).length;
  const backup=[1,2,3,4,5].map(i=>note('imp'+i));
  await failCommits('items',1e9);            // every write fails from now on...
  await heal();                               // ...except: let the first two succeed
  await w.eval(`window.__failLeft=0`);
  // fail from the 3rd import write onward
  await w.eval(`(()=>{ const real=window.__realDb; let writes=0; window.__setDb(new Proxy(real,{ get(t,k){
    if(k!=='transaction'){ const v=t[k]; return typeof v==='function'? v.bind(t) : v; }
    return (names,mode)=>{
      if(mode==='readwrite' && [].concat(names).includes('items') && ++writes>2){
        const fake={ error:null, oncomplete:null, onabort:null, objectStore(){ return { put(){ return req(); } }; } };
        function req(){ const r={}; setTimeout(()=>{ if(r.onsuccess) r.onsuccess({target:r}); setTimeout(()=>{ fake.error=new DOMException('The quota has been exceeded.','QuotaExceededError'); if(fake.onabort) fake.onabort(); },0); },0); return r; }
        return fake;
      }
      return t.transaction(names,mode);
    };
  }})); })()`);
  alerts=[]; await w.mergeImportedItems(backup,{id:'sh',name:'S'});
  w.__setDb(w.__realDb);
  const after=(await w.getAll()).length;
  ok(after-before===2,'import stored exactly 2 of 5 ('+(after-before)+')');
  ok(/added 2 new items/.test(last())&&/storage is full/.test(last()),'import says it added 2 and stopped because storage is full: '+last().slice(0,140));
  ok(!/added [3-5]/.test(last()),'import does not claim items that were dropped');

  // 5. normal writes are unaffected
  w.__setDb(w.__realDb);
  await w.put(note('z')); await w.eval("delRaw('z')");
  ok(!(await w.getAll()).some(x=>x.id==='z'),'normal put and delete still work');

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
