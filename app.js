// ============================================================================
// Shelfmark — app.js
//
// APP_VERSION / APP_VERSION_DATE below are a DISPLAY LABEL ONLY (shown in the
// bottom-right version badge, visible even on the lock screen before unlock).
// They are SEPARATE from CACHE_VERSION in service-worker.js and do NOT sync
// automatically — bump both together on every deploy, or the badge and the
// actual cached build can silently drift apart. See CACHE_VERSION's comment
// in service-worker.js, and the deploy checklist in README.md.
// ============================================================================
const APP_VERSION = '1.1.0';
const APP_VERSION_DATE = '2026-09-25';

document.getElementById('versionBadge').textContent = 'v' + APP_VERSION + ' · ' + APP_VERSION_DATE;

// ---- crypto / auth ---------------------------------------------------------
const PBKDF2_ITERATIONS = 250000;
let cryptoKey = null; // held only in memory for this session, never persisted

function randomBytes(n){ return crypto.getRandomValues(new Uint8Array(n)); }
function buf2b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b642buf(b64){ return Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); }

async function deriveKey(passcode, salt, iterations){
  const enc = new TextEncoder().encode(passcode);
  const baseKey = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations, hash:'SHA-256' },
    baseKey, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}
async function aesEncrypt(key, bytes){
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, bytes);
  return { iv, cipher };
}
async function aesDecrypt(key, iv, cipher){
  return crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipher);
}
async function encryptJSON(key, obj){
  return aesEncrypt(key, new TextEncoder().encode(JSON.stringify(obj)));
}
async function decryptJSON(key, iv, cipher){
  const plain = await aesDecrypt(key, iv, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

function txSec(mode){ return db.transaction('security', mode).objectStore('security'); }
function getAuth(){ return new Promise(res=>{ const r = txSec('readonly').get('auth'); r.onsuccess=()=>res(r.result||null); r.onerror=()=>res(null); }); }
function putAuth(rec){ return new Promise(res=>{ const r = txSec('readwrite').put(rec); r.onsuccess=()=>res(); }); }

async function createPasscode(passcode){
  const salt = randomBytes(16);
  const key = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
  const { iv, cipher } = await aesEncrypt(key, new TextEncoder().encode('shelfmark-ok'));
  await putAuth({ id:'auth', salt: buf2b64(salt), iterations: PBKDF2_ITERATIONS, verifierIv: buf2b64(iv), verifierCipher: buf2b64(cipher) });
  cryptoKey = key;
}
async function verifyPasscode(passcode){
  const auth = await getAuth();
  if(!auth) return false;
  try{
    const salt = b642buf(auth.salt);
    const key = await deriveKey(passcode, salt, auth.iterations);
    const plain = await aesDecrypt(key, b642buf(auth.verifierIv), b642buf(auth.verifierCipher));
    if(new TextDecoder().decode(plain) !== 'shelfmark-ok') return false;
    cryptoKey = key;
    return true;
  }catch(e){ return false; } // wrong passcode -> GCM tag check fails -> throws
}
async function wipeAllData(){
  db.close();
  await new Promise(res=>{ const r = indexedDB.deleteDatabase('shelfmark'); r.onsuccess=r.onerror=r.onblocked=()=>res(); });
  location.reload();
}

// ---- lock screen wiring -----------------------------------------------------
async function initLockScreen(){
  const auth = await getAuth();
  const confirmInput = document.getElementById('passcodeConfirm');
  if(!auth){
    document.getElementById('lockTitle').textContent = 'Set a passcode';
    document.getElementById('lockSub').textContent = 'This encrypts everything you add to your shelf. There is no recovery — write it down somewhere safe.';
    confirmInput.style.display = 'block';
  } else {
    document.getElementById('lockTitle').textContent = 'Shelfmark is locked';
    document.getElementById('lockSub').textContent = 'Enter your passcode to open your shelf.';
    confirmInput.style.display = 'none';
  }
  document.getElementById('passcodeInput').focus();
}
async function onLockSubmit(){
  const pass = document.getElementById('passcodeInput').value;
  const errEl = document.getElementById('lockError');
  errEl.textContent = '';
  if(pass.length < 4){ errEl.textContent = 'Use at least 4 characters.'; return; }
  const auth = await getAuth();
  if(!auth){
    const confirm2 = document.getElementById('passcodeConfirm').value;
    if(pass !== confirm2){ errEl.textContent = "Passcodes don't match."; return; }
    await createPasscode(pass);
    await unlockApp();
  } else {
    const ok = await verifyPasscode(pass);
    if(!ok){ errEl.textContent = 'Incorrect passcode.'; document.getElementById('passcodeInput').value=''; return; }
    await unlockApp();
  }
}
document.addEventListener('keydown', e=>{
  if(e.key === 'Enter' && !document.getElementById('lockScreen').classList.contains('hidden')) onLockSubmit();
});
function onResetRequest(){
  if(confirm('This permanently erases everything on this shelf on this device. There is no undo. Continue?')){
    wipeAllData();
  }
}
async function unlockApp(){
  document.getElementById('lockScreen').classList.add('hidden');
  const saved = await getPrefsDecrypted();
  if(saved) prefs = saved;
  applyPrefs(prefs);
  render();
}

// ---- IndexedDB --------------------------------------------------------------
const TYPE_COLOR = {pdf:'var(--pdf)', markdown:'var(--md)', image:'var(--img)', audio:'var(--audio)'};
const TYPE_LABEL = {pdf:'PDF', markdown:'Note', image:'Picture', audio:'Recording'};
let db, pendingFile = null, pendingType = null;
let curId = null, curBlobUrl = null, curType = null, curNoteRaw = null;

function openDB(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open('shelfmark', 3);
    req.onupgradeneeded = (e)=>{
      const d = req.result;
      if(!d.objectStoreNames.contains('items')) d.createObjectStore('items',{keyPath:'id'});
      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings',{keyPath:'id'});
      if(!d.objectStoreNames.contains('security')) d.createObjectStore('security',{keyPath:'id'});
    };
    req.onsuccess = ()=>res(req.result);
    req.onerror = ()=>rej(req.error);
  });
}
function blobToDataURL(blob){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function tx(mode){ return db.transaction('items',mode).objectStore('items'); }
function getAllRaw(){ return new Promise((res)=>{ const r = tx('readonly').getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]); }); }
function getOneRaw(id){ return new Promise((res)=>{ const r = tx('readonly').get(id); r.onsuccess=()=>res(r.result); }); }
function putRaw(rec){ return new Promise((res)=>{ const r = tx('readwrite').put(rec); r.onsuccess=()=>res(); }); }
function del(id){ return new Promise((res)=>{ const r = tx('readwrite').delete(id); r.onsuccess=()=>res(); }); }

// Every item is stored as { id, metaIv, metaCipher, contentIv, contentCipher }.
// Metadata (title/category/type/mime/addedAt/progress/bookmarks) is one small
// encrypted JSON blob; file content is encrypted separately (and only
// decrypted on demand, when actually opened) so listing the shelf never has
// to hold every PDF/image/audio blob decrypted in memory at once.
async function encryptItemRecord(item){
  const { id, content, ...meta } = item;
  const { iv: metaIv, cipher: metaCipher } = await encryptJSON(cryptoKey, meta);
  let contentBytes;
  if(meta.type === 'markdown') contentBytes = new TextEncoder().encode(content);
  else contentBytes = await content.arrayBuffer();
  const { iv: contentIv, cipher: contentCipher } = await aesEncrypt(cryptoKey, contentBytes);
  return { id, metaIv, metaCipher, contentIv, contentCipher };
}
async function decryptMeta(rec){
  const meta = await decryptJSON(cryptoKey, rec.metaIv, rec.metaCipher);
  return { id: rec.id, ...meta };
}
async function decryptContent(rec, type, mime){
  const plain = await aesDecrypt(cryptoKey, rec.contentIv, rec.contentCipher);
  if(type === 'markdown') return new TextDecoder().decode(plain);
  return new Blob([plain], { type: mime || undefined });
}
async function getAll(){
  const raws = await getAllRaw();
  return Promise.all(raws.map(decryptMeta));
}
async function getOne(id){
  const rec = await getOneRaw(id);
  if(!rec) return null;
  const meta = await decryptMeta(rec);
  meta.content = await decryptContent(rec, meta.type, meta.mime);
  return meta;
}
async function put(item){
  const rec = await encryptItemRecord(item);
  await putRaw(rec);
}
// Metadata-only update (rename, recategorize, progress, bookmarks) — keeps
// the existing encrypted content blob untouched, just re-encrypts metadata.
async function putMetaOnly(id, metaUpdates){
  const rec = await getOneRaw(id);
  if(!rec) return;
  const meta = await decryptJSON(cryptoKey, rec.metaIv, rec.metaCipher);
  Object.assign(meta, metaUpdates);
  const { iv, cipher } = await encryptJSON(cryptoKey, meta);
  rec.metaIv = iv; rec.metaCipher = cipher;
  await putRaw(rec);
}
// Content-only update (editing a note's text)
async function putContentOnly(id, type, contentValue){
  const rec = await getOneRaw(id);
  if(!rec) return;
  const bytes = type === 'markdown' ? new TextEncoder().encode(contentValue) : await contentValue.arrayBuffer();
  const { iv, cipher } = await aesEncrypt(cryptoKey, bytes);
  rec.contentIv = iv; rec.contentCipher = cipher;
  await putRaw(rec);
}

// ---- Export / Import ----
// Export can be either a passphrase-encrypted file (AES-256-GCM, PBKDF2-
// derived key, own random salt — independent of the app-lock passcode, so a
// backup is portable even if you later change or forget your app passcode)
// or plain JSON (fully readable, opt-in only, for people who explicitly want
// that). Import auto-detects which kind a file is via its `encrypted` flag.
let exportMode = 'enc';
let pendingImportBackup = null;

function setExportMode(m){
  exportMode = m;
  document.getElementById('expModeEnc').classList.toggle('active', m==='enc');
  document.getElementById('expModePlain').classList.toggle('active', m==='plain');
  document.getElementById('expPassFields').style.display = m==='enc' ? 'block' : 'none';
  document.getElementById('expPlainWarning').style.display = m==='plain' ? 'block' : 'none';
  document.getElementById('expError').textContent = '';
}
function openExportModal(){
  document.getElementById('exppass').value = '';
  document.getElementById('exppass2').value = '';
  document.getElementById('expError').textContent = '';
  setExportMode('enc');
  document.getElementById('exportOverlay').style.display = 'flex';
}
function closeExportModal(){ document.getElementById('exportOverlay').style.display = 'none'; }

async function buildExportItems(){
  const metas = await getAll();
  const out = [];
  for(const m of metas){
    const full = await getOne(m.id);
    const content = full.type === 'markdown' ? full.content : await blobToDataURL(full.content);
    out.push({id:full.id, title:full.title, category:full.category, type:full.type, mime:full.mime,
      addedAt:full.addedAt, progress:full.progress, bookmarks:full.bookmarks, content});
  }
  return out;
}
function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

async function doExport(){
  const errEl = document.getElementById('expError');
  errEl.textContent = '';
  const items = await buildExportItems();
  if(!items.length){ errEl.textContent = 'Your shelf is empty — nothing to export yet.'; return; }

  if(exportMode === 'plain'){
    downloadJSON({app:'shelfmark', exportedAt:Date.now(), encrypted:false, items},
      'shelfmark-backup-'+new Date().toISOString().slice(0,10)+'.json');
    closeExportModal();
    return;
  }

  const pass = document.getElementById('exppass').value;
  const pass2 = document.getElementById('exppass2').value;
  if(pass.length < 4){ errEl.textContent = 'Use at least 4 characters.'; return; }
  if(pass !== pass2){ errEl.textContent = "Passphrases don't match."; return; }

  const salt = randomBytes(16);
  const key = await deriveKey(pass, salt, PBKDF2_ITERATIONS);
  const { iv, cipher } = await encryptJSON(key, { items });
  downloadJSON({
    app:'shelfmark', exportedAt:Date.now(), encrypted:true,
    kdf:'PBKDF2', iterations: PBKDF2_ITERATIONS,
    salt: buf2b64(salt), iv: buf2b64(iv), cipher: buf2b64(cipher)
  }, 'shelfmark-backup-'+new Date().toISOString().slice(0,10)+'.enc.json');
  closeExportModal();
}

async function onImportFile(e){
  const f = e.target.files[0];
  e.target.value = '';
  if(!f) return;
  let parsed;
  try{ parsed = JSON.parse(await f.text()); }
  catch(err){ alert("Couldn't read that file — make sure it's a Shelfmark export."); return; }

  if(parsed && parsed.encrypted === true){
    pendingImportBackup = parsed;
    document.getElementById('imppass').value = '';
    document.getElementById('impError').textContent = '';
    document.getElementById('importPassOverlay').style.display = 'flex';
    return;
  }
  await mergeImportedItems(Array.isArray(parsed) ? parsed : (parsed.items || []));
}
function closeImportPassModal(){ document.getElementById('importPassOverlay').style.display = 'none'; pendingImportBackup = null; }

async function doImportDecrypt(){
  const errEl = document.getElementById('impError');
  errEl.textContent = '';
  const pass = document.getElementById('imppass').value;
  if(!pendingImportBackup) return;
  try{
    const salt = b642buf(pendingImportBackup.salt);
    const key = await deriveKey(pass, salt, pendingImportBackup.iterations || PBKDF2_ITERATIONS);
    const { items } = await decryptJSON(key, b642buf(pendingImportBackup.iv), b642buf(pendingImportBackup.cipher));
    document.getElementById('importPassOverlay').style.display = 'none';
    pendingImportBackup = null;
    await mergeImportedItems(items || []);
  }catch(err){
    errEl.textContent = 'Incorrect passphrase.';
  }
}

async function mergeImportedItems(items){
  try{
    const existingItems = await getAll();
    let added = 0, updated = 0;
    for(const it of items){
      let existing = it.id ? existingItems.find(x=>x.id===it.id) : null;
      if(!existing){
        existing = existingItems.find(x=>x.title===it.title && x.type===it.type && x.addedAt===it.addedAt);
      }
      let content = it.content;
      if(it.type !== 'markdown'){
        const res = await fetch(content);
        content = await res.blob();
      }
      const id = existing ? existing.id : (it.id || Date.now()+'-'+Math.random().toString(36).slice(2));
      const record = {
        id, title: it.title || 'Untitled', category: it.category || 'Uncategorized',
        type: it.type, content, mime: it.mime,
        addedAt: it.addedAt || Date.now(), progress: it.progress || null,
        bookmarks: it.bookmarks || []
      };
      await put(record);
      if(existing){ updated++; } else { added++; existingItems.push(record); }
    }
    render();
    const parts = [];
    if(added) parts.push(`added ${added} new item${added===1?'':'s'}`);
    if(updated) parts.push(`updated ${updated} existing item${updated===1?'':'s'}`);
    alert(parts.length ? parts.join(', ')+'.' : "That file didn't contain any recognizable items.");
  }catch(err){
    alert("Couldn't read that file — make sure it's a Shelfmark export.");
  }
}

const FONT_MAP = {serif:"Georgia,'Times New Roman',serif", sans:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", mono:"'SFMono-Regular',Consolas,Menlo,monospace", zh:"'PingFang SC','Heiti SC','Microsoft YaHei',sans-serif"};
const SIZE_MAP = {s:'15px', m:'17px', l:'19px', xl:'22px'};
let prefs = {theme:'auto', font:'serif', size:'m'};
let settingsPanelOpen = false;

function txS(mode){ return db.transaction('settings',mode).objectStore('settings'); }
async function getPrefsDecrypted(){
  const rec = await new Promise(res=>{ const r = txS('readonly').get('prefs'); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); });
  if(!rec) return null;
  try{ return await decryptJSON(cryptoKey, rec.iv, rec.cipher); }catch(e){ return null; }
}
async function putPrefs(p){
  const { iv, cipher } = await encryptJSON(cryptoKey, p);
  return new Promise(res=>{ const r = txS('readwrite').put({id:'prefs', iv, cipher}); r.onsuccess=()=>res(); });
}

function applyPrefs(p){
  if(p.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', p.theme);
  document.documentElement.style.setProperty('--read-font', FONT_MAP[p.font] || FONT_MAP.serif);
  document.documentElement.style.setProperty('--read-size', SIZE_MAP[p.size] || SIZE_MAP.m);
}
function setPref(key, val){
  prefs[key] = val;
  applyPrefs(prefs);
  putPrefs(prefs);
  refreshSettingsUI();
}
function refreshSettingsUI(){
  document.querySelectorAll('#settingsPanel .seg').forEach(seg=>{
    seg.querySelectorAll('button').forEach(b=>{
      const key = ['auto','light','dark','sepia'].includes(b.dataset.v) ? 'theme'
        : ['serif','sans','mono','zh'].includes(b.dataset.v) ? 'font' : 'size';
      b.classList.toggle('active', prefs[key] === b.dataset.v);
    });
  });
}
function toggleSettingsPanel(){
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
  settingsPanelOpen = !settingsPanelOpen;
  document.getElementById('settingsPanel').style.display = settingsPanelOpen ? 'block' : 'none';
  if(settingsPanelOpen) refreshSettingsUI();
}

function detectType(file){
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext==='pdf' || file.type==='application/pdf') return 'pdf';
  if(ext==='md'||ext==='markdown'||ext==='txt') return 'markdown';
  if(file.type.startsWith('image/')) return 'image';
  if(file.type.startsWith('audio/')) return 'audio';
  return null;
}

function onFile(e){
  const f = e.target.files[0];
  if(!f) return;
  const t = detectType(f);
  if(!t){ alert("That file type isn't supported yet — try a PDF, markdown/text note, picture, or audio file."); return; }
  pendingFile = f; pendingType = t;
  document.getElementById('fbtn').textContent = f.name;
  document.getElementById('fbtn').classList.add('has-file');
  const ti = document.getElementById('ttitle');
  if(!ti.value) ti.value = f.name.replace(/\.[^.]+$/, '');
  document.getElementById('saveBtn').disabled = false;
}

async function openAdd(){
  pendingFile = null; pendingType = null;
  document.getElementById('fbtn').textContent = 'Choose a file\u2026';
  document.getElementById('fbtn').classList.remove('has-file');
  document.getElementById('ttitle').value = '';
  document.getElementById('tcat').value = '';
  document.getElementById('saveBtn').disabled = true;
  const items = await getAll();
  const cats = [...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  document.getElementById('catlist').innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">`).join('');
  document.getElementById('overlay').style.display = 'flex';
}
function closeAdd(){ document.getElementById('overlay').style.display = 'none'; }

async function saveItem(){
  if(!pendingFile) return;
  const title = document.getElementById('ttitle').value.trim() || pendingFile.name;
  const category = document.getElementById('tcat').value.trim() || 'Uncategorized';
  let content;
  if(pendingType === 'markdown'){ content = await pendingFile.text(); }
  else { content = pendingFile; }
  const item = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2),
    title, category, type: pendingType, content, mime: pendingFile.type,
    addedAt: Date.now(), progress: null
  };
  await put(item);
  closeAdd();
  render();
}

async function render(){
  const items = (await getAll()).sort((a,b)=>b.addedAt-a.addedAt);
  document.getElementById('empty').style.display = items.length ? 'none' : 'block';
  const shelf = document.getElementById('shelf');
  shelf.innerHTML = '';

  const groups = new Map();
  for(const it of items){
    const cat = it.category || 'Uncategorized';
    if(!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const cats = [...groups.keys()].sort((a,b)=>{
    if(a==='Uncategorized') return 1;
    if(b==='Uncategorized') return -1;
    return a.localeCompare(b);
  });

  for(const cat of cats){
    const head = document.createElement('div');
    head.className = 'cathead';
    head.textContent = cat;
    shelf.appendChild(head);
    for(const it of groups.get(cat)){
      const row = document.createElement('div');
      row.className = 'spine';
      row.style.setProperty('--t', TYPE_COLOR[it.type]);
      row.onclick = ()=>openReader(it.id);
      row.innerHTML = `<div class="meta"><div class="title">${escapeHtml(it.title)}</div>
        <div class="sub">${TYPE_LABEL[it.type]}${it.progress ? ' \u00b7 in progress' : ''}</div></div>
        <button class="edit" title="Rename or recategorize">&#9998;</button>
        <button class="del" title="Remove">&times;</button>`;
      row.querySelector('.edit').onclick = (e)=>{ e.stopPropagation(); openEdit(it.id); };
      row.querySelector('.del').onclick = (e)=>{ e.stopPropagation(); removeItem(it.id); };
      shelf.appendChild(row);
    }
  }
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function removeItem(id){
  if(!confirm('Remove this from your shelf?')) return;
  await del(id);
  render();
}

let editId = null;
async function openEdit(id){
  editId = id;
  const it = await getAll().then(all=>all.find(x=>x.id===id));
  if(!it) return;
  document.getElementById('etitle').value = it.title;
  document.getElementById('ecat').value = (it.category && it.category !== 'Uncategorized') ? it.category : '';
  const items = await getAll();
  const cats = [...new Set(items.map(i=>i.category).filter(c=>c && c!=='Uncategorized'))].sort();
  document.getElementById('catlist2').innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">`).join('');
  document.getElementById('editOverlay').style.display = 'flex';
}
function closeEdit(){ document.getElementById('editOverlay').style.display = 'none'; editId = null; }
async function saveEdit(){
  if(!editId) return;
  const title = document.getElementById('etitle').value.trim();
  const category = document.getElementById('ecat').value.trim() || 'Uncategorized';
  await putMetaOnly(editId, { ...(title && {title}), category });
  closeEdit();
  render();
}

// ---- Reader ----
async function openReader(id){
  const it = await getOne(id);
  if(!it) return;
  curId = id; curType = it.type;
  document.getElementById('rtitle').textContent = it.title;
  document.getElementById('bmBtn').style.display = 'none';
  document.getElementById('editNoteBtn').style.display = 'none';
  document.getElementById('settingsBtn').style.display = 'none';
  settingsPanelOpen = false;
  document.getElementById('settingsPanel').style.display = 'none';
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
  const c = document.getElementById('rcontent');
  c.className = ''; c.innerHTML = '';
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }

  if(it.type === 'pdf'){
    c.classList.add('pad0');
    curBlobUrl = URL.createObjectURL(it.content);
    c.innerHTML = `<iframe class="pdf" src="${curBlobUrl}"></iframe>`;
  } else if(it.type === 'image'){
    curBlobUrl = URL.createObjectURL(it.content);
    c.innerHTML = `<img class="full" src="${curBlobUrl}">`;
  } else if(it.type === 'markdown'){
    curNoteRaw = it.content;
    const div = document.createElement('div');
    div.className = 'mdbody';
    div.id = 'mdView';
    div.innerHTML = renderMarkdown(it.content);
    const editWrap = document.createElement('div');
    editWrap.id = 'mdEditWrap';
    editWrap.innerHTML = `<textarea class="mdedit" id="mdEditArea" spellcheck="false"></textarea>
      <div class="ebar"><button class="cancel" onclick="cancelEditNote()">Cancel</button>
      <button class="save" onclick="saveEditNote()">Save</button></div>`;
    c.appendChild(div);
    c.appendChild(editWrap);
    if(it.progress && it.progress.scroll) c.scrollTop = it.progress.scroll;
    c.onscroll = ()=>{ clearTimeout(c._t); c._t = setTimeout(()=>saveProgress({scroll:c.scrollTop}), 400); };
    document.getElementById('bmBtn').style.display = 'flex';
    document.getElementById('editNoteBtn').style.display = 'flex';
    document.getElementById('settingsBtn').style.display = 'flex';
    updateBookmarkUI(it.bookmarks || []);
  } else if(it.type === 'audio'){
    curBlobUrl = URL.createObjectURL(it.content);
    c.innerHTML = `
      <div class="avwrap">
        <div class="disc">&#9835;</div>
        <audio id="aud" src="${curBlobUrl}" style="display:none"></audio>
        <div class="actrl">
          <button class="skip" onclick="skip(-10)">&#8634;10</button>
          <button class="play" id="playBtn" onclick="togglePlay()">&#9658;</button>
          <button class="skip" onclick="skip(10)">10&#8635;</button>
        </div>
        <input type="range" class="scrub" id="scrub" min="0" max="100" value="0">
        <div class="time" id="atime">0:00</div>
      </div>`;
    const aud = document.getElementById('aud');
    aud.onloadedmetadata = ()=>{ if(it.progress && it.progress.time) aud.currentTime = it.progress.time; };
    aud.ontimeupdate = ()=>{
      const pct = aud.duration ? (aud.currentTime/aud.duration)*100 : 0;
      document.getElementById('scrub').value = pct;
      document.getElementById('atime').textContent = fmtTime(aud.currentTime) + ' / ' + fmtTime(aud.duration||0);
      clearTimeout(aud._t); aud._t = setTimeout(()=>saveProgress({time:aud.currentTime}), 800);
    };
    aud.onplay = ()=>document.getElementById('playBtn').innerHTML = '&#10074;&#10074;';
    aud.onpause = ()=>document.getElementById('playBtn').innerHTML = '&#9658;';
    document.getElementById('scrub').oninput = (e)=>{ aud.currentTime = (e.target.value/100)*(aud.duration||0); };
  }
  document.getElementById('reader').classList.add('open');
}
function togglePlay(){ const a = document.getElementById('aud'); if(a.paused) a.play(); else a.pause(); }
function skip(s){ const a = document.getElementById('aud'); a.currentTime = Math.max(0, Math.min((a.duration||0), a.currentTime+s)); }
function fmtTime(t){ t=Math.floor(t); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); }

async function saveProgress(p){
  if(!curId) return;
  await putMetaOnly(curId, { progress: p });
}

function startEditNote(){
  document.getElementById('mdEditArea').value = curNoteRaw;
  document.getElementById('mdView').style.display = 'none';
  document.getElementById('mdEditWrap').style.display = 'flex';
  document.getElementById('bmBtn').style.display = 'none';
  document.getElementById('editNoteBtn').classList.add('active');
  document.getElementById('mdEditArea').focus();
}
function cancelEditNote(){
  document.getElementById('mdEditWrap').style.display = 'none';
  document.getElementById('mdView').style.display = 'block';
  document.getElementById('bmBtn').style.display = 'flex';
  document.getElementById('editNoteBtn').classList.remove('active');
}
async function saveEditNote(){
  if(!curId) return;
  const text = document.getElementById('mdEditArea').value;
  await putContentOnly(curId, 'markdown', text);
  curNoteRaw = text;
  document.getElementById('mdView').innerHTML = renderMarkdown(text);
  const it = await getOne(curId);
  updateBookmarkUI(it.bookmarks || []);
  cancelEditNote();
}

let bmPanelOpen = false;
function toggleBookmarkPanel(){
  settingsPanelOpen = false;
  document.getElementById('settingsPanel').style.display = 'none';
  bmPanelOpen = !bmPanelOpen;
  document.getElementById('bmPanel').style.display = bmPanelOpen ? 'block' : 'none';
}
async function toggleBookmark(idx){
  const it = await getOne(curId);
  if(!it) return;
  const bookmarks = it.bookmarks || [];
  const pos = bookmarks.findIndex(b=>b.idx===idx);
  if(pos>-1){
    bookmarks.splice(pos,1);
  } else {
    const el = document.querySelector(`.mdblock[data-idx="${idx}"]`);
    const snippet = el ? el.textContent.trim().slice(0,80) : ('Paragraph '+(idx+1));
    bookmarks.push({idx, snippet, createdAt:Date.now()});
  }
  await putMetaOnly(curId, { bookmarks });
  updateBookmarkUI(bookmarks);
}
async function deleteBookmark(idx){
  const it = await getOne(curId);
  if(!it) return;
  const bookmarks = (it.bookmarks||[]).filter(b=>b.idx!==idx);
  await putMetaOnly(curId, { bookmarks });
  updateBookmarkUI(bookmarks);
}
function jumpBookmark(idx){
  const el = document.querySelector(`.mdblock[data-idx="${idx}"]`);
  if(el) el.scrollIntoView({block:'center', behavior:'smooth'});
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
}
function updateBookmarkUI(bookmarks){
  document.querySelectorAll('.mdblock').forEach(el=>{
    el.classList.toggle('bookmarked', bookmarks.some(b=>b.idx===Number(el.dataset.idx)));
  });
  document.getElementById('bmCount').textContent = bookmarks.length ? ' '+bookmarks.length : '';
  document.getElementById('bmBtn').classList.toggle('active', bookmarks.length>0);
  const panel = document.getElementById('bmPanel');
  if(!bookmarks.length){
    panel.innerHTML = `<div class="bmempty">No bookmarks yet — tap the ribbon next to a paragraph to save your spot.</div>`;
    return;
  }
  panel.innerHTML = bookmarks.slice().sort((a,b)=>a.idx-b.idx).map(b=>`
    <div class="bmrow">
      <div class="snip" onclick="jumpBookmark(${b.idx})">${escapeHtml(b.snippet)}</div>
      <button class="rm" onclick="event.stopPropagation();deleteBookmark(${b.idx})" title="Remove bookmark">&times;</button>
    </div>`).join('');
}

function closeReader(){
  document.getElementById('reader').classList.remove('open');
  const aud = document.getElementById('aud');
  if(aud) aud.pause();
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }
  curId = null; curType = null;
  render();
}

// minimal markdown renderer
function renderMarkdown(src){
  let s = escapeHtml(src);
  s = s.replace(/```([\s\S]*?)```/g, (_,c)=>`<pre><code>${c.trim()}</code></pre>`);
  s = s.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  s = s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s = s.replace(/\[(.+?)\]\((.+?)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.split(/\n{2,}/).map((block,idx)=>{
    let html;
    if(/^<h[123]|^<pre/.test(block)) html = block;
    else if(/^\s*[-*]\s+/m.test(block)){
      const items = block.split(/\n/).filter(l=>l.trim()).map(l=>`<li>${l.replace(/^\s*[-*]\s+/,'')}</li>`).join('');
      html = `<ul>${items}</ul>`;
    } else html = `<p>${block.replace(/\n/g,'<br>')}</p>`;
    return `<div class="mdblock" data-idx="${idx}"><button class="bm-btn" onclick="toggleBookmark(${idx})" title="Bookmark this spot">&#128278;</button>${html}</div>`;
  }).join('\n');
}

// ---- boot -------------------------------------------------------------------
(async function init(){
  db = await openDB();
  await initLockScreen(); // shows setup or unlock screen; render() runs after unlockApp()
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
