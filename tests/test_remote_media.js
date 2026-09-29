// v1.52.4: remote images / audio never load inside a note; the old tap handler
// (an attribute-injection path found in the v1.52.1 review) is gone.
require('./guard.js')(60000);
const w=require('./load.js')();
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const show=md=>{ const h=w.document.createElement('div'); h.innerHTML=w.renderMarkdown(md); w.document.body.appendChild(h); return h; };
(async()=>{
  await sleep(300);
  const hostile='[clip](<https://e.com/" data-pwn="1" onplay="alert(1)" x.mp3>)';
  const cases={ image:'![pic](https://x.com/a.png)', audio:'[clip](https://x.com/a.mp3)', hostile };
  for(const [k,md] of Object.entries(cases)){
    const h=show(md);
    ok(h.querySelectorAll('img,audio,video,iframe,source').length===0,k+': no element that could make a request');
    ok(h.querySelectorAll('[src]').length===0,k+': no src attribute at all');
    const a=h.querySelector('.md-remote-blocked a');
    ok(!!a&&a.target==='_blank'&&/noopener/.test(a.rel),k+': shown as a link that opens in a new tab');
    ok(![...h.querySelectorAll('*')].some(e=>[...e.attributes].some(at=>/^(on|data-remote|data-pwn)/i.test(at.name))),k+': no handler or data-remote attributes');
    const before=h.innerHTML; (h.querySelector('.md-remote-blocked')||h).click();
    ok(h.innerHTML===before&&h.querySelectorAll('img,audio').length===0,k+': tapping the placeholder changes nothing in the page (no loader any more)');
    h.remove();
  }
  ok(w.eval("typeof toggleRemoteMedia")==='undefined'&&w.eval("prefs.allowRemoteMedia")===undefined,'the preference and its toggle are gone');
  const d=show('![p](data:image/png;base64,AAAA)'); ok(d.querySelectorAll('img').length===1,'data: pictures still display'); d.remove();
  console.log(fails?('\n'+fails+' FAILED'):'\nALL PASSED'); process.exit(fails?1:0);
})();
