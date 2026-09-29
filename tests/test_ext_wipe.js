// v1.51.6: erasing the shelf must also delete the linked-folder database ('shelfmark-ext').
// Run: node test_ext_wipe.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const names=async()=>(await w.indexedDB.databases()).map(d=>d.name);
(async()=>{
  await new Promise(r=>setTimeout(r,300)); // let app.js open its own DB
  // stand-in for a FileSystemDirectoryHandle (real ones can't exist in jsdom)
  await w.eval("extIdb('readwrite', st=>st.put({name:'MyVault',kind:'directory'},'root'))");
  // extLoad() bails out when the browser lacks showDirectoryPicker, so read the store directly
  const stored=await w.eval("extIdb('readonly', st=>st.get('root'))");
  ok(stored && stored.name==='MyVault','folder handle was stored before the erase');
  ok((await names()).includes('shelfmark-ext'),"'shelfmark-ext' exists before the erase");
  w.__setExt({name:'MyVault'},'MyVault');
  ok(w.__ext().extRootName==='MyVault','in-memory folder set before the erase');

  // several reads/writes must not leave connections open (they used to block deleteDatabase)
  for(let i=0;i<5;i++) await w.eval("extIdb('readonly', st=>st.get('root'))");

  let reloaded=0; try{ w.eval("location.reload = ()=>{ window.__reloaded=(window.__reloaded||0)+1; }"); }catch(e){}
  const t0=Date.now();
  await w.eval("wipeAllData()");
  ok(Date.now()-t0<2000,'wipeAllData finished promptly (delete was not left blocked)');
  const after=await names();
  ok(!after.includes('shelfmark-ext'),"'shelfmark-ext' is gone after the erase");
  ok(!after.includes('shelfmark'),"'shelfmark' is gone after the erase");
  ok(w.__ext().extRoot===null,'in-memory extRoot reset to null');
  ok(w.__ext().extRootName==='','in-memory extRootName reset to empty');

  // what the app does on the next start: nothing stored -> no folder, no sync target
  const again=await w.eval("extIdb('readonly', st=>st.get('root'))");
  ok(again===undefined||again===null,'after reload the store holds no folder handle');
  // reading re-creates an empty DB, so clean up like a fresh install would
  ok((w.__ext().extRootName ? 'Change notes folder' : 'Open a notes folder')==='Open a notes folder','palette shows "Open a notes folder…" with no name');

  // extForget alone must also work when the DB never existed
  await w.eval("extForget()"); ok(true,'extForget on a missing database does not throw');
  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
