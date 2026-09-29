// Loads the REAL app.js + index.html into jsdom and returns the window (renderMarkdown etc. are global function declarations)
const fs=require('fs'); const {JSDOM}=require('jsdom');
require('fake-indexeddb/auto');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const path=require('path');
module.exports=function(root){
  root = root || (path.resolve(__dirname,'..')+'/');
  const html=fs.readFileSync(root+'index.html','utf8').replace(/<script src="app.js"><\/script>/,'');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://localhost/',pretendToBeVisual:true});
  const w=dom.window;
  w.indexedDB=indexedDB; w.IDBKeyRange=IDBKeyRange;
  const {webcrypto}=require('crypto'); Object.defineProperty(w,'crypto',{value:webcrypto,configurable:true});
  w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder;
  w.matchMedia=w.matchMedia||(()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  w.eval(fs.readFileSync(root+'app.js','utf8')+'\n;window.__setPref=(k,v)=>{ prefs[k]=v; };window.__ext=()=>({extRoot,extRootName});window.__setExt=(r,n)=>{ extRoot=r; extRootName=n; };window.__setPendingImport=v=>{ pendingImportBackup=v; };window.__key=()=>cryptoKey;');
  return w;
};
