// v1.51.12: inline code spans: double-backtick spans, unmatched backticks, and the "everything below
// turned into code" bug. Cases live in inline_code_cases.js (shared so they can run in a real browser too).
// Run: node test_inline_code.js [path-to-project-dir/]
process.on('unhandledRejection',()=>{});
const w=require('./load.js')(process.argv[2]);
const {JSDOM}=require('jsdom');
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
require('./inline_code_cases.js')({
  render:s=>w.renderMarkdown(s,{}),
  parse:h=>new JSDOM('<body>'+h+'</body>').window.document,
  extractTags:s=>w.extractTags(s)
},ok);
console.log(fails?`\n${fails} of ${n} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
