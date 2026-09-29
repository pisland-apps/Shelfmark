// v1.51.8: KDF iteration count (new = 600k, old records keep their own), crafted-backup clamp,
// legacy backups without an `iterations` field, 4-char minimum unchanged, advisory strength hint.
// Run: node test_kdf.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const $=id=>w.document.getElementById(id);
let alerts=[]; w.alert=m=>alerts.push(String(m));
const fakeFile=obj=>({ target:{ files:[{ text:async()=>JSON.stringify(obj) }], value:'' } });
const b64=u8=>Buffer.from(u8).toString('base64');

(async()=>{
  await new Promise(r=>setTimeout(r,300));

  // ---- safeIterations
  { const f=w.safeIterations;
    ok(f(undefined)===250000&&f(null)===250000,'missing iterations -> legacy 250,000 (NOT the new default)');
    ok(f(250000)===250000&&f(600000)===600000&&f(1000000)===1000000&&f(1)===1,'valid counts pass through (up to 1,000,000)');
    for(const bad of [1000001,1e9,1e12,Infinity,-Infinity,NaN,0,-5,1.5,'600000','1e9',true,{},[],[600000]]) ok(f(bad)===0,'refused: '+JSON.stringify(bad)+' ('+typeof bad+')');
  }

  // ---- minimum length stays 4; a 4-char passcode works and uses 600k rounds
  $('passcodeConfirm').style.display='block';
  $('passcodeInput').value='123'; $('passcodeConfirm').value='123';
  await w.onLockSubmit();
  ok(/at least 4/.test($('lockError').textContent)&&!(await w.getAuth()),'3 characters still refused (minimum is 4)');
  $('passcodeInput').value='1234'; $('passcodeConfirm').value='1234';
  const t0=Date.now(); try{ await w.onLockSubmit(); }catch(e){ /* unlockApp needs a full browser; the auth record is what matters */ }
  const auth=await w.getAuth();
  ok(!!auth&&auth.mode==='passcode','4 characters accepted (minimum unchanged)');
  ok(auth.iterations===600000,'new passcode is derived with 600,000 iterations (got '+(auth&&auth.iterations)+')');
  console.log('     (setting a passcode took',Date.now()-t0,'ms here)');

  // ---- an existing 250k passcode record still unlocks, and a wrong one does not
  { const salt=w.crypto.getRandomValues(new Uint8Array(16));
    const key=await w.deriveKey('oldpass',salt,250000);
    const {iv,cipher}=await w.aesEncrypt(key,new TextEncoder().encode('shelfmark-ok'));
    await w.putAuth({id:'auth',mode:'passcode',salt:b64(salt),iterations:250000,verifierIv:b64(iv),verifierCipher:b64(cipher)});
    ok(await w.verifyPasscode('oldpass')===true,'existing record made with 250,000 iterations still unlocks (no migration needed)');
    ok(await w.verifyPasscode('nope')===false,'wrong passcode still refused');
    await w.putAuth({id:'auth',mode:'passcode',salt:b64(salt),iterations:1e12,verifierIv:b64(iv),verifierCipher:b64(cipher)});
    const t=Date.now(); ok(await w.verifyPasscode('oldpass')===false&&Date.now()-t<500,'a tampered auth record with absurd iterations is refused instantly');
  }

  // ---- crafted backup files are refused before any key derivation
  for(const bad of [1e12,1000001,0,-1,1.5,'250000','1e9']){
    alerts=[]; $('importPassOverlay').style.display='none';
    const t=Date.now();
    await w.onImportFile(fakeFile({app:'shelfmark',encrypted:true,kdf:'PBKDF2',iterations:bad,salt:b64(new Uint8Array(16)),iv:b64(new Uint8Array(12)),cipher:b64(new Uint8Array(32))}));
    ok(alerts.length===1&&/invalid/.test(alerts[0])&&$('importPassOverlay').style.display==='none'&&Date.now()-t<500,'crafted backup refused with a clear message, no passphrase prompt: iterations='+JSON.stringify(bad));
  }
  { // doImportDecrypt also guards (defence in depth) even if a bad value got past the file check
    $('imppass').value='whatever';
    w.__setPendingImport({encrypted:true,iterations:1e12,salt:'AAAAAAAAAAAAAAAAAAAAAA==',iv:'AAAAAAAAAAAAAAAA',cipher:'AAAA'});
    const t=Date.now(); await w.doImportDecrypt();
    ok(/invalid key-derivation/.test($('impError').textContent)&&Date.now()-t<500,'doImportDecrypt refuses an absurd count without deriving');
    w.__setPendingImport(null);
  }

  // ---- backups: legacy (no field), 250k, and 600k all still open
  const makeBackup=async(iterations,pass,omit)=>{
    const salt=w.crypto.getRandomValues(new Uint8Array(16)); const key=await w.deriveKey(pass,salt,iterations);
    const {iv,cipher}=await w.encryptJSON(key,{items:[]});
    const o={app:'shelfmark',encrypted:true,kdf:'PBKDF2',iterations,salt:b64(salt),iv:b64(iv),cipher:b64(cipher)}; if(omit) delete o.iterations; return o;
  };
  for(const [label,it,omit] of [['old backup with no iterations field (made at 250k)',250000,true],['backup made at 250,000',250000,false],['backup made at 600,000',600000,false]]){
    const bk=await makeBackup(it,'backup-pass',omit);
    alerts=[]; await w.onImportFile(fakeFile(bk));
    ok($('importPassOverlay').style.display==='flex',label+': passphrase prompt opens');
    $('imppass').value='wrong'; $('impError').textContent=''; await w.doImportDecrypt();
    ok($('impError').textContent==='Incorrect passphrase.',label+': wrong passphrase -> "Incorrect passphrase."');
    $('imppass').value='backup-pass'; $('impError').textContent=''; try{ await w.doImportDecrypt(); }catch(e){}
    ok($('impError').textContent===''&&$('importPassOverlay').style.display==='none',label+': right passphrase opens it');
    w.eval("closeImportPassModal()");
  }

  // ---- strength hint: advisory only
  { const H=w.passHintText;
    ok(H('')===''&&H('abc')==='','no hint while typing the first 3 characters (the 4-char error covers that)');
    for(const weak of ['1234','abcd','abcdefg','123456789']) ok(H(weak)!=='','hint shown for '+weak);
    for(const good of ['abcdefgh','correct horse','1234567890','Tr0ub4dor&3']) ok(H(good)==='','no hint for '+good);
    ok(/4 still works/.test(H('1234')),'hint says 4 characters still works');
    const inp=$('authPass1'), hint=$('passHintAuth'), gate=$('authPass2');
    gate.style.display='block'; inp.value='1234'; w.updatePassHint(inp); ok(hint.textContent!=='','hint appears in the set-passcode dialog');
    gate.style.display='none'; w.updatePassHint(inp); ok(hint.textContent==='','hint hidden when the field is used to enter an existing passcode');
    const ex=$('exppass'); ex.value='abcd'; w.updatePassHint(ex); ok($('passHintExport').textContent!=='','hint appears for a short backup passphrase');
    w.openExportModal(); ok($('passHintExport').textContent==='','hints are cleared when a dialog is reopened');
  }

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
