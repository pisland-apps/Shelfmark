// v1.51.14: the Undo slot is dropped when a passcode change re-encrypts the shelf. A record restored from
// before the change would be under the OLD key and unopenable (and one such record stops the shelf listing).
// Run: node test_undo_rekey.js [path-to-project-dir/]
// jsdom cannot load the lazy pdf.js module (same as every other test here); any OTHER unhandled rejection is a real failure.
process.on('unhandledRejection',e=>{ if(e&&e.code==='ERR_MODULE_NOT_FOUND') return; console.log('UNHANDLED',e&&e.stack||e); process.exit(2); });
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const note=(id,title,content)=>({id,title,category:'C',type:'markdown',mime:'text/markdown',content,addedAt:1,updatedAt:1});
const toastShown=()=>document_toast().classList.contains('show');
const document_toast=()=>w.document.getElementById('undoToast');
const rekey=async pw=>{ const b=await w.eval("buildPasscodeAuth('"+pw+"')"); await w.reencryptEverything(b.key,b.rec); };
const listsOk=async()=>{ try{ await w.getAll(); return true; }catch(e){ return false; } };

(async()=>{
  await sleep(300);
  await w.eval("createPasscode('test1234')");
  w.alert=()=>{};

  // 1. normal Undo (no key change) still works
  await w.put(note('a','A','body a')); await w.put(note('keep','Keep','kept'));
  await w.deleteItemsWithUndo(['a']);
  ok(w.__lastDeleted()!==null&&toastShown(),'a delete opens the Undo slot and shows the toast');
  await w.undoDelete();
  ok((await w.getOne('a')).content==='body a','Undo without a key change restores the item');

  // 2. delete, THEN change the passcode: the slot is gone, Undo does nothing, the shelf still lists
  await w.deleteItemsWithUndo(['a']);
  ok(w.__lastDeleted()!==null,'(setup) slot is open after the delete');
  await rekey('second-pass-77');
  ok(w.__lastDeleted()===null,'a passcode change empties the Undo slot');
  ok(!toastShown(),'... and hides the toast');
  await w.undoDelete();
  ok((await w.eval("getOneRaw('a')"))===undefined,'pressing Undo afterwards restores nothing (the item stays deleted)');
  ok(await listsOk(),'the shelf still lists normally');
  ok((await w.getOne('keep')).content==='kept','other items open under the new key');

  // 3. the pending 6 s timer must not fire into a stale slot
  ok(await (async()=>{ await sleep(50); return w.__lastDeleted()===null; })(),'no leftover slot after the key change');

  // 4. proof of the failure this prevents: restoring an old-key record makes the whole listing fail
  await w.put(note('b','B','body b'));
  const oldRec=await w.eval("getOneRaw('b')");
  await rekey('third-pass-88');
  await w.restoreRaw(oldRec);
  ok(!(await listsOk()),'(why it matters) an old-key record put back after a key change breaks the listing');
  await w.del('b');
  ok(await listsOk(),'(cleanup) removing it heals the listing');

  // 5. a delete already IN FLIGHT when the key changes gets no Undo (it read its records under the old key)
  await w.put(note('c','C','body c'));
  const realDel=w.del; let release; const gate=new Promise(r=>{ release=r; });
  w.del=async id=>{ await realDel(id); await gate; };            // the delete lands, then waits
  const inflight=w.deleteItemsWithUndo(['c']);
  await sleep(40);
  await rekey('fourth-pass-99');                                  // key changes while that delete is still finishing
  release(); await inflight; w.del=realDel;
  ok(w.__lastDeleted()===null&&!toastShown(),'a delete that was mid-flight during a key change offers no Undo');
  ok((await w.eval("getOneRaw('c')"))===undefined,'... and the item is gone as the user asked');
  ok(await listsOk(),'the shelf still lists normally');

  // 6. deletes after the key change get a working Undo again (epoch is per change, not permanent)
  await w.deleteItemsWithUndo(['keep']);
  ok(w.__lastDeleted()!==null,'a delete after the key change opens the slot again');
  await w.undoDelete();
  ok((await w.getOne('keep')).content==='kept','... and Undo restores it under the current key');

  // 7. removing the passcode (device mode) also drops the slot
  await w.deleteItemsWithUndo(['keep']);
  const d=await w.eval('buildDeviceAuth()'); await w.reencryptEverything(d.key,d.rec);
  ok(w.__lastDeleted()===null,'switching to no-passcode also empties the Undo slot');

  console.log(fails?('\n'+fails+' FAILED of '+n):('\nALL '+n+' PASSED')); process.exit(fails?1:0);
})().catch(e=>{ console.log('TEST CRASHED after '+n+' checks:',e&&e.stack||e); process.exit(2); });
