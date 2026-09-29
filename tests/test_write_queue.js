// v1.51.10: put() / del() / undo-restore go through the write queue like every other writer.
// Interleavings are forced by delaying getOneRaw (the read half of a read-modify-write).
// Run: node test_write_queue.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const note=(id,title,content)=>({id,title,category:'C',type:'markdown',mime:'text/markdown',content,addedAt:1,updatedAt:1});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const realGet=w.getOneRaw;
// The next getOneRaw call reads the record immediately but hands it back late,
// so a queued writer holds a stale copy while other writers try to run.
const delayNextRead=ms=>{ let done=false; w.getOneRaw=async id=>{ const rec=await realGet(id); if(!done){ done=true; await sleep(ms); } return rec; }; };
const restoreRead=()=>{ w.getOneRaw=realGet; };

(async()=>{
  await sleep(300);
  await w.eval("createPasscode('test1234')");
  w.alert=()=>{};

  // 1. delete vs an in-flight read-modify-write: the item must stay deleted
  await w.put(note('d1','To delete','body'));
  delayNextRead(80);
  const rmw=w.putMetaOnly('d1',{title:'edited while deleting'});
  await sleep(25); // the writer has read its copy and is now waiting; the delete arrives in that gap
  const del=w.del('d1');
  await Promise.all([rmw,del]); restoreRead();
  ok((await realGet('d1'))===undefined,'a delete queued behind a running writer is not undone by it (no zombie item)');

  // 2. put (import / add) vs an in-flight read-modify-write: the put must not be overwritten by a stale copy
  await w.put(note('p1','Original','old text'));
  delayNextRead(80);
  const rmw2=w.putMetaOnly('p1',{progress:{scroll:5}});
  await sleep(25);
  const pu=w.put({...note('p1','Imported','NEW TEXT')});
  await Promise.all([rmw2,pu]); restoreRead();
  const p1=await w.getOne('p1');
  ok(p1.content==='NEW TEXT'&&p1.title==='Imported','put after a running writer wins; its content is not replaced by a stale copy');

  // 3. writers run strictly one after another (order preserved)
  const order=[];
  const orig=w.putRaw; w.putRaw=async rec=>{ order.push(rec.id); await sleep(20); return orig(rec); };
  await Promise.all([ w.put(note('o1','1','a')), w.put(note('o2','2','b')), w.put(note('o3','3','c')) ]);
  w.putRaw=orig;
  ok(order.join()==='o1,o2,o3','several puts run in the order they were called');

  // 4. a failing put rejects for its caller but does not wedge the queue
  let threw=false; try{ await w.put({id:'bad',title:'b',category:'C',type:'image',mime:'image/png',content:'not a blob',addedAt:1}); }catch(e){ threw=true; }
  ok(threw,'a put that cannot be stored still rejects for its caller (quota / bad data handling unchanged)');
  await w.put(note('after-bad','After','ok'));
  ok((await w.getOne('after-bad')).content==='ok','the queue keeps working after a failed put');

  // 5. delete + Undo still works
  await w.put(note('u1','Undo me','undo body'));
  await w.deleteItemsWithUndo(['u1']);
  ok((await realGet('u1'))===undefined,'deleteItemsWithUndo removes the item');
  await w.undoDelete();
  ok((await w.getOne('u1'))&&(await w.getOne('u1')).content==='undo body','undoDelete brings it back (restore goes through the queue)');

  // 6. put racing a passcode change is stored under the NEW key (encryption happens inside the queue)
  await w.put(note('k1','Before change','k1'));
  const b=await w.buildPasscodeAuth('brand-new-pass');
  const re=w.reencryptEverything(b.key,b.rec);
  const late=w.put(note('k2','Raced with change','k2'));
  await Promise.all([re,late]);
  const k1=await w.getOne('k1'), k2=await w.getOne('k2');
  ok(k1&&k1.content==='k1','existing item opens after the passcode change');
  ok(k2&&k2.content==='k2','item added during a passcode change also opens (not left under the old key)');

  // 7. nothing deadlocks: a queued writer inside another queued writer's chain still finishes
  const t0=Date.now(); await Promise.all([w.put(note('q1','q','1')),w.putMetaOnly('q1',{title:'q2'}),w.del('q1')]);
  ok(Date.now()-t0<3000&&(await realGet('q1'))===undefined,'put + edit + delete on one item finish in order without hanging');

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
