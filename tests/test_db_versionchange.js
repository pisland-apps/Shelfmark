// v1.52.2: the main database reacts to versionchange, and erase never calls a
// blocked delete "done". "Another window" = a second connection made through the
// same fake-indexeddb the app uses.
require('./guard.js')(60000);
const {indexedDB}=require('fake-indexeddb');
const load=require('./load.js');
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const openOther=()=>new Promise((res,rej)=>{ const r=indexedDB.open('shelfmark',3); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const exists=async()=>(await indexedDB.databases()).some(d=>d.name==='shelfmark');
const del=()=>new Promise(res=>{ let blocked=false; const r=indexedDB.deleteDatabase('shelfmark'); r.onblocked=()=>{ blocked=true; }; r.onsuccess=()=>res({done:true,blocked}); r.onerror=()=>res({done:false,blocked}); });

(async()=>{
  // 1. another window erases while this one is open
  let w=load(); await sleep(300); w.alert=()=>{};
  ok(!!w.__getDb(),'(setup) app has its database open');
  const r1=await del();
  ok(r1.done&&!r1.blocked,'another window can erase the database: not blocked by this one');
  const n=w.document.getElementById('dbNotice');
  ok(!!n&&/another window/i.test(n.textContent),'this window shows a reload notice');
  ok(!(await exists()),'the database is really gone');

  // 2. erase while an old window (no versionchange handler) still holds a connection
  w=load(); await sleep(300); let alerts=0,reloads=0; w.alert=()=>{ alerts++; }; w.reloadPage=()=>{ reloads++; };
  w.eval('WIPE_BLOCK_WAIT_MS=200');
  const old=await openOther(); // old.onversionchange is not set: it never closes by itself
  await w.eval('wipeAllData()');
  ok(alerts===1,'blocked erase tells the user why');
  ok(reloads===0,'blocked erase does not reload into a pending delete');
  ok(await exists(),'data is still there while the other window is open (not falsely "erased")');
  old.close(); await sleep(100);
  ok(!(await exists()),'the queued delete completes once the other window closes');

  // 3. normal erase, no other window
  w=load(); await sleep(300); alerts=0; reloads=0; w.alert=()=>{ alerts++; }; w.reloadPage=()=>{ reloads++; };
  await w.eval('wipeAllData()');
  ok(reloads===1&&alerts===0,'normal erase deletes and reloads once, no warning');
  ok(!(await exists()),'database deleted');

  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
