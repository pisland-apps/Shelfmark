const fs=require('fs'); const {JSDOM}=require('jsdom');
const root=require('path').resolve(__dirname,'..')+'/';
const html=fs.readFileSync(root+'index.html','utf8'); const appRaw=fs.readFileSync(root+'app.js','utf8'); const app=appRaw.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
let fails=0; const ok=(c,m)=>{ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };

// ---- static: no inline handlers anywhere outside comments/.onX= property assignments
const htmlNoComments=html.replace(/<!--[\s\S]*?-->/g,'');
ok(!/\son(click|change|input|keydown|keyup|submit|load|error|focus|blur|mouse\w+|touch\w+|pointer\w+|drag\w*|drop|paste|contextmenu)\s*=\s*["']/i.test(htmlNoComments),'index.html has no inline event attributes');
const tmplHandlers=(app.match(/[\s"'`]on[a-z]+=\\?["']/g)||[]).filter(x=>!/\.on/.test(x));
ok(tmplHandlers.length===0,'app.js templates have no inline event attributes '+JSON.stringify(tmplHandlers));
ok(!/javascript:/i.test(htmlNoComments),'no javascript: URLs in index.html');
const csp=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1]; console.log('info: CSP =',csp);
ok(/(^|; )script-src 'self'(;|$)/.test(csp),"CSP script-src is 'self' only");

// ---- extract dispatcher + table
const blk=appRaw.slice(appRaw.indexOf('// <<UI-DISPATCHER-BEGIN'),appRaw.indexOf('// UI-DISPATCHER-END>>'));
const tableNames=blk.match(/Object\.freeze\(\{([\s\S]*?)\}\)/)[1].split(',').map(s=>s.trim()).filter(Boolean);
// every referenced action name (index.html + app.js templates) is whitelisted
const used=new Set();
for(const src of [html,app]) for(const m of src.matchAll(/data-on-(?:click|change|input|keydown)="([^"$]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach(n=>used.add(n));
const missing=[...used].filter(n=>!tableNames.includes(n)); ok(missing.length===0,'all '+used.size+' referenced actions are in UI_ACTIONS '+JSON.stringify(missing));
const unused=tableNames.filter(n=>!used.has(n)); console.log('info: whitelisted but unreferenced:',unused);
// every data-args-* literal in index.html is valid JSON
let badJson=0,nJson=0; for(const m of html.matchAll(/data-args-(?:click|change|input|keydown)='([^']*)'/g)){ nJson++; try{JSON.parse(m[1])}catch(e){badJson++; console.log('bad json',m[1]);} }
ok(badJson===0,nJson+' data-args JSON literals in index.html parse');
// every data-click-target exists as an element id
const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const badT=[...html.matchAll(/data-click-target="([^"]+)"/g)].map(m=>m[1]).filter(i=>!ids.has(i)); ok(badT.length===0,'click targets exist '+JSON.stringify(badT));

// ---- dynamic: run dispatcher in jsdom against the real index.html markup
const dom=new JSDOM(html.replace(/<script src="app.js"><\/script>/,''),{runScripts:'outside-only'});
const w=dom.window; const calls=[];
const stubs=tableNames.filter(n=>n!=='createIndexNoteFromGuide').map(n=>`function ${n}(...a){ __calls.push([${JSON.stringify(n)}, a.map(x=> (x instanceof window.Event) ? 'EVENT:'+x.type : (x instanceof window.Element)?'EL:'+x.tagName : x)]); }`).join('\n');
w.__calls=calls;
w.eval(`var __calls=window.__calls; ${stubs}\nvar NOTE_TEMPLATES={index:{content:()=>'TPL'}};\n`+blk.replace(/^\/\/.*$/mg,'')+`\nwindow.UI_ACTIONS=UI_ACTIONS;`);
const $=s=>w.document.querySelector(s);
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
const last=()=>calls[calls.length-1]; const reset=()=>calls.length=0;

click($('[data-on-click="undoDelete"]')); ok(JSON.stringify(calls)==='[["undoDelete",[]]]','simple click calls action with no args');
reset(); click($('[data-on-click="setPref"][data-args-click*="dark"]')); ok(JSON.stringify(last())==='["setPref",["theme","dark"]]','setPref(theme,dark) args pass through');
reset(); click($('#coverRemoveBtnEdit')); ok(JSON.stringify(last())==='["removeCover",["edit"]]','removeCover(edit)');
reset(); click($('#coverRemoveBtn')); ok(JSON.stringify(last())==='["removeCover",["add"]]','removeCover(add)');
reset(); click($('[data-on-click="findStep"][data-args-click="[-1]"]')); ok(JSON.stringify(last())==='["findStep",[-1]]','negative number arg');
reset(); $('#importPick').dispatchEvent(new w.Event('change',{bubbles:true})); ok(JSON.stringify(last())==='["onImportFile",["EVENT:change"]]','change passes $ev');
reset(); $('#coverpick').dispatchEvent(new w.Event('change',{bubbles:true})); ok(JSON.stringify(last())==='["onCoverPick",["EVENT:change","add"]]','change with $ev + extra arg');
reset(); $('#cmdPalInput').dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,key:'Enter'})); ok(last()&&last()[0]==='onCmdPalKeydown'&&last()[1][0]==='EVENT:keydown','keydown passes event');
reset(); $('#cmdPalInput').dispatchEvent(new w.Event('input',{bubbles:true})); ok(JSON.stringify(last())==='["onCmdPalInput",[]]','input event, no args');
reset(); $('.help-search input').dispatchEvent(new w.Event('input',{bubbles:true})); ok(JSON.stringify(last())==='["filterHelp",["EL:INPUT"]]','$el resolves to the element');
// data-self: overlay only reacts to clicks on itself
reset(); click($('#cmdPalette')); ok(JSON.stringify(calls)==='[["closeCommandPalette",[]]]','overlay click on backdrop closes');
reset(); click($('#cmdPalInput')); ok(calls.length===0,'click inside overlay child does NOT close it');
// chain
reset(); click($('[data-on-click="closeGuide openSecInfo"]')); ok(JSON.stringify(calls.map(c=>c[0]))==='["closeGuide","openSecInfo"]','chained actions run in order');
// click target
let clicked=0; $('#importPick').addEventListener('click',()=>clicked++); reset();
click($('[data-click-target="importPick"]')); ok(clicked===1,'data-click-target clicks the hidden file input');
// disabled
reset(); const sb=$('#saveBtn'); ok(sb.disabled,'saveBtn starts disabled'); click(sb); ok(calls.length===0,'disabled button does nothing');
sb.disabled=false; click(sb); ok(last()&&last()[0]==='saveItem','enabled button fires');
// child of button (icon inside)
reset(); const b=$('#helpToggleBtn')||$('[data-on-click="openAdd"]'); const span=w.document.createElement('span'); b.appendChild(span); click(span); ok(calls.length===1,'click on a child node bubbles to the button action');

// ---- dynamic template markup: stop, nesting, escaping, unknown action, bad JSON
const host=w.document.createElement('div'); w.document.body.appendChild(host);
host.innerHTML=`<div data-on-click="jumpBookmark" data-args-click="[1234]" id="row"><button id="rm" data-on-click="deleteBookmark" data-args-click="[1234]" data-stop-click>x</button><span id="sn">s</span></div>
<button id="pl" data-on-click="toggleShelfPlay" data-arg-click="a&quot;b'&lt;i&gt;">p</button>
<button id="cc" data-on-click="copyCodeBlock" data-args-click='["$el"]'>c</button>
<button id="unk" data-on-click="eval" data-args-click='["alert(1)"]'>e</button>
<button id="unk2" data-on-click="constructor">e</button>
<button id="badj" data-on-click="skip" data-args-click="[oops">b</button>`;
reset(); click(w.document.getElementById('rm')); ok(JSON.stringify(calls.map(c=>c[0]))==='["deleteBookmark"]','data-stop-click stops ancestor action (no jumpBookmark)');
reset(); click(w.document.getElementById('sn')); ok(JSON.stringify(calls)==='[["jumpBookmark",[1234]]]','row click without stop fires parent, numeric arg intact');
reset(); click(w.document.getElementById('pl')); ok(last()[1][0]==='a"b\'<i>','data-arg-click delivers quotes/angle brackets verbatim as ONE string');
reset(); click(w.document.getElementById('cc')); ok(JSON.stringify(last())==='["copyCodeBlock",["EL:BUTTON"]]','copyCodeBlock gets its button');
const errs=[]; w.console.error=(...a)=>errs.push(a.join(' '));
reset(); click(w.document.getElementById('unk')); ok(calls.length===0&&errs.length===1,'non-whitelisted "eval" is refused and logged');
reset(); click(w.document.getElementById('unk2')); ok(calls.length===0&&errs.length===2,'prototype names ("constructor") are refused');
reset(); click(w.document.getElementById('badj')); ok(calls.length===0&&errs.length===3,'malformed data-args is refused, not guessed');
// throwing / rejecting action must not break dispatcher


console.log(fails?`\n${fails} FAILED`:'\nALL PASSED'); process.exit(fails?1:0);
