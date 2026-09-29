// v1.54.0: "Index ▾" button in the reader top bar. Shown on every item type when a note titled
// "Index" exists (and you're not on it); tapping drops down that note's content; tapping an item
// in it opens that item and closes the dropdown.
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>w.document.querySelector(s);
const shown=el=>el.style.display!=='none';
(async()=>{
  await sleep(300); w.alert=()=>{}; w.confirm=()=>true;
  await w.eval("createPasscode('test1234')");
  await w.put({id:'a',type:'markdown',title:'Note A',category:'X',addedAt:1,content:'# A\n\nhello'});
  await w.put({id:'p',type:'pdf',title:'Doc',category:'Y',mime:'application/pdf',addedAt:3,content:{arrayBuffer:async()=>new Uint8Array(8).buffer}});

  // no Index note yet -> no button
  await w.openReader('a'); await sleep(80);
  ok(!shown($('#indexBtn')),'no Index note: button hidden');

  // add an Index note (live ```index block + a hand-written link)
  await w.put({id:'ix',type:'markdown',title:'Index',category:'A',addedAt:4,content:'```index\n```\n\n[Hand link](shelf://a)'});
  await w.openReader('a'); await sleep(80);
  ok(shown($('#indexBtn')),'Index note exists: button shown on a note');
  ok(!shown($('#indexPanel')),'panel starts closed');

  await w.eval("toggleIndexPanel()"); await sleep(120);
  ok(shown($('#indexPanel')) && $('#indexBtn').getAttribute('aria-expanded')==='true','tap opens the dropdown');
  const links=[...w.document.querySelectorAll('#indexPanel .si-link')].map(a=>a.textContent);
  ok(links.some(t=>/Note A/.test(t)) && links.some(t=>/Doc/.test(t)),'dropdown lists the shelf items from the ```index block');
  ok(!!$('#indexPanel .md-note-link'),'hand-written shelf:// link renders as a link too');
  ok(w.document.querySelectorAll('#indexPanel .mdblock, #indexPanel [data-idx]').length===0,'dropdown copy carries no .mdblock / data-idx hooks');
  ok(w.document.querySelectorAll('.mdblock[data-idx]').length>0 && !$('#indexPanel .mdblock'),'reader\'s own blocks unaffected');

  // opening another panel closes it; tapping again toggles
  await w.eval("toggleOutlinePanel()");
  ok(!shown($('#indexPanel')),'opening another top-bar panel closes the dropdown');
  await w.eval("toggleIndexPanel()"); await sleep(120);
  await w.eval("toggleIndexPanel()");
  ok(!shown($('#indexPanel')),'second tap closes it');

  // tap an item -> jumps there, panel closes, button stays (other item)
  await w.eval("toggleIndexPanel()"); await sleep(120);
  const docLink=[...w.document.querySelectorAll('#indexPanel .si-link')].find(a=>/Doc/.test(a.textContent));
  docLink.click(); await sleep(150);
  ok(w.eval("curId")==='p','tapping an item opens it');
  ok(!shown($('#indexPanel')),'dropdown closed after the jump');
  ok(shown($('#indexBtn')),'button also shows on a PDF');

  // on the Index note itself: hidden
  await w.openReader('ix'); await sleep(80);
  ok(!shown($('#indexBtn')),'hidden on the Index note itself');

  // case-insensitive title; deleting it hides the button again
  await w.openReader('a'); await sleep(80);
  await w.del('ix'); await w.openReader('a'); await sleep(80);
  ok(!shown($('#indexBtn')),'Index note deleted: button hidden again');
  await w.put({id:'ix2',type:'markdown',title:' index ',category:'',addedAt:5,content:'x'});
  await w.openReader('a'); await sleep(80);
  ok(shown($('#indexBtn')),'title match is case/space-insensitive');

  console.log(fails?('\n'+fails+' FAILED'):'\nall passed'); process.exit(fails?1:0);
})().catch(e=>{console.log('ERR',e);process.exit(1);});
