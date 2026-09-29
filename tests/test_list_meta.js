// v1.52.3: listing reads metadata only. getAll() must give exactly what it gave
// before (plain, id-bound and old-format records) without holding content ciphertext.
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const big=n=>{ const b=new Uint8Array(n); return { arrayBuffer:async()=>b.buffer.slice(0) }; };
(async()=>{
  await sleep(300); w.alert=()=>{};
  await w.eval("createPasscode('test1234')");
  await w.put({id:'n1',type:'markdown',title:'Note',category:'A',addedAt:1,content:'hello'});
  await w.put({id:'p1',type:'pdf',title:'Book',mime:'application/pdf',addedAt:2,content:big(3*1048576)});
  // an old-format record (written before id binding: no AAD, no markers)
  const oldMeta={type:'markdown',title:'Old note',addedAt:3};
  const m=await w.eval("encryptJSON(cryptoKey, "+JSON.stringify(oldMeta)+")"), c=await w.eval("aesEncrypt(cryptoKey, new TextEncoder().encode('old text'))");
  await w.eval("(async()=>{})()");
  w.__old={id:'o1',metaIv:m.iv,metaCipher:m.cipher,contentIv:c.iv,contentCipher:c.cipher};
  await w.eval("putRaw(window.__old)");

  const all=await w.getAll();
  ok(all.length===3,'all three items are listed');
  const by=Object.fromEntries(all.map(x=>[x.id,x]));
  ok(by.n1.title==='Note'&&by.n1.category==='A'&&by.p1.title==='Book'&&by.o1.title==='Old note','titles and fields come through for bound and old-format records');
  ok(all.every(x=>!('content' in x)&&!('contentCipher' in x)&&!('contentIv' in x)),'no content fields in the listing');

  const raws=await w.eval("getAllMetaRaw()");
  ok(raws.length===3&&raws.every(r=>Object.keys(r).sort().join()==='id,metaBound,metaCipher,metaIv'),'the cursor keeps only id + the meta blob (no content ciphertext held)');

  const old=await w.eval("getAllRaw().then(rs=>Promise.all(rs.map(decryptMeta)))");
  const norm=a=>JSON.stringify(a.slice().sort((x,y)=>x.id<y.id?-1:1));
  ok(norm(all)===norm(old),'identical to the previous full-record implementation');

  ok((await w.eval("getMeta('p1')")).title==='Book'&&(await w.eval("getMeta('nope')"))===null,'getMeta reads one item, and null for a missing id');
  ok((await w.eval("getOne('n1')")).content==='hello','getOne still returns content');

  // a record deleted while another listing is running does not break it
  const [l,_d]=await Promise.all([w.getAll(), w.eval("del('n1')")]);
  ok(Array.isArray(l),'listing while a delete is in flight does not throw');

  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
