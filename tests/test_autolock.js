// v1.51.11: idle / background auto-lock and "Lock now" (passcode mode only).
// Run: node test_autolock.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let reloads=0; w.reloadPage=()=>{ reloads++; };
const ev=(x)=>w.eval(x);
const relock=async()=>{ // put the app back into an unlocked passcode-mode state
  await ev("createPasscode('test1234')"); await ev("lockingNow=false; autoLockHolds=0; hiddenSince=null; lastActivityAt=Date.now();"); reloads=0;
  w.document.getElementById('lockScreen').classList.add('hidden');
};
const setHidden=v=>{ Object.defineProperty(w.document,'hidden',{value:v,configurable:true}); w.document.dispatchEvent(new w.Event('visibilitychange')); };

(async()=>{
  await sleep(300);
  w.alert=()=>{};
  await ev("createPasscode('test1234')");
  await ev("unlockApp()"); // installs the listeners
  await ev("lockingNow=false");
  reloads=0;

  // defaults
  ok(ev("prefs.autoLockIdleMin")===10 && ev("prefs.autoLockAwayMin")===5,'defaults: idle 10 min, background 5 min');

  // 1. Lock now
  ok(await w.lockNow()===true,'lockNow() reports it locked');
  ok(ev("cryptoKey")===null,'lockNow drops the key');
  ok(reloads===1,'lockNow reloads the page once');
  ok(!w.document.getElementById('lockScreen').classList.contains('hidden'),'lock screen is shown straight away');
  ok(await w.lockNow()===false && reloads===1,'a second call while locking does nothing');

  // 2. device mode: never locks
  await relock(); await ev("authMode='device'");
  ok(await w.lockNow()===false && ev("cryptoKey")!==null && reloads===0,'no-passcode mode: lockNow does nothing, key kept');
  await ev("prefs.autoLockIdleMin=2; lastActivityAt=Date.now()-10*60000"); w.autoLockTick(); await sleep(20);
  ok(reloads===0,'no-passcode mode: idle timer never locks');
  await ev("authMode='passcode'");

  // 3. idle rule
  await relock(); await ev("prefs.autoLockIdleMin=5; prefs.autoLockAwayMin=0; lastActivityAt=Date.now()-4*60000");
  w.autoLockTick(); await sleep(20);
  ok(reloads===0,'idle for less than the limit: stays open');
  await ev("lastActivityAt=Date.now()-5*60000-1000"); w.autoLockTick(); await sleep(20);
  ok(reloads===1&&ev("cryptoKey")===null,'idle past the limit: locks (key dropped, page reloaded)');
  await relock(); await ev("prefs.autoLockIdleMin=0; lastActivityAt=Date.now()-999*60000"); w.autoLockTick(); await sleep(20);
  ok(reloads===0,'idle rule set to Never: never locks');

  // 4. activity resets the idle clock
  await relock(); await ev("prefs.autoLockIdleMin=5; lastActivityAt=Date.now()-4*60000-30000");
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'a'}));
  ok(ev("Date.now()-lastActivityAt")<2000,'a key press counts as activity');
  for(const t of ['pointerdown','wheel','touchstart','scroll']){ await ev("lastActivityAt=0"); w.document.dispatchEvent(new w.Event(t,{bubbles:true})); ok(ev("lastActivityAt")>0,t+' counts as activity'); }

  // 5. background rule
  await relock(); await ev("prefs.autoLockIdleMin=0; prefs.autoLockAwayMin=5");
  setHidden(true); ok(ev("hiddenSince")!==null,'going to the background starts the away clock');
  await ev("hiddenSince=Date.now()-4*60000"); setHidden(false); await sleep(20);
  ok(reloads===0&&ev("hiddenSince")===null,'back before the limit: stays open, away clock cleared');
  setHidden(true); await ev("hiddenSince=Date.now()-5*60000-1000"); setHidden(false); await sleep(20);
  ok(reloads===1&&ev("cryptoKey")===null,'back after the limit: locked');
  await relock(); await ev("prefs.autoLockAwayMin=5"); setHidden(true); await ev("hiddenSince=Date.now()-6*60000");
  w.autoLockTick(); await sleep(20);
  ok(reloads===1,'timer fires while still in the background: locks without waiting for the return');
  setHidden(false);
  await relock(); await ev("prefs.autoLockAwayMin=0"); setHidden(true); await ev("hiddenSince=Date.now()-999*60000"); setHidden(false); await sleep(20);
  ok(reloads===0,'background rule set to Never: never locks');

  // 6. sound playing / holds delay the lock, they do not cancel it
  await relock(); await ev("prefs.autoLockIdleMin=5; lastActivityAt=Date.now()-6*60000");
  const a=w.document.createElement('audio'); Object.defineProperty(a,'paused',{value:false,configurable:true}); Object.defineProperty(a,'ended',{value:false,configurable:true});
  w.document.body.appendChild(a);
  w.autoLockTick(); await sleep(20);
  ok(reloads===0,'sound playing: does not lock');
  Object.defineProperty(a,'paused',{value:true,configurable:true}); w.autoLockTick(); await sleep(20);
  ok(reloads===1,'playback stopped: locks on the next check');
  a.remove();
  await relock(); await ev("prefs.autoLockIdleMin=5; lastActivityAt=Date.now()-6*60000");
  let release; const held=w.holdAutoLock(()=>new Promise(r=>{ release=r; }));
  w.autoLockTick(); await sleep(20);
  ok(reloads===0,'an export/import in progress (holdAutoLock): does not lock');
  release(); await held; ok(ev("autoLockHolds")===0,'hold is released when the operation ends');
  ok(ev("Date.now()-lastActivityAt")<2000,'finishing the operation counts as activity (no instant lock)');
  let threw=false; try{ await w.holdAutoLock(async()=>{ throw new Error('x'); }); }catch(e){ threw=true; }
  ok(threw&&ev("autoLockHolds")===0,'a failing operation still releases the hold');

  // 7. the key is kept until queued writes finish
  await relock();
  let jobDone=false, keyAtJobEnd='unset';
  w.serialized(async()=>{ await sleep(120); await w.encryptJSON(ev("cryptoKey"),{a:1}); keyAtJobEnd=ev("cryptoKey")?'present':'gone'; jobDone=true; });
  await w.lockNow();
  ok(jobDone&&keyAtJobEnd==='present','lock waits for a queued write, which still sees its key');
  ok(ev("cryptoKey")===null&&reloads===1,'...and only then drops the key and reloads');

  // 8. a mid-edit note is saved as a draft before locking
  await relock();
  await w.put({id:'n1',title:'Edit me',category:'C',type:'markdown',mime:'text/markdown',content:'saved text',addedAt:1,updatedAt:1});
  await ev("curId='n1'; curType='markdown'; draftLastValue='saved text'");
  w.noteEditActive=()=>true; // pretend the editor is open
  let ta=w.document.getElementById('mdEditArea'); if(!ta){ ta=w.document.createElement('textarea'); ta.id='mdEditArea'; w.document.body.appendChild(ta); }
  ta.value='typed but never saved';
  await w.lockNow();
  ok(reloads===1,'locked while an edit was open');
  ok(await ev("verifyPasscode('test1234')"),'the passcode still unlocks after an auto-lock');
  const d=await w.getDraft('n1');
  ok(d&&d.text==='typed but never saved','the unsaved text was stored as a draft, decryptable after unlock');

  // 9. settings panel
  await relock(); await ev("prefs.autoLockIdleMin=30; prefs.autoLockAwayMin=15");
  w.openSecInfo();
  const sec=w.document.getElementById('autoLockSection');
  ok(sec.style.display!=='none','panel shows Auto-lock in passcode mode');
  ok(w.document.getElementById('autoLockIdle').value==='30'&&w.document.getElementById('autoLockAway').value==='15','selects show the saved values');
  const idle=w.document.getElementById('autoLockIdle'); idle.value='2'; idle.dispatchEvent(new w.Event('change',{bubbles:true}));
  await sleep(50);
  ok(ev("prefs.autoLockIdleMin")===2,'changing the select updates the setting');
  const saved=await w.getPrefsDecrypted(); ok(saved&&saved.autoLockIdleMin===2&&saved.autoLockAwayMin===15,'the setting is saved (encrypted prefs)');
  w.setAutoLockPref({dataset:{pref:'autoLockIdleMin'},value:'7'}); ok(ev("prefs.autoLockIdleMin")===2,'a value that is not a choice is refused');
  w.setAutoLockPref({dataset:{pref:'shelfName'},value:'5'}); ok(ev("prefs.shelfName")==='','an unrelated pref key cannot be set through this action');
  await ev("prefs.autoLockIdleMin='junk'; prefs.autoLockAwayMin=-3; lastActivityAt=Date.now()-11*60000"); w.autoLockTick(); await sleep(20);
  ok(reloads===1,'corrupt stored values fall back to the defaults (10 min idle -> locks at 11)');
  await relock(); await ev("authMode='device'"); w.openSecInfo();
  ok(w.document.getElementById('autoLockSection').style.display==='none','panel hides Auto-lock in no-passcode mode');
  await ev("authMode='passcode'");

  // 10. palette
  await relock();
  const has=()=>w.buildStaticCommands().some(c=>c.id==='lock-now');
  ok(has(),'palette offers "Lock now" in passcode mode');
  await ev("authMode='device'"); ok(!has(),'palette hides "Lock now" in no-passcode mode'); await ev("authMode='passcode'");
  const cmd=w.buildStaticCommands().find(c=>c.id==='lock-now'); cmd.action(); await sleep(50);
  ok(reloads===1&&ev("cryptoKey")===null,'the palette command locks');

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
