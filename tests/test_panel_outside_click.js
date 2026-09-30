// v1.55.0: the top-bar panels (settings / outline / bookmarks / Index) close on a tap outside them and
// on Escape, not only by tapping the same button again.
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>w.document.querySelector(s);
const shown=el=>el.style.display!=='none';
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
(async()=>{
  await sleep(300); w.alert=()=>{}; w.confirm=()=>true;
  await w.eval("createPasscode('test1234')");
  await w.put({id:'a',type:'markdown',title:'Note A',category:'X',addedAt:1,content:'# A\n\nhello\n\n## B\n\nworld'});
  await w.put({id:'ix',type:'markdown',title:'Index',category:'A',addedAt:4,content:'[Hand link](shelf://a)'});
  await w.openReader('a'); await sleep(120);
  const body=$('#mdView')||w.document.body;

  const panels=[['bmPanel','bmBtn','toggleBookmarkPanel'],['outlinePanel','outlineBtn','toggleOutlinePanel'],['settingsPanel','settingsBtn','toggleSettingsPanel']];
  for(const [pid,bid,fn] of panels){
    await w.eval(fn+'()'); await sleep(40);
    ok(shown($('#'+pid)),pid+' opens');
    click($('#'+pid)); ok(shown($('#'+pid)),pid+': tap INSIDE keeps it open');
    click(body); ok(!shown($('#'+pid)),pid+': tap outside closes it');
    await w.eval(fn+'()'); await sleep(40);
    click($('#'+bid)); await sleep(20);
    ok(shown($('#'+pid)),pid+': its own button is left to the toggle (no close-then-reopen flicker)');
    await w.eval(fn+'()'); await sleep(20);
    ok(!shown($('#'+pid)),pid+': the toggle button still closes it');
    await w.eval(fn+'()'); await sleep(40);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    ok(!shown($('#'+pid)),pid+': Escape closes it');
  }

  await w.eval('toggleIndexPanel()'); await sleep(150);
  ok(shown($('#indexPanel')),'Index dropdown opens');
  click($('#indexPanel')); ok(shown($('#indexPanel')),'Index: tap inside keeps it open');
  click(body); await sleep(20);
  ok(!shown($('#indexPanel')) && $('#indexBtn').getAttribute('aria-expanded')==='false','Index: tap outside closes it and resets the button');

  // nothing open -> a tap does nothing harmful
  click(body); ok(!shown($('#bmPanel')) && !shown($('#outlinePanel')),'tap with nothing open is a no-op');
  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASS'); process.exit(fails?1:0);
})().catch(e=>{console.log('ERR',e);process.exit(1)});
