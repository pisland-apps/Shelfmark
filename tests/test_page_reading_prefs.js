// v1.53.0: page color / font / text size can be set for ONE note ("This page only") instead of the
// whole app. The override lives in the note's metadata (readerPrefs), wins over the app-wide
// setting while that note is open, and the app-wide look returns when the reader closes.
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=()=>w.document.documentElement;
const theme=()=>root().getAttribute('data-theme');
const size=()=>root().style.getPropertyValue('--read-size');
const font=()=>root().style.getPropertyValue('--read-font');
const btn=(v)=>w.document.querySelector('#settingsPanel .seg button[data-v="'+v+'"]');
(async()=>{
  await sleep(300); w.alert=()=>{}; w.confirm=()=>true;
  await w.eval("createPasscode('test1234')");
  await w.put({id:'a',type:'markdown',title:'Note A',category:'X',addedAt:1,content:'# A\n\nhello'});
  await w.put({id:'b',type:'markdown',title:'Note B',category:'X',addedAt:2,content:'# B\n\nworld'});
  await w.put({id:'p',type:'pdf',title:'Doc',mime:'application/pdf',addedAt:3,content:{arrayBuffer:async()=>new Uint8Array(8).buffer}});

  // ---- app-wide setting still works exactly as before ----
  await w.eval("setPref('size','l')");
  ok(size()==='19px','app-wide size L applies');

  // ---- open A; choose "This page only"; change size + font + theme ----
  await w.openReader('a'); await sleep(50);
  ok(size()==='19px' && theme()===null,'note with no override follows the app-wide look');
  ok(btn('l').classList.contains('active'),'panel shows the app-wide value as active');
  w.eval("setSettingsScope('page')");
  ok(w.document.querySelector('#settingsScopeSeg [data-scope="page"]').classList.contains('active'),'scope switches to This page only');
  ok(size()==='19px','switching scope alone changes nothing');
  w.eval("setReadPref('size','xl')"); w.eval("setReadPref('font','mono')"); w.eval("setReadPref('theme','sepia')");
  await sleep(100);
  ok(size()==='22px' && theme()==='sepia' && /Consolas/.test(font()),'this page: XL + Mono + Sepia applied');
  ok(btn('xl').classList.contains('active') && !btn('l').classList.contains('active'),'panel highlights this page\'s value');
  ok(w.document.getElementById('readPrefsResetRow').style.display==='flex','reset button appears');
  ok(w.document.getElementById('settingsBtn').classList.contains('active'),'gear shows the note has its own look');
  ok(w.__getPref('size')==='l' && w.__getPref('theme')==='auto','app-wide prefs untouched by page changes');

  // ---- stored in the note's metadata ----
  const m=await w.eval("getMeta('a')");
  ok(m.readerPrefs && m.readerPrefs.size==='xl' && m.readerPrefs.font==='mono' && m.readerPrefs.theme==='sepia','readerPrefs saved in note metadata');
  const mb=await w.eval("getMeta('b')");
  ok(!mb.readerPrefs,'other notes have no override');

  // ---- close: app-wide look returns ----
  w.closeReader(); await sleep(50);
  ok(size()==='19px' && theme()===null,'closing the reader restores the app-wide look');
  ok(!w.document.getElementById('settingsBtn').classList.contains('active'),'gear indicator cleared');

  // ---- open B: unaffected ----
  await w.openReader('b'); await sleep(50);
  ok(size()==='19px' && theme()===null,'another note is not affected');
  // "All pages" scope on B changes the app-wide value
  w.eval("setReadPref('size','s')"); ok(size()==='15px' && w.__getPref('size')==='s','All pages scope still sets the app-wide value');
  await w.openReader('a'); await sleep(50);
  ok(size()==='22px' && theme()==='sepia','reopening A restores its own look (override wins over app-wide S)');
  ok(w.document.querySelector('#settingsScopeSeg [data-scope="page"]').classList.contains('active'),'panel opens in This page only scope for a note that has one');

  // ---- reset ----
  w.eval("resetReadPrefs()"); await sleep(100);
  ok(size()==='15px' && theme()===null,'reset returns this note to the app-wide look');
  ok(!(await w.eval("getMeta('a')")).readerPrefs,'override cleared in metadata');

  // ---- partial override: only one key set, the rest follow the app ----
  w.eval("setSettingsScope('page')"); w.eval("setReadPref('theme','dark')"); await sleep(100);
  ok(theme()==='dark' && size()==='15px','only the chosen key is overridden');
  w.eval("setPref('size','m')");
  ok(size()==='17px' && theme()==='dark','app-wide change flows through un-overridden keys while the override stays');
  w.closeReader(); await sleep(50);

  // ---- survives other metadata writes and a rename ----
  await w.eval("putMetaOnly('a',{title:'Renamed'})");
  ok((await w.eval("getMeta('a')")).readerPrefs.theme==='dark','rename keeps the override');

  // ---- PDFs get no override, and a stray one is ignored ----
  await w.eval("putMetaOnly('p',{readerPrefs:{theme:'dark'}})");
  await w.openReader('p'); await sleep(50);
  ok(theme()===null,'PDF ignores readerPrefs');
  w.closeReader(); await sleep(50);

  // ---- hostile / garbage values are dropped ----
  const clean=x=>w.eval("readPrefsClean("+JSON.stringify(x)+")");
  ok(JSON.stringify(await clean({theme:'dark',font:'x;}body{',size:'99px'}))==='{"theme":"dark"}','unknown font / size values dropped, valid one kept');
  ok((await clean({theme:'red'}))===null && (await clean(null))===null && (await clean([1]))===null && (await clean('dark'))===null,'garbage becomes null');
  ok((await clean({}))===null,'empty becomes null');

  // ---- export / import round trip ----
  const full=await w.eval("getOne('a')");
  const meta=await w.eval("exportMetaOf("+JSON.stringify({id:'a',title:'T',category:'C',type:'markdown',addedAt:1,readerPrefs:{theme:'sepia',size:'xl',bad:'1'}})+")");
  ok(meta.readerPrefs && meta.readerPrefs.theme==='sepia' && meta.readerPrefs.size==='xl' && !('bad' in meta.readerPrefs),'export includes a cleaned readerPrefs');
  ok((await w.eval("exportMetaOf({id:'z',title:'t',type:'markdown',addedAt:1})")).readerPrefs===null,'export without an override gives null');
  ok(!!full,'sanity: getOne works');

  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
