// v1.51.14: a fenced code block must START a line (leading spaces/tabs allowed). Three backticks in the
// middle of a line (an inline span that holds them) no longer open a block and swallow the note.
// reading view (renderMarkdown), Tags page (stripCodeForTags/extractTags) and the editor (noteInCodeFence) agree.
// Run: node test_fences.js [path-to-project-dir/]
// jsdom cannot load the lazy pdf.js module (same as every other test here); any OTHER unhandled rejection is a real failure.
process.on('unhandledRejection',e=>{ if(e&&e.code==='ERR_MODULE_NOT_FOUND') return; console.log('UNHANDLED',e&&e.stack||e); process.exit(2); });
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
const T='```'; // three backticks, kept out of the source lines below
const R=s=>w.renderMarkdown(s,{});
const blocks=h=>(h.match(/<div class="code-block">/g)||[]).length;
const inCode=(h,txt)=>{ const m=h.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)||[]; return m.some(x=>x.includes(txt)); };

// 1. regressions: ordinary fences still work
let h=R('before\n\n'+T+'js\nlet a = 1;\n'+T+'\n\nafter');
ok(blocks(h)===1&&inCode(h,'let a = 1;')&&h.includes('code-lang">js<'),'a normal fenced block with a language renders as a code block');
h=R(T+'\nplain\n'+T); ok(blocks(h)===1&&inCode(h,'plain'),'a fence at the very start of the note works');
h=R('para line\n'+T+'\ncode right after a paragraph\n'+T); ok(blocks(h)===1&&inCode(h,'code right after'),'a fence directly under a paragraph (no blank line) works');
h=R(T+'js\nfoo()'+T+'\ntext'); ok(blocks(h)===1&&inCode(h,'foo()'),'legacy: code closed by ``` at the end of a code line still closes');
h=R('a\r\n'+T+'js\r\ncode\r\n'+T+'\r\nb'); ok(blocks(h)===1&&inCode(h,'code'),'Windows line endings (CRLF) still give a code block');
h=R(T+'index\n'+T+'\n'); ok(!inCode(h,'CODEBLOCK')&&h.includes('shelf-index'),'the live index block (```index) still renders');
h=R('- item\n  '+T+'\n  code in list\n  '+T+'\n- next'); ok(blocks(h)===1&&inCode(h,'code in list'),'a fence indented inside a list item renders as a code block');
h=R('- a\n\t'+T+'\n\ttabbed\n\t'+T); ok(blocks(h)===1&&inCode(h,'tabbed'),'a tab-indented fence renders as a code block');

// 2. THE FIX: three backticks in the middle of a line do not open a block
const inline='Use `` '+T+'js `` to start a block.\n\nThis paragraph must stay ordinary text.\n\n'+T+'\nreal code\n'+T+'\n\nTail text.';
h=R(inline);
ok(blocks(h)===1,'inline triple backticks + one real block = exactly one code block (got '+blocks(h)+')');
ok(!inCode(h,'This paragraph must stay ordinary text'),'text between an inline mention and a real block is NOT turned into code');
ok(inCode(h,'real code')&&h.includes('Tail text.')&&!inCode(h,'Tail text.'),'the real block is code, the text after it is not');
h=R('one '+T+'x'+T+' two\n\nnext paragraph'); ok(blocks(h)===0&&h.includes('next paragraph'),'a ```x``` written inline never becomes a block');
h=R('an old changelog line about '+T+' fences\n\n## Heading\n\ntext'); ok(blocks(h)===0&&h.includes('<h2>Heading</h2>'),'a lone mid-line ``` is plain text and later markdown still renders');

// 3. an opener with no closer stays plain text and swallows nothing
h=R(T+'js\nnever closed\n\n## Heading after'); ok(blocks(h)===0&&h.includes('<h2>Heading after</h2>')&&h.includes('never closed'),'an unclosed fence stays literal and does not swallow the rest');

// 4. two blocks, and no placeholder leaks
h=R(T+'\na\n'+T+'\nmid\n'+T+'py\nb\n'+T); ok(blocks(h)===2&&h.includes('mid')&&!h.includes('CODEBLOCK')&&!h.includes('\u0000'),'two blocks with text between: both render, nothing leaks');

// 5. Tags page: # inside real code is ignored; mid-line ``` no longer hides real tags
let tags=[...w.extractTags('#alpha\n'+T+'\n#incode\n'+T+'\n#omega').values()];
ok(tags.join()==='alpha,omega','extractTags: a #tag inside a fenced block is ignored, tags around it are kept ('+tags+')');
tags=[...w.extractTags('use `` '+T+' `` here #tag1\n\ntext\n\n'+T+'\ncode #incode\n'+T+'\n#tag2').values()];
ok(tags.join()==='tag1,tag2','extractTags: mid-line ``` neither hides #tag1 nor exposes #incode ('+tags+')');
tags=[...w.extractTags('- x\n  '+T+'\n  #hidden\n  '+T+'\n#seen').values()];
ok(tags.join()==='seen','extractTags: an indented fence is stripped too ('+tags+')');
ok(w.stripCodeForTags('a\n'+T+'\nb\n'+T+'\nc').includes('a')&&!w.stripCodeForTags('a\n'+T+'\nb\n'+T+'\nc').includes('b'),'stripCodeForTags removes the block body');

// 6. Editor: is this line inside an open fence?
const ic=(v,mark)=>w.noteInCodeFence(v,v.indexOf(mark));
ok(ic('x\n'+T+'\n- in\n','- in')===true,'editor: a line after an opener is inside the fence');
ok(ic('x\n'+T+'\ncode\n'+T+'\n- out\n','- out')===false,'editor: a line after a closed block is outside');
ok(ic('a '+T+' b\n- line\n','- line')===false,'editor: a mid-line ``` earlier does not count as an open fence');
ok(ic('  '+T+'\n  - in\n','  - in')===true,'editor: an indented opener counts');
ok(ic('- plain\n','- plain')===false,'editor: no fences at all -> false');
ok(ic(T+'js\nfoo()'+T+'\n- after\n','- after')===false,'editor: legacy same-line closer counts as closed');

// 7. fuzz: any mix of fence-ish tokens must render without throwing, leaking a placeholder, or unbalancing <pre>
const toks=[T,'`','``','\n','\n\n','  ','\t','js','index','text','#tag','- ','**','\r\n'];
let bad=0; let seed=12345; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
for(let i=0;i<400;i++){
  let s=''; const len=1+Math.floor(rnd()*14); for(let k=0;k<len;k++) s+=toks[Math.floor(rnd()*toks.length)];
  try{
    const out=R(s); const pre=(out.match(/<pre>/g)||[]).length, epre=(out.match(/<\/pre>/g)||[]).length;
    const cd=(out.match(/<code>/g)||[]).length, ecd=(out.match(/<\/code>/g)||[]).length;
    w.extractTags(s); w.noteInCodeFence(s,Math.floor(rnd()*(s.length+1)));
    if(out.includes('CODEBLOCK')||out.includes('\u0000')||pre!==epre||cd!==ecd) bad++;
  }catch(e){ bad++; }
}
ok(bad===0,'400 random fence/backtick mixes: no throw, no leaked placeholder, <pre> and <code> stay balanced ('+bad+' bad)');

console.log(fails?('\n'+fails+' FAILED of '+n):('\nALL '+n+' PASSED')); process.exit(fails?1:0);
