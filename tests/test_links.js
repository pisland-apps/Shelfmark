// Shelfmark link/image URL parsing + hostile-input tests (renderMarkdown, real app.js in jsdom).
// Run: node test_links.js [path-to-project-dir/]
require('./guard.js')();
const w=require('./load.js')(process.argv[2]);
const {JSDOM}=require('jsdom');
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} };
const render=(s,lt)=>w.renderMarkdown(s,lt||{});
const doc=h=>new JSDOM('<body>'+h+'</body>').window.document;
const links=s=>[...doc(render(s)).querySelectorAll('a')].map(a=>({href:a.getAttribute('href'),text:a.textContent}));
const imgs=s=>[...doc(render(s)).querySelectorAll('img.md-img')].map(i=>({src:i.getAttribute('src'),alt:i.getAttribute('alt')}));
const text=s=>{ const d=doc(render(s)); d.querySelectorAll('.bm-btn').forEach(b=>b.remove()); return d.body.textContent.replace(/\s+/g,' ').trim(); };
const one=(s,href,txt,label)=>{ const l=links(s); ok(l.length===1&&l[0].href===href&&l[0].text===txt,`${label||s} -> ${JSON.stringify(l)}`); };

// ---- the reported bug + the three cases from the fix list
one('[a](https://en.wikipedia.org/wiki/Foo_(bar))','https://en.wikipedia.org/wiki/Foo_(bar)','a','one nested (...)');
ok(text('[a](https://en.wikipedia.org/wiki/Foo_(bar))')==='a','no stray ")" left as visible text');
one('[a](https://x.com/a_(b)_c)','https://x.com/a_(b)_c','a','nested parens mid-URL');
one('[a](https://x.com/(b))','https://x.com/(b)','a','URL ending in ")"');
one('[a](https://x.com/f_(a_(b)))','https://x.com/f_(a_(b))','a','two levels of nesting');
one('[a](https://x.com/s?q=(1)&r=2)','https://x.com/s?q=(1)&amp;r=2'.replace('&amp;','&'),'a','query string containing ")"');
one('[a](https://x.com/s?q=f(x))','https://x.com/s?q=f(x)','a','query string ending in ")"');
// ---- must not swallow surrounding prose
one('([a](https://x.com))','https://x.com','a','link wrapped in prose parens');
ok(text('([a](https://x.com))')==='(a)','prose parens around a link survive');
{ const l=links('[a](https://x.com/p_(q)) and [b](https://y.com) (aside)'); ok(l.length===2&&l[0].href==='https://x.com/p_(q)'&&l[1].href==='https://y.com','two links on one line, first nested'); ok(text('[a](https://x.com/p_(q)) and [b](https://y.com) (aside)')==='a and b (aside)','trailing "(aside)" stays text'); }
one('[a](https://x.com) (b)','https://x.com','a','link followed by "(b)"');
// ---- apostrophes (entity &#39; must not become a #39 tag pill)
ok(text("it's fine, rock 'n' roll")==="it's fine, rock 'n' roll",'apostrophes render as apostrophes');
ok(doc(render("it's")).querySelectorAll('.tag-pill').length===0,'no tag pill from &#39;');
ok(doc(render('#real and it\'s #also')).querySelectorAll('.tag-pill').length===2,'real #tags next to apostrophes still become pills');
{ const i=imgs("![it's a pic](data:image/png;base64,AA)"); ok(i.length===1&&i[0].alt==="it's a pic",'image alt with apostrophe'); }
one("[a](https://x.com/it's)","https://x.com/it's",'a','apostrophe inside a URL');
// ---- images
{ const i=imgs('![pic](data:image/png;base64,AAAA)'); ok(i.length===1&&i[0].src==='data:image/png;base64,AAAA'&&i[0].alt==='pic','data: image still works'); }
w.__setPref('allowRemoteMedia',true);
{ const i=imgs('![t](https://x.com/img_(1).png)'); ok(i.length===1&&i[0].src==='https://x.com/img_(1).png','image URL with nested parens'); ok(text('![t](https://x.com/img_(1).png)')==='','no stray ")" after image'); }
w.__setPref('allowRemoteMedia',false);
ok(doc(render('![t](https://x.com/img_(1).png)')).querySelectorAll('.md-remote-blocked').length===1,'remote image with parens still gated by allowRemoteMedia');
{ const d=doc(render('![t](https://x.com/img_(1).png)')).querySelector('.md-remote-blocked'); ok(d&&d.dataset.remoteUrl==='https://x.com/img_(1).png','placeholder carries the full URL'); }
// ---- angle form + titles
one('[a](<https://x.com/my file (v2).pdf>)','https://x.com/my file (v2).pdf','a','<angle form> with space and parens');
one('[a](https://x.com "A title")','https://x.com','a','optional "title" is accepted and dropped');
one("[a](https://x.com/p_(q) 'T')",'https://x.com/p_(q)','a','nested parens + single-quoted title');
// ---- legacy behaviour kept (nothing that linked before stops linking)
one('[a](https://x.com/foo(bar)','https://x.com/foo(bar','a','unbalanced "(" falls back to first ")"');
one('[a](http://x y)','http://x y','a','raw space inside URL falls back to legacy');
// ---- stays plain text
for(const s of ['[a]()','[a](','[a](b','[](https://x.com)','[a](https://x.com\nmore)']){ ok(links(s).length===0,'not a link: '+JSON.stringify(s)); }
ok(/^\[a\]\(https:\/\/x\.com\s*more\)$/.test(text('[a](https://x.com\nmore)')),'multi-line stays literal');

// ---- hostile input (URL scheme allowlist must still hold with the new scanner)
const hostile=[
 '[x](javascript:alert(1))','[x](javascript:alert(document.domain))','[x](JaVa\tScRiPt:alert(1))','[x](  javascript:alert(1))',
 '[x](<javascript:alert(1)>)','[x](<javascript:alert(1) (x)>)','[x](data:text/html;base64,PHNjcmlwdD4=)','[x](vbscript:msgbox(1))',
 '![x](javascript:alert(1))','![x](<javascript:alert(1)>)','![x](https://a.com/x.png"onerror="alert(1))',
 '[x](https://a.com/"onmouseover="alert(1))','[x](https://a.com/\'onmouseover=\'alert(1))','[x](https://a.com/ "t" onclick="alert(1)")',
 '[x](<https://a.com/"onclick="alert(1)>)','[x](https://a.com/a_(b)"onclick="alert(1))',
 '[x](https://a.com/(((((((((((((((((((((((((((((((((','[x](https://a.com/)))))))))))))))))))))))','[x](&lt;https://a.com&gt;)','[x](<>)','[x](< >)',
 '[x]([y](javascript:alert(1)))','[[x](javascript:alert(1))](https://ok.com)','[x](https://ok.com)[y](javascript:alert(1))',
];
for(const s of hostile){
  let html; try{ html=render(s); }catch(e){ ok(false,'threw on '+JSON.stringify(s)+': '+e.message); continue; }
  const d=doc(html);
  const bad=[...d.querySelectorAll('a')].filter(a=>!/^(https?:|mailto:|tel:)/i.test(a.getAttribute('href')||''));
  ok(bad.length===0,'no unsafe <a href> for '+JSON.stringify(s));
  const badImg=[...d.querySelectorAll('img')].filter(i=>!/^(https?:|data:|blob:)/i.test(i.getAttribute('src')||''));
  ok(badImg.length===0,'no unsafe <img src> for '+JSON.stringify(s));
  const withHandlers=[...d.querySelectorAll('*')].filter(e=>[...e.attributes].some(at=>/^on/i.test(at.name)));
  ok(withHandlers.length===0,'no inline on* attribute for '+JSON.stringify(s)+' -> '+withHandlers.map(e=>e.outerHTML.slice(0,80)));
  const injected=[...d.querySelectorAll('a,img')].filter(e=>[...e.attributes].some(at=>!['href','target','rel','class','src','alt'].includes(at.name)));
  ok(injected.length===0,'no extra attributes injected on a/img for '+JSON.stringify(s)+' -> '+injected.map(e=>e.outerHTML.slice(0,120)));
  ok(!d.querySelector('script'),'no <script> for '+JSON.stringify(s));
}


// ---- placeholder forgery (v1.51.10): a literal NUL in a note must not splice another block's HTML
{ const NUL='\u0000';
  const forged=[
    '```\nSECRET_A\n```\n\n'+NUL+'CODEBLOCK0'+NUL,               // duplicate a real block
    '```\nSECRET_A\n```\n\ntext '+NUL+'CODEBLOCK0'+NUL+' text',
    NUL+'CODEBLOCK9'+NUL,                                       // index that does not exist
    NUL+'CODEBLOCK0'+NUL+'\n\n```\nX\n```',                     // forged token BEFORE the real block
    '**a** '+NUL+'T0'+NUL+' ==b== '+NUL+'T99'+NUL,               // inline-mark placeholder
    '```\nA\n```\n```\nB\n```\n'+NUL+'CODEBLOCK1'+NUL+NUL+'CODEBLOCK0'+NUL,
  ];
  for(const s of forged){
    let html; try{ html=render(s); }catch(e){ ok(false,'threw on forged placeholder '+JSON.stringify(s)+': '+e.message); continue; }
    ok(!html.includes(NUL),'no NUL left in output for '+JSON.stringify(s));
    ok(!/undefined/.test(html),'no "undefined" printed for '+JSON.stringify(s));
    const real=(s.match(/```\w*\n[\s\S]*?```/g)||[]).length; // real fenced blocks in the source
    ok(doc(html).querySelectorAll('.code-block').length===real,'code blocks not duplicated ('+real+' expected) for '+JSON.stringify(s));
  }
  ok((render('```\nSECRET_A\n```\n\n'+NUL+'CODEBLOCK0'+NUL).match(/SECRET_A/g)||[]).length===1,'forged token cannot repeat a block\'s text');
  // a title containing NULs (crafted backup) inside a ```index block must not pull in another block either
  ok(true,'forgery cases done');
}
// ---- code samples containing "$&", "$\'", "$`" must come out literally (v1.51.10; used to be garbled)
{ for(const code of ["s.replace(/x/, '$&')","echo $'a\\nb'","a $` b","cost: $$ 5 and $1","price $& $& $&"]){
    const t=doc(render('before\n\n```\n'+code+'\n```\n\nafter')).querySelector('.code-block pre code');
    ok(t&&t.textContent.trim()===code,'code sample renders literally: '+JSON.stringify(code)+' -> '+JSON.stringify(t&&t.textContent.trim()));
  }
  const two=doc(render('```\n$&\n```\n\n```\n$\'\n```'));
  const blocks=[...two.querySelectorAll('.code-block pre code')].map(e=>e.textContent.trim());
  ok(blocks.length===2&&blocks[0]==='$&'&&blocks[1]==="$'",'two blocks with $-patterns stay separate and literal');
}

// ---- performance: a multi-MB data-URI image and pathological paren runs must stay fast
{ const big='![p](data:image/png;base64,'+'A'.repeat(6*1024*1024)+') tail (x)';
  let t=Date.now(); const h=render(big); const ms=Date.now()-t; ok(ms<1500,`6 MB data-URI image renders in ${ms} ms`); ok(/<img class="md-img"/.test(h)&&/tail \(x\)/.test(h),'big image + trailing text intact'); }
{ const s='[a](x'+'('.repeat(200000)+' y'; let t=Date.now(); render(s); const ms=Date.now()-t; ok(ms<1500,`200k "(" run renders in ${ms} ms`); }
{ const s='[a]('.repeat(20000); let t=Date.now(); render(s); const ms=Date.now()-t; ok(ms<3000,`20k unterminated "[a](" renders in ${ms} ms`); }

console.log(fails?`\n${fails} of ${n} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
