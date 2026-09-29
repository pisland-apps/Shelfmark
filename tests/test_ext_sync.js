// v1.51.7: folder sync tells rename / move / delete / already-on-shelf apart (extSync, real app.js in jsdom,
// against an in-memory fake folder). Run: node test_ext_sync.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };

// ---------- in-memory stand-in for a FileSystemDirectoryHandle ----------
const err=name=>Object.assign(new Error(name),{name});
class FFile{ constructor(name,text,mtime){ this.kind='file'; this.name=name; this.text=text; this.mtime=mtime; }
  async getFile(){ const s=this; return { name:s.name, lastModified:s.mtime, text:async()=>s.text }; } }
class FDir{ constructor(name){ this.kind='directory'; this.name=name; this.m=new Map(); }
  async *entries(){ for(const e of [...this.m]) yield e; }
  async getDirectoryHandle(k,o){ const v=this.m.get(k); if(v&&v.kind==='directory') return v; if(o&&o.create){ const d=new FDir(k); this.m.set(k,d); return d; } throw err('NotFoundError'); }
  async getFileHandle(k,o){ const v=this.m.get(k); if(v&&v.kind==='file') return v; if(o&&o.create){ const f=new FFile(k,'',0); this.m.set(k,f); return f; } throw err('NotFoundError'); }
  async queryPermission(){ return 'granted'; } async requestPermission(){ return 'granted'; } }
const root=new FDir('Vault'); let clock=1000;
const dirFor=(p,create)=>{ const parts=p.split('/'); let d=root; for(const x of parts.slice(0,-1)){ let c=d.m.get(x); if(!c){ if(!create) return null; c=new FDir(x); d.m.set(x,c);} d=c; } return d; };
const fs={
  write(p,t){ const d=dirFor(p,true), k=p.split('/').pop(); const f=d.m.get(k); if(f){ f.text=t; f.mtime=++clock; } else d.m.set(k,new FFile(k,t,++clock)); },
  remove(p){ dirFor(p).m.delete(p.split('/').pop()); },
  rename(a,b){ const da=dirFor(a), ka=a.split('/').pop(); const f=da.m.get(ka); da.m.delete(ka); const db=dirFor(b,true), kb=b.split('/').pop(); f.name=kb; db.m.set(kb,f); } // keeps mtime, like a real OS rename
};

const items=async()=>(await w.getAll()).filter(m=>m.type==='markdown');
const byTitle=async t=>(await items()).filter(m=>m.title===t);
let alerts=[]; w.alert=m=>alerts.push(m);
const sync=async(i)=>{ await w.eval(`extSync(${i?'true':'false'})`); };

(async()=>{
  await new Promise(r=>setTimeout(r,300));
  await w.eval("createPasscode('test1234')");
  w.__setExt(root,'Vault');

  // ---- pure matcher
  { const P=w.extPairMoves;
    const o=(id,path,content)=>({id,path,content});
    let r=P([o(1,'a.md','hello')],[{path:'b.md',text:'hello'}]);
    ok(r.size===1&&r.get('b.md').id===1,'matcher: same text, new name -> paired');
    r=P([o(1,'a.md','hello')],[{path:'b.md',text:'other'}]); ok(r.size===0,'matcher: different text -> not paired');
    r=P([o(1,'a.md','')],[{path:'b.md',text:''}]); ok(r.size===0,'matcher: empty files never pair');
    r=P([o(1,'a.md','   \n')],[{path:'b.md',text:'   \n'}]); ok(r.size===0,'matcher: whitespace-only files never pair');
    r=P([o(1,'x/n.md','same'),o(2,'y/m.md','same')],[{path:'z/m.md',text:'same'}]); ok(r.get('z/m.md').id===2,'matcher: prefers the orphan with the same file name');
    r=P([o(1,'x/n.md','same')],[{path:'p.md',text:'same'},{path:'q.md',text:'same'}]); ok(r.size===1,'matcher: one orphan is never paired twice');
    r=P([],[{path:'a.md',text:'t'}]); ok(r.size===0,'matcher: nothing orphaned -> nothing paired');
    const A=w.extPairAdopt, c=(id,title,content)=>({id,title,content});
    r=A([c(1,'Foo','hi')],[{path:'d/Foo.md',text:'hi'}]); ok(r.get('d/Foo.md').id===1,'adopt: same title + same text');
    r=A([c(1,'Custom','hi')],[{path:'Foo.md',text:'hi'}]); ok(r.get('Foo.md').id===1,'adopt: different title, text unique on both sides');
    r=A([c(1,'A','hi'),c(2,'B','hi')],[{path:'Foo.md',text:'hi'}]); ok(r.size===0,'adopt: two look-alike notes -> not guessed');
    r=A([c(1,'A','hi')],[{path:'X.md',text:'hi'},{path:'Y.md',text:'hi'}]); ok(r.size===0,'adopt: two look-alike files -> not guessed');
    r=A([c(1,'A','hi'),c(2,'B','hi')],[{path:'B.md',text:'hi'}]); ok(r.get('B.md').id===2,'adopt: title breaks the tie between look-alikes');
    r=A([c(1,'A','')],[{path:'X.md',text:''}]); ok(r.size===0,'adopt: empty text is never matched by content alone');
    r=A([c(1,'A','one')],[{path:'A.md',text:'two'}]); ok(r.size===0,'adopt: same title, different text -> not merged');
  }

  // ---- first sync
  fs.write('a.md','alpha text'); fs.write('Notes/b.md','bravo text');
  await sync(true);
  let all=await items();
  ok(all.length===2&&all.every(m=>m.extPath),'first sync adds both files, both linked');
  ok(/2 added/.test(alerts.pop()),'interactive summary reports the additions');
  const idA=(await byTitle('a'))[0].id, idB=(await byTitle('b'))[0].id;
  ok((await byTitle('b'))[0].category==='Notes','file in a subfolder gets that folder as category');

  // ---- regression: editing a file on disk still updates in place
  fs.write('a.md','alpha text v2'); await sync(false);
  ok((await w.getOne(idA)).content==='alpha text v2'&&(await items()).length===2,'edited file updates the same item (no duplicate)');

  // ---- rename in same folder
  fs.rename('a.md','renamed.md'); await sync(true);
  all=await items(); const A=all.find(m=>m.id===idA);
  ok(all.length===2,'rename: still 2 items (no duplicate)');
  ok(A&&A.extPath==='renamed.md'&&A.title==='renamed','rename: same item follows the file, title follows too');
  ok((await w.getOne(idA)).content==='alpha text v2','rename: content untouched');
  ok(/1 renamed\/moved/.test(alerts.pop()),'rename: interactive summary says renamed/moved');

  // ---- move to another folder
  fs.rename('Notes/b.md','Archive/b.md'); await sync(false);
  all=await items(); const B=all.find(m=>m.id===idB);
  ok(all.length===2&&B.extPath==='Archive/b.md'&&B.category==='Archive','move: same item, extPath and auto category follow the file');

  // ---- user-customised title/category survive a rename
  await w.putMetaOnly(idB,{title:'My custom title',category:'Mine'});
  fs.rename('Archive/b.md','Archive/c.md'); await sync(false);
  const B2=(await items()).find(m=>m.id===idB);
  ok(B2.extPath==='Archive/c.md'&&B2.title==='My custom title'&&B2.category==='Mine','rename: custom title and category are not overwritten');

  // ---- delete
  fs.remove('renamed.md'); await sync(true);
  all=await items(); const A3=all.find(m=>m.id===idA);
  ok(all.length===2&&A3&&A3.extPath===null,'delete: note stays on the shelf, link cleared');
  ok((await w.getOne(idA)).content==='alpha text v2','delete: content kept');
  ok(/1 unlinked/.test(alerts.pop()),'delete: interactive summary says unlinked');
  await sync(false); ok((await items()).length===2,'delete: a second sync changes nothing');

  // ---- restore the deleted file -> adopt, not duplicate
  fs.write('renamed.md','alpha text v2'); await sync(true);
  all=await items(); const A4=all.find(m=>m.id===idA);
  ok(all.length===2&&A4.extPath==='renamed.md','restored file re-links the kept note (no duplicate)');
  ok(/1 matched to existing/.test(alerts.pop()),'restore: summary says matched to existing');

  // ---- KIV case: an ordinary note with the same title + text already on the shelf
  await w.put({id:'manual-1',title:'Manual',category:'Uncategorized',type:'markdown',mime:'text/markdown',content:'hello world',addedAt:1,updatedAt:1,progress:{scroll:120}});
  fs.write('Manual.md','hello world'); await sync(false);
  const man=await byTitle('Manual');
  ok(man.length===1&&man[0].id==='manual-1'&&man[0].extPath==='Manual.md','unlinked note with identical title+text is adopted, not duplicated');
  ok(man[0].progress&&man[0].progress.scroll===120,'adopted note keeps its reading position');
  fs.write('Other/Manual.md','different text'); await sync(false);
  ok((await byTitle('Manual')).length===2,'same title but different text is NOT merged (new item added)');

  // ---- unlink then relink the same folder must not duplicate everything
  const before=(await items()).length;
  for(const m of await items()) if(m.extPath) await w.putMetaOnly(m.id,{extPath:null,extMtime:null});
  await sync(false);
  ok((await items()).length===before,'unlink -> relink same folder: no duplicates');
  ok((await items()).every(m=>m.extPath),'unlink -> relink same folder: every note linked again');

  // ---- renamed AND edited: not guessed, and nothing is lost
  const cnt=(await items()).length;
  fs.rename('renamed.md','renamed2.md'); fs.write('renamed2.md','alpha text v3'); await sync(false);
  all=await items();
  ok(all.length===cnt+1,'rename+edit before sync: old note kept unlinked + new note added (documented limit)');
  ok((await w.getOne(idA)).content==='alpha text v2','rename+edit: old shelf copy is never overwritten');

  // ---- empty files do not pair
  fs.write('Untitled.md',''); await sync(false);
  const idU=(await byTitle('Untitled'))[0].id;
  fs.rename('Untitled.md','Something.md'); await sync(false);
  const U=(await items()).find(m=>m.id===idU);
  ok(U.extPath===null&&(await byTitle('Something')).length===1,'empty file renamed: not paired (old unlinked, new added)');

  // ---- safety: only a definite "not found" unlinks
  fs.write('Fragile.md','fragile text'); await sync(false);
  const idF=(await byTitle('Fragile'))[0].id;
  const rootFile=root.m.get('Fragile.md');
  root.m.delete('Fragile.md');                       // vanishes from the listing...
  const origGet=root.getFileHandle.bind(root);
  root.getFileHandle=async(k,o)=>{ if(k==='Fragile.md') throw err('NotAllowedError'); return origGet(k,o); }; // ...but lookup is denied, not "not found"
  await sync(false);
  ok((await items()).find(m=>m.id===idF).extPath==='Fragile.md','permission error is not treated as deleted: link kept');
  root.getFileHandle=origGet;
  root.m.set('Fragile.md',rootFile); await sync(false);
  ok((await items()).find(m=>m.id===idF).extPath==='Fragile.md','file back again: still linked');

  // ---- safety: unreadable folder (e.g. drive unplugged) changes nothing
  const snap=JSON.stringify((await items()).map(m=>[m.id,m.extPath]).sort());
  const origEntries=root.entries; root.entries=async function*(){ throw err('NotFoundError'); };
  await sync(false);
  root.entries=origEntries;
  ok(JSON.stringify((await items()).map(m=>[m.id,m.extPath]).sort())===snap,'folder listing fails: nothing unlinked');

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
