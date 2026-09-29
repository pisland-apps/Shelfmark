// v1.52.5: a passcode change holds off auto-lock while it runs, reports progress against the
// real item count, and still re-encrypts everything (reading old records one at a time).
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const ev=x=>w.eval(x);
(async()=>{
  await sleep(300); w.alert=()=>{}; let reloads=0; w.reloadPage=()=>{ reloads++; };
  await ev("createPasscode('test1234')"); await ev("unlockApp()"); await ev("lockingNow=false"); reloads=0;
  for(let i=0;i<4;i++) await w.put({id:'m'+i,type:'markdown',title:'N'+i,addedAt:i,content:'text '+i});
  await ev("prefs.autoLockIdleMin=2; prefs.autoLockAwayMin=0; lastActivityAt=Date.now()-10*60000"); // idle lock is overdue
  const seen=[]; let heldDuring=[], lockedDuring=false;
  const b=await ev("buildPasscodeAuth('newpass99')");
  await w.reencryptEverything(b.key,b.rec,(done,total)=>{ seen.push([done,total]); heldDuring.push(ev("autoLockHolds")); w.autoLockTick(); if(reloads) lockedDuring=true; });
  ok(heldDuring.length===4&&heldDuring.every(h=>h>0),'auto-lock is held for the whole re-encryption');
  ok(!lockedDuring&&reloads===0,'an overdue idle lock does not fire in the middle of it');
  ok(ev("autoLockHolds")===0,'the hold is released afterwards');
  ok(seen.length===4&&seen.every(([d,t],i)=>d===i+1&&t===4),'progress is (done, total) against the real item count');
  ok((await w.getOne('m2')).content==='text 2'&&(await w.getAll()).length===4,'all items open under the new key');
  await sleep(20); w.autoLockTick(); await sleep(20);
  ok(reloads===0,'finishing counts as activity: no instant lock right after');
  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
