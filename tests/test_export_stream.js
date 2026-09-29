// v1.52.0: chunked, streamed backup format (v2) + one-item-at-a-time import.
// Chunk size is a parameter (__setChunk) so tiny chunks exercise the off-by-one cases quickly.
// Run: node test_export_stream.js [path-to-project-dir/]   (against v1.51.14 the v2 tests must FAIL)
process.on('unhandledRejection',e=>{ if(!(e&&e.code==='ERR_MODULE_NOT_FOUND')) console.log('UNHANDLED',e&&e.stack||e); });
const fs=require('fs'), {Blob:NB}=require('buffer'), {webcrypto}=require('crypto');
const w=require('./load.js')(process.argv[2]);
w.Blob=NB; w.fetch=fetch;
w.blobToDataURL=async b=>'data:'+(b.type||'application/octet-stream')+';base64,'+Buffer.from(await b.arrayBuffer()).toString('base64');
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let alerts=[]; w.alert=m=>alerts.push(String(m)); const last=()=>alerts[alerts.length-1]||'';
const PASS='correct horse';
const bytes=(len,seed)=>{ const b=new Uint8Array(len); for(let i=0;i<len;i++) b[i]=(i*31+(seed||7))&255; return b; };
const eq=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const MD='héllo 你好 🙂 line\n'.repeat(9);        // multi-byte characters straddle tiny chunk borders
const items=[
  {id:'n1',title:'Note',category:'A',type:'markdown',mime:'text/markdown',content:MD,addedAt:100,updatedAt:200},
  {id:'p1',title:'Pdf',category:'B',type:'pdf',mime:'application/pdf',content:new NB([bytes(100)],{type:'application/pdf'}),addedAt:101,updatedAt:201,progress:{page:4},bookmarks:[{page:1}]},
  {id:'p2',title:'Exact multiple',category:'B',type:'pdf',mime:'application/pdf',content:new NB([bytes(14,3)],{type:'application/pdf'}),addedAt:102,updatedAt:202},
  {id:'a1',title:'Empty audio',category:'C',type:'audio',mime:'audio/mpeg',content:new NB([new Uint8Array(0)],{type:'audio/mpeg'}),addedAt:103,updatedAt:203},
  {id:'i1',title:'One byte',category:'C',type:'image',mime:'image/png',content:new NB([new Uint8Array([9])],{type:'image/png'}),addedAt:104,updatedAt:204},
  {id:'n2',title:'Empty note',category:'A',type:'markdown',mime:'text/markdown',content:'',addedAt:105,updatedAt:205},
];
const grab=()=>{ const o={files:[]}; w.downloadBlob=async(blob,name)=>{ o.files.push({name,buf:Buffer.from(await blob.arrayBuffer())}); }; return o; };
async function doExport(mode,pass,pass2){
  const o=grab(); w.setExportMode(mode);
  w.document.getElementById('exppass').value=pass||''; w.document.getElementById('exppass2').value=pass2===undefined?(pass||''):pass2;
  await w.doExport(); return o.files[0]||null;
}
const asFile=(buf)=>new NB([buf]);
async function importBuf(buf,pass){
  alerts=[]; w.document.getElementById('impError').textContent='';
  await w.onImportFile({target:{files:[asFile(buf)],value:''}});
  if(pass!==undefined){ w.document.getElementById('imppass').value=pass; await w.doImportDecrypt(); }
}
async function clearShelf(){ for(const m of await w.getAll()) await w.del(m.id); }
async function snapshot(){
  const out={}; for(const m of await w.getAll()){ const f=await w.getOne(m.id); out[m.id]={m:f, c: typeof f.content==='string'?f.content:new Uint8Array(await f.content.arrayBuffer())}; }
  return out;
}
function sameShelf(snap){
  for(const it of items){
    const s=snap[it.id]; if(!s) return 'missing '+it.id;
    const want= typeof it.content==='string'? it.content : null;
    if(want!==null){ if(s.c!==want) return 'text differs '+it.id; }
    else { const b=new Uint8Array(0); }
    if(s.m.title!==it.title||s.m.category!==it.category||s.m.type!==it.type||s.m.mime!==it.mime||s.m.addedAt!==it.addedAt||s.m.updatedAt!==it.updatedAt) return 'meta differs '+it.id;
  }
  return '';
}
// Reference bytes of each binary item, captured before export.
const ref={}; 

(async()=>{
  await sleep(300);
  await w.eval("createPasscode('test1234')");
  for(const it of items) await w.put(it);
  for(const it of items) if(typeof it.content!=='string') ref[it.id]=new Uint8Array(await it.content.arrayBuffer());
  await w.render(); // sets the empty-shelf hint the way the real UI does
  const fullCheck=async(label)=>{
    const s=await snapshot(); const d=sameShelf(s);
    ok(d==='',label+': metadata and text identical'+(d?' ('+d+')':''));
    let bin=true; for(const id of Object.keys(ref)){ if(!s[id]||!eq(s[id].c,ref[id])){ bin=false; console.log('   binary differs',id); } }
    ok(bin,label+': every binary item is byte-for-byte identical (incl. zero-byte and exact-multiple)');
    ok(s.p1.m.progress&&s.p1.m.progress.page===4&&s.p1.m.bookmarks.length===1,label+': progress and bookmarks kept');
  };

  // ---- encrypted v2 round trip with tiny chunks ----
  w.__setChunk(7);
  const f=await doExport('enc',PASS);
  ok(f&&f.name.endsWith('.shelfmark'),'encrypted export is a .shelfmark file: '+(f&&f.name));
  const text=f.buf.toString('latin1');
  ok(f.buf.slice(0,11).toString()==='SHELFMARK2\n','starts with the v2 magic');
  ok(!text.includes('Pdf')&&!text.includes('héllo')&&!f.buf.includes(Buffer.from('héllo')),'no titles or text readable in the file');
  const hdr=JSON.parse(f.buf.slice(11,f.buf.indexOf(10,11)).toString());
  ok(hdr.format===2&&hdr.encrypted===true&&hdr.chunkSize===7&&hdr.itemCount===6&&hdr.iterations===600000&&typeof hdr.shelfId==='string','header fields');
  const f2=await doExport('enc',PASS);   // a second, separate backup of the same shelf (used to graft frames)
  await clearShelf();
  await importBuf(f.buf,undefined);
  ok(w.document.getElementById('importPassOverlay').style.display==='flex','v2 file opens the passphrase prompt');
  w.document.getElementById('imppass').value='wrong wrong'; await w.doImportDecrypt();
  ok(w.document.getElementById('impError').textContent==='Incorrect passphrase.','wrong passphrase reads as "Incorrect passphrase." (not damaged)');
  ok((await w.getAll()).length===0,'wrong passphrase imported nothing');
  alerts=[]; w.document.getElementById('imppass').value=PASS; await w.doImportDecrypt();
  ok(/added 6 new items\./.test(last()),'right passphrase: 6 items added: '+last());
  await fullCheck('v2 round trip');
  ok(w.document.getElementById('importPassOverlay').style.display==='none','prompt closed after import');

  // ---- chunk sizes around the item sizes (1, exact multiples, bigger than everything) ----
  for(const c of [1,14,100,101,1000]){
    w.__setChunk(c); const g=await doExport('enc',PASS); await clearShelf(); await importBuf(g.buf,PASS);
    ok(/added 6 new items\./.test(last()),'chunk '+c+': imports all 6');
    const s=await snapshot(); let good=sameShelf(s)===''; for(const id of Object.keys(ref)) if(!s[id]||!eq(s[id].c,ref[id])) good=false;
    ok(good,'chunk '+c+': content identical');
  }
  w.__setChunk(7);

  // ---- tamper / truncate / reorder: must fail whole, importing nothing ----
  const tamper=async(label,buf,pass=PASS)=>{
    await clearShelf(); await importBuf(buf,pass);
    const cnt=(await w.getAll()).length;
    const shown=w.document.getElementById('impError').textContent+' '+last();
    ok(cnt===0&&/damaged, incomplete, or has been changed/.test(shown),label+': refused, nothing imported ('+cnt+' items)');
    ok(!/Incorrect passphrase/.test(w.document.getElementById('impError').textContent),label+': not reported as a wrong passphrase');
    w.closeImportPassModal();
  };
  const b=f.buf;
  await tamper('truncated by 1 byte',b.subarray(0,b.length-1));
  await tamper('truncated by half',b.subarray(0,Math.floor(b.length/2)));
  { const c=Buffer.from(b); c[c.length-40]^=1; await tamper('flipped byte near the end',c); }
  { const c=Buffer.from(b); c[Math.floor(c.length/2)]^=0x80; await tamper('flipped byte in the middle',c); }
  await tamper('extra bytes appended',Buffer.concat([b,Buffer.from([1,2,3])]));
  // frame walker used to split the file for structural edits
  const frames=(buf)=>{ let pos=buf.indexOf(10,11)+1; const head=buf.subarray(0,pos), fr=[]; while(pos<buf.length){ const len=buf.readUInt32BE(pos); const end=pos+5+12+len; fr.push(buf.subarray(pos,end)); pos=end; } return {head,fr}; };
  const {head,fr}=frames(b);
  ok(fr.length>10,'frame walker splits the file ('+fr.length+' frames)');
  await tamper('a frame dropped from the middle',Buffer.concat([head,...fr.filter((_,i)=>i!==7)]));
  { const a=[...fr]; [a[6],a[7]]=[a[7],a[6]]; await tamper('two frames swapped',Buffer.concat([head,...a])); }
  { const a=[...fr]; a.splice(8,0,a[8]); await tamper('a frame duplicated',Buffer.concat([head,...a])); }
  await tamper('trailer removed (clean cut after last item)',Buffer.concat([head,...fr.slice(0,-1)]));
  { const a=[...fr]; a[a.length-1]=Buffer.from(fr[a.length-1]); a[a.length-1][4]^=1; await tamper('last-flag flipped on the trailer',Buffer.concat([head,...a])); }
  { // header edited (item count) -> hash in every frame no longer matches
    const hj=JSON.parse(head.subarray(11,head.length-1).toString()); hj.itemCount=5;
    await tamper('header itemCount edited',Buffer.concat([Buffer.from('SHELFMARK2\n'+JSON.stringify(hj)+'\n'),...fr])); }
  { // frames grafted from a different backup made with the same passphrase
    const o=frames(f2.buf);
    await tamper('frame from another backup spliced in',Buffer.concat([head,...fr.slice(0,7),o.fr[7],...fr.slice(8)])); }
  // hostile headers
  for(const [label,patch] of [['iterations 0',{iterations:0}],['iterations huge',{iterations:99999999}],['iterations string',{iterations:'600000'}],['chunkSize huge',{chunkSize:2**31}],['chunkSize 0',{chunkSize:0}],['itemCount negative',{itemCount:-1}],['itemCount huge',{itemCount:1e9}],['salt wrong length',{salt:'AAAA'}]]){
    const hj={...hdr,...patch}; await clearShelf(); alerts=[];
    await w.onImportFile({target:{files:[asFile(Buffer.concat([Buffer.from('SHELFMARK2\n'+JSON.stringify(hj)+'\n'),...fr]))],value:''}});
    ok(w.document.getElementById('importPassOverlay').style.display!=='flex'&&/can't be opened|Couldn't read/.test(last()),'hostile header refused before any work: '+label);
  }
  { // a frame declaring an absurd length must not allocate or hang
    const evil=Buffer.from(fr[3]); evil.writeUInt32BE(0xfffffff0,0);
    await tamper('frame length field 4 GB',Buffer.concat([head,...fr.slice(0,3),evil,...fr.slice(4)])); }
  // Only real WebCrypto refusals count as "auth failure" elsewhere; here also make sure the wrong-key path is the only one saying "Incorrect".
  { const c=Buffer.from(b); c[head.length+5+12+2]^=1; // damage the key-check frame itself -> indistinguishable from a wrong key
    await clearShelf(); await importBuf(c,PASS); ok(/Incorrect passphrase/.test(w.document.getElementById('impError').textContent),'a damaged key-check frame reads as wrong passphrase (nothing else can tell them apart)'); w.closeImportPassModal(); }

  // ---- streamed save path (showSaveFilePicker) ----
  await clearShelf(); for(const it of items) await w.put(it);
  { const writes=[]; let closed=false, aborted=false, pickerCalledSync=false, awaited=false;
    w.showSaveFilePicker=async(opts)=>{ pickerCalledSync=!awaited; return { createWritable:async()=>({ write:async x=>{ writes.push(Buffer.from(typeof x==='string'?Buffer.from(x):x)); }, close:async()=>{ closed=true; }, abort:async()=>{ aborted=true; } }) }; };
    w.setExportMode('enc'); w.document.getElementById('exppass').value=PASS; w.document.getElementById('exppass2').value=PASS;
    const p=w.doExport(); awaited=true; await p;
    ok(pickerCalledSync,'save picker is opened synchronously from the click (before any await)');
    ok(closed&&!aborted&&writes.length>=6*3,'streamed: many small writes, then close ('+writes.length+' writes)');
    ok(Math.max(...writes.map(x=>x.length))<1000,'streamed: no single write is the whole shelf');
    const joined=Buffer.concat(writes); await clearShelf(); await importBuf(joined,PASS); ok(/added 6 new items\./.test(last()),'streamed file imports');
    // picker cancelled
    await clearShelf(); for(const it of items) await w.put(it);
    w.showSaveFilePicker=async()=>{ const e=new Error('x'); e.name='AbortError'; throw e; };
    const o=grab(); w.document.getElementById('expError').textContent='';
    await w.doExport(); ok(o.files.length===0&&w.document.getElementById('expError').textContent==='','picker closed: nothing written, no error shown');
    ok(w.document.getElementById('expGoBtn').disabled===false&&!w.__exportRunning(),'picker closed: Export button usable again');
    // cancel mid-export aborts the writable
    let ab2=false,cl2=false; let nwr=0;
    w.showSaveFilePicker=async()=>({ createWritable:async()=>({ write:async()=>{ if(++nwr===4) w.__setExportCancel(true); }, close:async()=>{ cl2=true; }, abort:async()=>{ ab2=true; } }) });
    await w.doExport(); ok(ab2&&!cl2,'cancel mid-export: writable aborted (no partial file kept), not closed');
    w.__setExportCancel(false); delete w.showSaveFilePicker;
    // error mid-write is reported and aborts
    let ab3=false; w.showSaveFilePicker=async()=>({ createWritable:async()=>({ write:async()=>{ throw new Error('disk full'); }, close:async()=>{}, abort:async()=>{ ab3=true; } }) });
    await w.doExport(); ok(ab3&&/Export failed: disk full/.test(w.document.getElementById('expError').textContent),'write error: reported, writable aborted');
    delete w.showSaveFilePicker; w.document.getElementById('expError').textContent=''; }

  // ---- validation before any file work ----
  { const o=grab(); w.setExportMode('enc'); w.document.getElementById('exppass').value='abc'; w.document.getElementById('exppass2').value='abc'; await w.doExport();
    ok(/at least 4/.test(w.document.getElementById('expError').textContent)&&o.files.length===0,'short passphrase refused');
    w.document.getElementById('exppass').value='abcd'; w.document.getElementById('exppass2').value='abce'; await w.doExport();
    ok(/don't match/.test(w.document.getElementById('expError').textContent)&&o.files.length===0,'mismatched passphrases refused'); }

  // ---- plain export: same JSON format as before, readable by the OLD importer logic ----
  { w.__setChunk(8*1024*1024); const pf=await doExport('plain'); ok(pf&&pf.name.endsWith('.json'),'plain export is .json');
    const j=JSON.parse(pf.buf.toString());
    ok(j.encrypted===false&&j.itemCount===6&&Array.isArray(j.items)&&j.items.length===6&&j.app==='shelfmark','plain: same header + items[] shape as v1.51.14');
    ok(j.items.find(x=>x.id==='p1').content.startsWith('data:application/pdf;base64,')&&j.items.find(x=>x.id==='n1').content===MD,'plain: data: URLs for binaries, text for notes');
    await clearShelf(); await importBuf(pf.buf); ok(/added 6 new items\./.test(last()),'plain round trip');
    const s=await snapshot(); let good=sameShelf(s)===''; for(const id of Object.keys(ref)) if(!s[id]||!eq(s[id].c,ref[id])) good=false; ok(good,'plain round trip: identical'); }

  // ---- old backups (fixtures made by v1.51.14) still import unchanged ----
  { await clearShelf();
    await importBuf(fs.readFileSync(__dirname+'/fixtures/legacy-plain.json')); ok(/added 3 new items\./.test(last()),'v1.51.14 PLAIN backup imports: '+last());
    const p=await w.getOne('p1'); ok(p&&p.content.size===5000&&p.progress.page===3,'legacy plain: pdf bytes + progress intact');
    await clearShelf();
    await importBuf(fs.readFileSync(__dirname+'/fixtures/legacy-enc.json'),'wrong pass'); ok(w.document.getElementById('impError').textContent==='Incorrect passphrase.','legacy encrypted: wrong passphrase message unchanged');
    await importBuf(fs.readFileSync(__dirname+'/fixtures/legacy-enc.json'),'fixture-pass'); ok(/added 3 new items\./.test(last()),'v1.51.14 ENCRYPTED backup imports: '+last());
    ok((await w.getOne('n1')).content.startsWith('Hello 你好'),'legacy encrypted: note text intact');
    // legacy invalid iterations still refused early; bare array still accepted
    const enc=JSON.parse(fs.readFileSync(__dirname+'/fixtures/legacy-enc.json','utf8')); enc.iterations=0; await importBuf(Buffer.from(JSON.stringify(enc)));
    ok(/key-derivation setting is invalid/.test(last()),'legacy invalid iterations still refused');
    await clearShelf(); await importBuf(Buffer.from(JSON.stringify([{id:'x1',title:'Bare',type:'markdown',content:'hi',addedAt:1}]))); ok(/added 1 new item\./.test(last()),'bare-array legacy file still accepted'); }

  // ---- old-format size guard ----
  { const big={size:300*1024*1024,slice:()=>({arrayBuffer:async()=>new TextEncoder().encode('{"app":"sh').buffer})}; alerts=[];
    await w.onImportFile({target:{files:[big],value:''}}); ok(/too large/.test(last())&&/older single-string format/.test(last()),'oversize old-format file refused with a clear message'); }

  // ---- merge rules through v2: identity adoption, newer-wins ----
  { w.__setChunk(50); await clearShelf(); for(const it of items) await w.put(it);
    const g=await doExport('enc',PASS); await clearShelf();
    w.__setPref('shelfId','other-shelf'); await importBuf(g.buf,PASS);
    ok(/added 6 new items\./.test(last()),'import into an empty shelf');
    ok(w.__getPref('shelfId')===JSON.parse(g.buf.slice(11,g.buf.indexOf(10,11)).toString()).shelfId,'empty shelf adopts the backup\'s identity');
    // newer on shelf is kept; older on shelf is replaced
    await w.put({...items[0],content:'shelf copy is newer',updatedAt:9999}); await w.put({...items[1],title:'Pdf old on shelf',updatedAt:5});
    await importBuf(g.buf,PASS);
    ok(/updated 5 existing items, left 1 item/.test(last())&&/left 1 item unchanged because your shelf already has a newer copy/.test(last()),'newer-wins applies per item: '+last());
    ok((await w.getOne('n1')).content==='shelf copy is newer'&&(await w.getOne('p1')).title==='Pdf','newer copy kept, older one replaced'); }

  // ---- cancel while importing: before pass 2 nothing changes; the prompt closes ----
  { await clearShelf(); w.__setChunk(7); await importBuf(f.buf,undefined); w.closeImportPassModal();
    ok(w.document.getElementById('importPassOverlay').style.display==='none','Cancel closes the import prompt');
    w.document.getElementById('imppass').value=PASS; alerts=[]; await w.doImportDecrypt(); ok((await w.getAll()).length===0&&alerts.length===0,'after Cancel a stray Import click does nothing'); }

  // ---- auto-lock must be held during export and import ----
  { const holds=[]; const orig=w.holdAutoLock; ok(typeof orig==='function','holdAutoLock exists');
    ok(/holdAutoLock\(doExportInner\)/.test(fs.readFileSync((process.argv[2]||__dirname+'/../')+'app.js','utf8'))&&/holdAutoLock\(doImportDecryptInner\)/.test(fs.readFileSync((process.argv[2]||__dirname+'/../')+'app.js','utf8')),'export and import are still wrapped in holdAutoLock'); }

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
