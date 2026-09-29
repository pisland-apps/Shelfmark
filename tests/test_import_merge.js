// v1.51.9: the import summary separates "shelf already has a newer copy" (harmless) from "couldn't be read".
// Run: node test_import_merge.js [path-to-project-dir/]
require('./guard.js')();
const w=require('./load.js')(process.argv[2]);
let fails=0,n=0; const ok=(c,m)=>{ n++; if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); };
let alerts=[]; w.alert=m=>alerts.push(String(m));
const note=(id,title,updatedAt,content)=>({id,title,category:'C',type:'markdown',mime:'text/markdown',content:content||'x',addedAt:100,updatedAt});
const last=()=>alerts[alerts.length-1]||'';
(async()=>{
  await new Promise(r=>setTimeout(r,300));
  await w.eval("createPasscode('test1234')");
  await w.put(note('n1','Newer on shelf 1',5000)); await w.put(note('n2','Newer on shelf 2',5000)); await w.put(note('n3','Older on shelf',1000,'old text'));

  // 2 older-in-backup (kept), 1 newer-in-backup (updated), 1 brand new, 1 unknown type, 1 null, 1 image with bad data
  alerts=[];
  await w.mergeImportedItems([
    note('n1','Newer on shelf 1',2000), note('n2','Newer on shelf 2',3000),
    note('n3','Older on shelf',9000,'new text'),
    note('n4','Brand new',1),
    {id:'z1',title:'Weird',type:'spreadsheet',addedAt:1}, null,
    {id:'i1',title:'Pic',type:'image',content:'https://evil.example/x.png',addedAt:1}
  ], {id:'sh',name:'S'});
  const m=last();
  ok(/added 1 new item\b/.test(m),'reports the new item');
  ok(/updated 1 existing item\b/.test(m),'reports the updated item');
  ok(/left 2 items unchanged because your shelf already has a newer copy/.test(m),'newer-on-shelf is counted and explained: '+m);
  ok(/skipped 3 items that couldn't be read/.test(m),'unknown type + null + bad media data counted as unreadable');
  ok(!/corrupted or outdated/.test(m),'the old mixed-up wording is gone');
  ok((await w.getOne('n1')).updatedAt===5000,'the newer shelf copy was really kept');
  ok((await w.getOne('n3')).content==='new text','the newer backup copy really replaced the old one');

  // only-newer case: no scary wording, no "skipped"
  alerts=[]; await w.mergeImportedItems([note('n1','Newer on shelf 1',10)],{id:'sh'});
  ok(/left 1 item unchanged because your shelf already has a newer copy/.test(last())&&!/skipped|couldn't be read/.test(last()),'only-newer import: singular wording, nothing alarming');
  // only-unreadable case
  alerts=[]; await w.mergeImportedItems([{title:'x',type:'nope'}],{id:'sh'});
  ok(/skipped 1 item that couldn't be read/.test(last())&&!/newer copy/.test(last()),'only-unreadable import: singular wording');
  // nothing usable at all
  alerts=[]; await w.mergeImportedItems([],{id:'sh'});
  ok(/didn't contain any recognizable items/.test(last()),'empty file still says so');

  console.log(fails?`\n${fails} FAILED`:`\nALL ${n} PASSED`); process.exit(fails?1:0);
})();
