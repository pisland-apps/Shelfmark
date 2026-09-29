// v1.51.13: AES-GCM item-id binding. Every encrypted blob of an item record is sealed with
// additional data naming the record id + which blob it is, so a blob copied onto another id
// (or swapped into another slot) no longer decrypts. Records written before v1.51.13 have no
// binding and must keep opening; they pick it up when next written or on a passcode change.
// Legacy records here are built with raw WebCrypto (NOT the app's helpers) so they are a fair
// stand-in for what v1.51.12 left on disk.
// Run: node test_item_binding.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
const {webcrypto}=require('crypto');
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const enc=s=>new TextEncoder().encode(s), dec=b=>new TextDecoder().decode(b);
const note=(id,title,content)=>({id,title,category:'C',type:'markdown',mime:'text/markdown',content,addedAt:1,updatedAt:1});
const raw=id=>w.eval(`getOneRaw(${JSON.stringify(id)})`);
const putRaw=rec=>w.putRaw(rec);
// Only a genuine decryption failure counts: a ReferenceError or typo in a test must not pass as "refused".
const throws=async f=>{ try{ await f(); return false; }catch(e){ return !!e&&e.name==='OperationError'; } };

// v1.51.12-style blob: AES-GCM, no additional data, straight from WebCrypto with the app's key.
async function legacyBlob(bytes){
  const key=w.__key(); const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
  return {iv,cipher};
}
async function legacyRecord(id,meta,content,extra){
  const m=await legacyBlob(enc(JSON.stringify(meta)));
  const c=await legacyBlob(enc(content));
  return {id,metaIv:m.iv,metaCipher:m.cipher,contentIv:c.iv,contentCipher:c.cipher,...(extra||{})};
}
const legacyMeta=(title)=>({title,category:'C',type:'markdown',mime:'text/markdown',addedAt:1,updatedAt:1});

(async()=>{
  await sleep(300);
  await w.eval("createPasscode('test1234')");
  w.alert=()=>{};

  // 1. new writes are bound
  await w.put(note('n1','New note','new body'));
  let r=await raw('n1');
  ok(r.metaBound===true&&r.contentBound===true,'a new item is stored with both blobs marked bound');
  ok((await w.getOne('n1')).content==='new body'&&(await w.getOne('n1')).title==='New note','a bound item round-trips (getOne)');
  ok((await w.getAll()).some(x=>x.id==='n1'),'a bound item shows in the listing (getAll)');
  ok(await throws(()=>w.eval('aesDecrypt')(w.__key(),r.metaIv,r.metaCipher)),'a bound blob does NOT open without its additional data (the binding is real)');

  // 2. THE POINT: a record copied onto a different id fails
  await putRaw({...r,id:'n1-copy'});
  ok(await throws(()=>w.getOne('n1-copy')),'a record copied onto another id fails to open (getOne)');
  ok(await throws(()=>w.eval("getOneRaw('n1-copy').then(decryptMeta)")),'... its metadata fails too');
  ok((await w.getOne('n1')).content==='new body','the original record is unaffected');
  await w.del('n1-copy');

  // 3. a blob swapped into another slot fails
  const sw={...r,id:'n1-swap',metaIv:r.contentIv,metaCipher:r.contentCipher,contentIv:r.metaIv,contentCipher:r.metaCipher};
  await putRaw(sw);
  ok(await throws(()=>w.getOne('n1-swap')),'metadata and content swapped inside one record fails');
  await w.del('n1-swap');

  // 4. records written the OLD way still open (no marker, no additional data)
  await putRaw(await legacyRecord('old1',legacyMeta('Old note'),'old body'));
  ok((await w.getOne('old1')).content==='old body'&&(await w.getOne('old1')).title==='Old note','an old-format record opens (getOne)');
  ok((await w.getAll()).some(x=>x.id==='old1'&&x.title==='Old note'),'an old-format record shows in the listing');

  // 5. a lost marker can never lock anyone out: a bound blob with its marker removed still opens
  const noMark={...(await raw('n1')),id:'n1'}; delete noMark.metaBound; delete noMark.contentBound; await putRaw(noMark);
  ok((await w.getOne('n1')).content==='new body','a bound record whose markers were lost still opens (safety net)');
  await w.put(note('n1','New note','new body')); // put it back the normal way
  // ... and the reverse is strict: an old blob claiming to be bound is refused
  const lying=await legacyRecord('old-lie',legacyMeta('Lie'),'x',{metaBound:true,contentBound:true});
  await putRaw(lying);
  ok(await throws(()=>w.getOne('old-lie')),'an old-format blob claiming to be bound is refused');
  await w.del('old-lie');

  // 6. decrypt count: each blob is opened once, not tried twice (a big old PDF must not pay double)
  const realDec=w.aesDecrypt; let calls=0; w.aesDecrypt=async(...a)=>{ calls++; return realDec(...a); };
  await w.getOne('old1'); const oldCalls=calls; calls=0;
  await w.getOne('n1'); const newCalls=calls; w.aesDecrypt=realDec;
  ok(oldCalls===2,'opening an old-format item does 2 decrypts (meta + content), no wasted first attempt (got '+oldCalls+')');
  ok(newCalls===2,'opening a bound item does 2 decrypts (got '+newCalls+')');

  // 7. old records pick up the binding when next written, one blob at a time
  await putRaw(await legacyRecord('old2',legacyMeta('Rename me'),'old2 body'));
  await w.putMetaOnly('old2',{title:'Renamed'});
  r=await raw('old2');
  ok(r.metaBound===true&&!r.contentBound,'renaming an old item binds its metadata; its content is left as it was');
  const o2=await w.getOne('old2'); ok(o2.title==='Renamed'&&o2.content==='old2 body','... and it still opens fully (mixed bound/old blobs)');
  await w.putContentOnly('old2','markdown','edited body');
  r=await raw('old2');
  ok(r.metaBound===true&&r.contentBound===true,'saving a note binds its content too');
  ok((await w.getOne('old2')).content==='edited body','... and reads back');
  await putRaw(await legacyRecord('old3',legacyMeta('Folder note'),'disk text'));
  await w.eval("putContentOnlyRaw('old3','from disk')");
  ok((await raw('old3')).contentBound===true&&(await w.getOne('old3')).content==='from disk','folder-sync content write (putContentOnlyRaw) binds and reads back');

  // 8. drafts: bound on write, old ones readable, clear removes the marker
  await w.putDraft('n1','draft text');
  r=await raw('n1');
  ok(r.draftBound===true,'a draft is stored bound');
  ok((await w.getDraft('n1')).text==='draft text','... and reads back');
  await w.clearDraft('n1');
  r=await raw('n1');
  ok(!r.draftIv&&!r.draftCipher&&!('draftBound' in r),'clearing a draft removes its blob and its marker');
  const od=await legacyBlob(enc(JSON.stringify({text:'old draft',savedAt:5})));
  await putRaw({...(await raw('old1')),draftIv:od.iv,draftCipher:od.cipher});
  ok((await w.getDraft('old1')).text==='old draft','an old-format draft is still offered back');
  await w.putDraft('old1','newer draft');
  ok((await w.getDraft('old1')).text==='newer draft'&&(await raw('old1')).draftBound===true,'the next autosave rewrites an old draft bound');
  await w.clearDraft('old1');
  await putRaw({...(await raw('n1')),draftIv:r.metaIv,draftCipher:r.metaCipher,draftBound:true}); // a draft blob from the wrong slot
  ok((await w.getDraft('n1'))===null,'a draft blob that fails to verify is ignored (getDraft returns null, no crash)');
  await w.clearDraft('n1');

  // 9. passcode change: old + bound + draft all end up bound under the NEW key and open
  await putRaw(await legacyRecord('old4',legacyMeta('Old with draft'),'old4 body'));
  await w.putDraft('old4','unsaved words');
  const b=await w.eval("buildPasscodeAuth('another-passcode-9')");
  await w.eval('reencryptEverything').call(w,b.key,b.rec);
  const all=await w.eval('getAllRawStrict()');
  const stillOld=all.filter(x=>!x.metaBound||!x.contentBound||(x.draftCipher&&!x.draftBound));
  ok(all.length>=5&&stillOld.length===0,'after a passcode change every blob of every record is bound ('+all.length+' records)');
  const o4=await w.getOne('old4'); ok(o4.content==='old4 body'&&o4.title==='Old with draft','an old record opens after the passcode change');
  ok((await w.getDraft('old4')).text==='unsaved words','its draft opens after the passcode change');
  ok((await w.getOne('n1')).content==='new body'&&(await w.getOne('old1')).content==='old body','other records open after the passcode change');
  ok(await throws(()=>w.eval('aesDecrypt')(w.__key(),all[0].metaIv,all[0].metaCipher)),'... and none open without additional data');

  // 10. copying still fails after re-encryption
  const rr=await raw('n1'); await putRaw({...rr,id:'n1-copy2'});
  ok(await throws(()=>w.getOne('n1-copy2')),'a copy made after the passcode change still fails');
  await w.del('n1-copy2');

  // 11. export -> wipe -> import: items go out as plain content and come back bound, under their own ids
  const items=await w.buildExportItems();
  ok(items.length>=4&&items.every(i=>typeof i.content==='string'),'export still yields plain items ('+items.length+')');
  for(const i of items) await w.del(i.id);
  ok((await w.getAll()).length===0,'shelf emptied');
  await w.eval('mergeImportedItems')(JSON.parse(JSON.stringify(items)),null);
  const back=await w.getAll();
  ok(back.length===items.length,'import restored every item');
  const rawBack=await w.eval('getAllRawStrict()');
  ok(rawBack.every(x=>x.metaBound&&x.contentBound),'imported items are stored bound');
  ok((await w.getOne('old1')).content==='old body'&&(await w.getOne('old2')).content==='edited body','imported items read back with the right content under their own ids');
  // importing over an existing id (update path)
  await w.eval('mergeImportedItems')([{...items.find(i=>i.id==='old1'),content:'from backup',updatedAt:99}],null);
  ok((await w.getOne('old1')).content==='from backup','importing onto an existing id updates it');
  // an old plain backup (no updatedAt, no shelf id) still imports
  await w.eval('mergeImportedItems')([{id:'oldbk1',title:'From old backup',category:'C',type:'markdown',mime:'text/markdown',addedAt:7,content:'legacy backup text'}],null);
  ok((await w.getOne('oldbk1')).content==='legacy backup text'&&(await raw('oldbk1')).metaBound===true,'an old-style backup item imports and is stored bound');

  // 12. encrypted backup files are unchanged (no additional data): the same functions round-trip and old files decrypt
  const salt=webcrypto.getRandomValues(new Uint8Array(16));
  const key=await w.eval('deriveKey')('backup-pass',salt,1000);
  const e=await w.eval('encryptJSON')(key,{items:[{id:'x'}]});
  const legacyFile=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:e.iv},key,enc(JSON.stringify({items:[{id:'x'}]})));
  ok(JSON.stringify((await w.eval('decryptJSON')(key,e.iv,e.cipher)).items)==='[{"id":"x"}]','backup encrypt/decrypt round-trips');
  ok(JSON.stringify((await w.eval('decryptJSON')(key,e.iv,legacyFile)).items)==='[{"id":"x"}]','a backup written by the old code decrypts (no additional data involved)');

  // 13. the unlock path still works on a fresh page load with the same database (verifier untouched)
  ok(await w.eval("verifyPasscode('another-passcode-9')"),'passcode verifier unchanged: the new passcode unlocks');
  ok(!(await w.eval("verifyPasscode('wrong')")),'... a wrong one does not');

  console.log(fails?('\n'+fails+' FAILED of '+n):('\nALL '+n+' PASSED')); process.exit(fails?1:0);
})().catch(e=>{ console.log('TEST CRASHED after '+n+' checks:',e&&e.stack||e); process.exit(2); });
