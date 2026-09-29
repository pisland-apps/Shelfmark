// Dev-only: makes the fixtures in fixtures/ by running a v1.51.14 (or older) project's real export.
// Run once against the OLD project:  node make_legacy_fixtures.js /path/to/v1.51.14/
// The results are checked in so test_export_stream.js can prove old backups still import.
process.on('unhandledRejection',e=>console.log('UNHANDLED',e&&e.stack||e));
const fs=require('fs'), {Blob:NB}=require('buffer');
const w=require('./load.js')(process.argv[2]);
w.Blob=NB; w.blobToDataURL=async b=>'data:'+(b.type||'application/octet-stream')+';base64,'+Buffer.from(await b.arrayBuffer()).toString('base64');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await sleep(300);
  await w.eval("createPasscode('fixture-pass')");
  const bytes=n=>{const b=new Uint8Array(n); for(let i=0;i<n;i++) b[i]=(i*31+7)&255; return b;};
  await w.put({id:'n1',title:'Old note',category:'Notes',type:'markdown',mime:'text/markdown',content:'Hello 你好 ✓ old\n\n```js\nx\n```',addedAt:1000,updatedAt:2000});
  await w.put({id:'p1',title:'Old pdf',category:'Docs',type:'pdf',mime:'application/pdf',content:new NB([bytes(5000)],{type:'application/pdf'}),addedAt:1100,updatedAt:2100,progress:{page:3},bookmarks:[{page:2}]});
  await w.put({id:'a1',title:'Old audio',category:'Rec',type:'audio',mime:'audio/mpeg',content:new NB([bytes(1)],{type:'audio/mpeg'}),addedAt:1200,updatedAt:2200});
  w.__setPref('shelfName','Fixture shelf');
  let out={};
  w.downloadBlob=async(blob,name)=>{ out[name]=Buffer.from(await blob.arrayBuffer()); };
  const run=async(mode,pass)=>{
    w.setExportMode(mode);
    w.document.getElementById('exppass').value=pass||''; w.document.getElementById('exppass2').value=pass||'';
    await w.doExport();
  };
  await run('plain'); await run('enc','fixture-pass');
  for(const [name,buf] of Object.entries(out)){ const f=name.endsWith('.enc.json')?'legacy-enc.json':'legacy-plain.json'; fs.writeFileSync(__dirname+'/fixtures/'+f,buf); console.log('wrote',f,buf.length); }
  process.exit(0);
})();
