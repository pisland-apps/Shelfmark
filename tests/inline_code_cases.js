// v1.51.12: inline code span cases, shared by test_inline_code.js (jsdom) so they can
// also be run in a real browser. run(api, ok) where api = { render(md), parse(html) -> Document, extractTags(md) -> Map }.
module.exports=function run(api,ok){
  const {render,parse,extractTags}=api;
  const codes=md=>[...parse(render(md)).querySelectorAll('code')].filter(c=>!c.closest('.code-block')).map(c=>c.textContent);
  const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const plain=md=>{ const d=parse(render(md)); d.querySelectorAll('.bm-btn').forEach(b=>b.remove()); return d.body.textContent.replace(/\s+/g,' ').trim(); };

  // ---- unchanged behaviour
  ok(eq(codes('a `b` c'),['b']),'single-backtick span still works');
  ok(eq(codes('`one` and `two`'),['one','two']),'two spans on a line');
  ok(eq(codes('`C#` and #tag'),['C#'])&&/data-tag="tag"/.test(render('`C#` and #tag'))&&!/data-tag="c"/.test(render('`C#` and #tag')),'"#" inside code is not a tag; a real tag still is');

  // ---- the reported bug: double-backtick span holding a literal backtick
  ok(eq(codes('``a ` b``'),['a ` b']),'double-backtick span keeps a literal backtick');
  ok(eq(codes('`` `x` ``'),['`x`']),'one space just inside a double-backtick span is dropped');
  const line='code samples containing `$&`, `` $` `` or `$\'` were garbled';
  ok(eq(codes(line),['$&','$`',"$'"]),'the exact line that broke shelfmark-remaining-fixes.md gives 3 clean spans: '+JSON.stringify(codes(line)));
  ok(plain(line)==='code samples containing $&, $` or $\' were garbled','...and the surrounding words are intact: '+plain(line));

  // ---- the damage: nothing after that line may be styled as code
  const doc=['- first','- '+line,'- **Two rules:** idle (no tap; default **10 min**;','- Never / 2 / 5) and background','- stored (`autoLockIdleMin`, `autoLockAwayMin`), edited','','A later paragraph with **bold** text.'].join('\n');
  const d=parse(render(doc));
  const inCode=t=>[...d.querySelectorAll('code')].some(c=>c.textContent.includes(t));
  ok(!inCode('Two rules')&&!inCode('Never / 2')&&!inCode('later paragraph')&&!inCode('background'),'text after the line is NOT inside a code span');
  ok(eq(codes(doc),['$&','$`',"$'",'autoLockIdleMin','autoLockAwayMin']),'later code spans are the real ones, not inverted: '+JSON.stringify(codes(doc)));
  ok((render(doc).match(/<code>/g)||[]).length===(render(doc).match(/<\/code>/g)||[]).length,'<code> and </code> are balanced');

  // ---- stray / unmatched backticks are plain text and harmless
  ok(eq(codes('it is a ` alone\n\n- item `x`\n- more'),['x'])&&plain('it is a ` alone\n\n- item `x`\n- more').includes('a ` alone'),'a lone backtick stays text and does not pair with one on a later line');
  ok(eq(codes('a `b\nc` d'),[])&&render('a `b\nc` d').includes('a `b<br>c` d'),'a span does not cross a line break (both backticks stay as text)');
  ok(eq(codes('``'),[])&&plain('``')==='``','an empty pair "``" is literal text');
  ok(eq(codes('```'),[])&&plain('``` ')==='```','a lone ``` is literal text');
  ok(eq(codes('``a` b``'),['a` b'])&&eq(codes('`` a ``'),['a']),'a shorter run inside a longer span is content');

  // ---- tag extraction agrees with the reader
  ok(extractTags('``#x ` y`` #real').has('real')&&!extractTags('``#x ` y`` #real').has('x'),'tags: "#x" inside a double-backtick span is ignored, "#real" is found');
  ok(extractTags('lone ` tick then #kept').has('kept'),'tags: a lone backtick does not swallow the tags after it');

  // ---- property check: any mix of backticks, spaces, newlines, * and # gives balanced tags and single-line spans
  let seed=12345; const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const alpha=['`','`','`','a','b',' ',' ','\n','*','#','x','-'];
  let bad=0,first=null;
  for(let i=0;i<400;i++){
    let s=''; const len=1+Math.floor(rnd()*40); for(let j=0;j<len;j++) s+=alpha[Math.floor(rnd()*alpha.length)];
    const h=render(s); const o=(h.match(/<code>/g)||[]).length, c=(h.match(/<\/code>/g)||[]).length;
    const multiline=[...parse(h).querySelectorAll('code')].some(e=>!e.closest('.code-block')&&/\n/.test(e.textContent));
    if(o!==c||multiline){ bad++; if(!first) first=JSON.stringify(s); }
  }
  ok(bad===0,'400 random inputs: <code> always balanced, no span holds a line break'+(first?' (first bad: '+first+')':''));
};
