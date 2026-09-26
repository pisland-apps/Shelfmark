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
const APP_VERSION = '1.8.0';
const APP_VERSION_DATE = '2026-09-26';

document.getElementById('versionBadge').textContent = 'v' + APP_VERSION + ' · ' + APP_VERSION_DATE;

// ---- crypto / auth ---------------------------------------------------------
const PBKDF2_ITERATIONS = 250000;
let cryptoKey = null; // held only in memory for this session, never persisted

function randomBytes(n){ return crypto.getRandomValues(new Uint8Array(n)); }
function buf2b64(buf){
  // Do NOT spread the whole buffer into String.fromCharCode(...bytes) — that
  // passes one function argument per byte, and JS engines cap how many
  // arguments a call can take (tens of thousands, well below what a
  // multi-MB encrypted export — PDFs/images/audio, base64'd then
  // re-encrypted — needs). Past that cap it throws "Maximum call stack
  // size exceeded". Build the string in fixed-size chunks instead so it
  // works at any size.
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = '';
  for(let i = 0; i < bytes.length; i += CHUNK){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
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
function putAuth(rec){ return new Promise((res,rej)=>{ const r = txSec('readwrite').put(rec); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

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
  if(saved) prefs = { ...prefs, ...saved };
  applyPrefs(prefs);
  render();
  // Best-effort: ask the browser to protect this origin's storage from
  // automatic eviction under disk pressure. Silent either way — some
  // browsers auto-grant based on site engagement, some prompt, some just
  // say no; none of that should block or interrupt using the app.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(()=>{});
  }
}

// ---- IndexedDB --------------------------------------------------------------
const TYPE_COLOR = {pdf:'var(--pdf)', markdown:'var(--md)', image:'var(--img)', audio:'var(--audio)'};
const TYPE_LABEL = {pdf:'PDF', markdown:'Note', image:'Picture', audio:'Recording'};
let db, pendingFile = null, pendingType = null;
let curId = null, curBlobUrl = null, curType = null, curNoteRaw = null;

// ---- Inline shelf audio player ----
// Audio items play directly from the shelf row (tap to play/pause, inline
// progress bar) instead of opening the full-page reader. One shared <audio>
// element is reused across tracks; the file is only decrypted when actually
// played, not eagerly for every audio row.
let shelfAudioEl = null, shelfPlayingId = null, shelfPlayingTitle = null, shelfPlayingCategory = null, shelfAudioBlobUrl = null;
// Which category headers are collapsed. In-memory only (resets on reload,
// matching that nothing but library content lives in IndexedDB) — expanded
// is the default each time the app opens.
const collapsedCats = new Set();
// Sort order for items within each category: 'newest' (added-date desc,
// the original behavior) or 'title' (alphabetical). In-memory only, same
// reasoning as collapsedCats — resets to 'newest' each time the app opens.
let itemSortMode = 'newest';
function toggleSortMode(){
  itemSortMode = itemSortMode === 'newest' ? 'title' : 'newest';
  const btn = document.getElementById('sortBtn');
  if(btn){
    btn.textContent = itemSortMode === 'newest' ? 'Newest' : 'A\u2013Z';
    btn.title = itemSortMode === 'newest'
      ? 'Sorting items by newest added \u2014 tap for A\u2013Z'
      : 'Sorting items A\u2013Z \u2014 tap for newest added';
  }
  render();
}

function ensureShelfAudio(){
  if(shelfAudioEl) return shelfAudioEl;
  shelfAudioEl = new Audio();
  shelfAudioEl.addEventListener('timeupdate', onShelfAudioTimeUpdate);
  shelfAudioEl.addEventListener('play', ()=>refreshShelfAudioRowUI());
  shelfAudioEl.addEventListener('pause', ()=>refreshShelfAudioRowUI());
  shelfAudioEl.addEventListener('ended', onShelfAudioEnded);
  return shelfAudioEl;
}
// Shelf order within a category, same sort/grouping render() uses — used to
// find "the next track" for auto-advance.
async function categoryAudioOrder(category){
  const items = (await getAll()).sort((a,b)=>b.addedAt-a.addedAt);
  return items.filter(it=>it.type==='audio' && (it.category||'Uncategorized')===category).map(it=>it.id);
}
async function onShelfAudioEnded(){
  const finishedId = shelfPlayingId, cat = shelfPlayingCategory;
  if(finishedId) await saveShelfProgress(finishedId, 0);
  if(cat){
    const order = await categoryAudioOrder(cat);
    const idx = order.indexOf(finishedId);
    if(idx > -1 && idx < order.length - 1){
      await playShelfTrack(order[idx+1]);
      return;
    }
    // Last track in the category: loop back to the first one if the loop
    // toggle (header, 🔁) is on. Only loops when there's more than one
    // track — a single-item category just replays itself.
    if(prefs.loopAudio && order.length > 0){
      await playShelfTrack(order[0]);
      return;
    }
  }
  shelfPlayingId = null; shelfPlayingTitle = null; shelfPlayingCategory = null;
  refreshShelfAudioRowUI();
}
async function playShelfTrack(id, opts){
  const autoplay = !opts || opts.autoplay !== false;
  const aud = ensureShelfAudio();
  if(shelfPlayingId && shelfPlayingId !== id){
    await saveShelfProgress(shelfPlayingId, aud.currentTime);
  }
  if(shelfAudioBlobUrl){ URL.revokeObjectURL(shelfAudioBlobUrl); shelfAudioBlobUrl = null; }
  const it = await getOne(id);
  if(!it || it.type !== 'audio'){
    alert("This linked recording isn't on your shelf anymore — it may have been deleted.");
    return;
  }
  shelfAudioBlobUrl = URL.createObjectURL(it.content);
  shelfPlayingId = id;
  shelfPlayingTitle = it.title;
  shelfPlayingCategory = it.category || 'Uncategorized';
  aud.src = shelfAudioBlobUrl;
  aud.playbackRate = audioSpeed;
  aud.onloadedmetadata = ()=>{
    if(it.progress && it.progress.time) aud.currentTime = it.progress.time;
    if(autoplay) aud.play();
    onShelfAudioTimeUpdate(); // paint scrub/time/mini-player right away, don't wait for the first tick
  };
  refreshShelfAudioRowUI();
}
async function toggleShelfPlay(id){
  const aud = ensureShelfAudio();
  if(shelfPlayingId === id){
    if(aud.paused) aud.play(); else aud.pause();
    return;
  }
  await playShelfTrack(id);
}
function onShelfAudioTimeUpdate(){
  if(!shelfPlayingId) return;
  const aud = shelfAudioEl;
  const pct = aud.duration ? (aud.currentTime/aud.duration)*100 : 0;
  document.querySelectorAll(`[data-audio-id="${shelfPlayingId}"]`).forEach(row=>{
    const fill = row.querySelector('.inline-bar-fill');
    if(fill) fill.style.width = pct + '%';
    const timeEl = row.querySelector('.inline-time');
    if(timeEl) timeEl.textContent = fmtTime(aud.currentTime) + ' / ' + fmtTime(aud.duration || 0);
  });
  // Also keep the full-page audio reader in sync, when it's open and
  // showing this exact track (it reads the same shared element, not a
  // separate one, so this is just painting its scrub bar/time label).
  if(curId === shelfPlayingId && curType === 'audio'){
    const scrub = document.getElementById('scrub');
    if(scrub) scrub.value = pct;
    const atime = document.getElementById('atime');
    if(atime) atime.textContent = fmtTime(aud.currentTime) + ' / ' + fmtTime(aud.duration || 0);
  }
  const mpFill = document.getElementById('mpBarFill');
  if(mpFill) mpFill.style.width = pct + '%';
  clearTimeout(aud._t);
  aud._t = setTimeout(()=>saveShelfProgress(shelfPlayingId, aud.currentTime), 800);
}
async function saveShelfProgress(id, time){
  try{ await putMetaOnly(id, { progress: { time } }); }
  catch(err){ /* autosave — fail silently, don't interrupt playback with alerts */ }
}
function refreshShelfAudioRowUI(){
  document.querySelectorAll('[data-audio-id]').forEach(row=>{
    const isCurrent = row.dataset.audioId === shelfPlayingId;
    row.classList.toggle('playing', isCurrent && shelfAudioEl && !shelfAudioEl.paused);
    const btn = row.querySelector('.inline-play');
    if(btn) btn.innerHTML = (isCurrent && shelfAudioEl && !shelfAudioEl.paused) ? '&#10074;&#10074;' : '&#9658;';
  });
  const playing = shelfAudioEl && !shelfAudioEl.paused;
  const readerPlayBtn = document.getElementById('playBtn');
  if(readerPlayBtn && curId === shelfPlayingId && curType === 'audio'){
    readerPlayBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9658;';
  }
  updateMiniPlayer();
}

// ---- Persistent mini-player ----
// Shows whenever a track is loaded (playing or paused), so playback keeps
// going — and stays controllable — while browsing anywhere else in the
// app. Hidden specifically when the full-page audio reader is already open
// for this exact track, since its own controls make the mini bar redundant
// right there.
function updateMiniPlayer(){
  const mp = document.getElementById('miniPlayer');
  const readerShowingThisTrack = curId === shelfPlayingId && curType === 'audio'
    && document.getElementById('reader').classList.contains('open');
  if(!shelfPlayingId || readerShowingThisTrack){
    mp.classList.remove('show');
    return;
  }
  mp.classList.add('show');
  document.getElementById('mpTitle').textContent = shelfPlayingTitle || '';
  const playing = shelfAudioEl && !shelfAudioEl.paused;
  document.getElementById('mpPlayBtn').innerHTML = playing ? '&#10074;&#10074;' : '&#9658;';
}
function miniPlayerToggle(){ if(shelfPlayingId) toggleShelfPlay(shelfPlayingId); }
function miniPlayerOpenFull(){ if(shelfPlayingId) openReader(shelfPlayingId); }
function miniPlayerClose(){
  if(!shelfPlayingId) return;
  if(shelfAudioEl){
    shelfAudioEl.pause();
    saveShelfProgress(shelfPlayingId, shelfAudioEl.currentTime);
  }
  shelfPlayingId = null; shelfPlayingTitle = null; shelfPlayingCategory = null;
  refreshShelfAudioRowUI(); // also hides the mini bar and resets shelf-row icons
}

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
function putRaw(rec){ return new Promise((res,rej)=>{ const r = tx('readwrite').put(rec); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function del(id){ return new Promise((res,rej)=>{ const r = tx('readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function isQuotaError(err){
  return !!err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
}
function fmtBytes(n){
  if(n == null || isNaN(n)) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, v = n;
  while(v >= 1024 && i < units.length - 1){ v /= 1024; i++; }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}
async function updateStorageBadge(){
  const btn = document.getElementById('storageBtn');
  if(!btn) return;
  if(!(navigator.storage && navigator.storage.estimate)){ btn.style.display = 'none'; return; }
  try{
    const { usage, quota } = await navigator.storage.estimate();
    const pct = quota ? Math.round((usage / quota) * 100) : null;
    btn.textContent = pct === null ? fmtBytes(usage) : pct + '%';
    btn.title = `Storage used: ${fmtBytes(usage)}${quota ? ' of ' + fmtBytes(quota) + ' available' : ''} — tap for details`;
    btn.style.display = 'flex';
  }catch(err){ btn.style.display = 'none'; }
}
async function showStorageDetail(){
  if(!(navigator.storage && navigator.storage.estimate)){
    alert("Your browser doesn't report storage usage here, so there's nothing to show — Shelfmark itself has no built-in size limit beyond what your browser/device allows.");
    return;
  }
  const { usage, quota } = await navigator.storage.estimate();
  const pct = quota ? Math.round((usage / quota) * 100) : null;
  let persisted = 'unknown';
  if(navigator.storage && navigator.storage.persisted){
    try{ persisted = (await navigator.storage.persisted()) ? 'yes' : 'no'; }catch(err){}
  }
  alert(
    `Storage used: ${fmtBytes(usage)}${quota ? ` of ${fmtBytes(quota)} available (${pct}%)` : ''}\n` +
    `Protected from automatic cleanup: ${persisted}\n\n` +
    `This is shared with everything else this site stores in your browser — Shelfmark itself doesn't cap how much you can add beyond that.`
  );
}

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
      addedAt:full.addedAt, progress:full.progress, bookmarks:full.bookmarks, cover:full.cover || null, content});
  }
  return out;
}
async function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj)], {type:'application/json'});
  // In a standalone, home-screen-installed PWA (iOS especially — this app
  // ships an apple-touch-icon for exactly that use case) there's no browser
  // chrome to catch a synthetic <a download> click, so it silently does
  // nothing: no error, no download, no dialog. It also has to fire
  // *synchronously* inside the user's tap — any await beforehand (we do
  // IndexedDB reads and, for encrypted exports, PBKDF2 + AES-GCM) already
  // breaks that. The Web Share API routes through the native share sheet
  // instead, which does work from an installed PWA, so try that first and
  // only fall back to the old anchor-click for browsers/tabs that don't
  // support sharing files.
  const file = new File([blob], filename, {type:'application/json'});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{
      await navigator.share({files:[file], title: filename});
      return;
    }catch(err){
      if(err && err.name === 'AbortError') return; // user closed the share sheet — not a failure
      // any other error: fall through to the download-link path below
    }
  }
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
    await downloadJSON({app:'shelfmark', exportedAt:Date.now(), encrypted:false, items},
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
  await downloadJSON({
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
  let added = 0, updated = 0, stoppedOnQuota = false;
  try{
    const existingItems = await getAll();
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
        bookmarks: it.bookmarks || [], cover: isValidCoverDataUrl(it.cover) ? it.cover : null
      };
      try{
        await put(record);
      }catch(err){
        if(isQuotaError(err)){ stoppedOnQuota = true; break; } // stop; keep whatever imported so far
        throw err;
      }
      if(existing){ updated++; } else { added++; existingItems.push(record); }
    }
    render();
    const parts = [];
    if(added) parts.push(`added ${added} new item${added===1?'':'s'}`);
    if(updated) parts.push(`updated ${updated} existing item${updated===1?'':'s'}`);
    if(stoppedOnQuota){
      alert((parts.length ? parts.join(', ')+', then s' : 'S')+"topped partway through — your device's storage is full. Free up space or remove a few items, then re-import the same file to pick up the rest (already-imported items will be skipped).");
    } else {
      alert(parts.length ? parts.join(', ')+'.' : "That file didn't contain any recognizable items.");
    }
  }catch(err){
    alert("Couldn't read that file — make sure it's a Shelfmark export.");
  }
}

const FONT_MAP = {serif:"Georgia,'Times New Roman',serif", sans:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", mono:"'SFMono-Regular',Consolas,Menlo,monospace", zh:"'PingFang SC','Heiti SC','Microsoft YaHei',sans-serif"};
const SIZE_MAP = {s:'15px', m:'17px', l:'19px', xl:'22px'};
let prefs = {theme:'auto', font:'serif', size:'m', loopAudio:false};
let settingsPanelOpen = false;

function txS(mode){ return db.transaction('settings',mode).objectStore('settings'); }
async function getPrefsDecrypted(){
  const rec = await new Promise(res=>{ const r = txS('readonly').get('prefs'); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); });
  if(!rec) return null;
  try{ return await decryptJSON(cryptoKey, rec.iv, rec.cipher); }catch(e){ return null; }
}
async function putPrefs(p){
  const { iv, cipher } = await encryptJSON(cryptoKey, p);
  return new Promise((res,rej)=>{ const r = txS('readwrite').put({id:'prefs', iv, cipher}); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
}

function applyPrefs(p){
  if(p.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', p.theme);
  document.documentElement.style.setProperty('--read-font', FONT_MAP[p.font] || FONT_MAP.serif);
  document.documentElement.style.setProperty('--read-size', SIZE_MAP[p.size] || SIZE_MAP.m);
  const loopBtn = document.getElementById('loopBtn');
  if(loopBtn) loopBtn.classList.toggle('active', !!p.loopAudio);
}
function toggleLoopAudio(){
  prefs.loopAudio = !prefs.loopAudio;
  applyPrefs(prefs);
  putPrefs(prefs).catch(()=>{});
}
function setPref(key, val){
  prefs[key] = val;
  applyPrefs(prefs);
  putPrefs(prefs).catch(()=>{});
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
  // A cover image doesn't make sense on top of a picture that's already the
  // whole item, so the field only shows for the other three types.
  const coverField = document.getElementById('coverField');
  if(t === 'image'){
    coverField.style.display = 'none';
    removeCover('add');
  } else {
    coverField.style.display = 'block';
  }
}

async function openAdd(){
  pendingFile = null; pendingType = null;
  document.getElementById('fbtn').textContent = 'Choose a file\u2026';
  document.getElementById('fbtn').classList.remove('has-file');
  document.getElementById('ttitle').value = '';
  document.getElementById('tcat').value = '';
  document.getElementById('saveBtn').disabled = true;
  document.getElementById('coverField').style.display = 'none';
  removeCover('add');
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
    addedAt: Date.now(), progress: null,
    ...(pendingCoverDataUrl ? {cover: pendingCoverDataUrl} : {})
  };
  try{
    await put(item);
  }catch(err){
    if(isQuotaError(err)) alert("Your device's storage is full, so this couldn't be saved. Free up space, remove a few items from your shelf, or export a backup and move it elsewhere — then try again.");
    else alert("Couldn't save this item — please try again.");
    return; // keep the Add sheet open with the fields intact
  }
  closeAdd();
  render();
}

// ---- Cover images ----
// A cover is stored as a small resized JPEG data URL right inside the
// item's (already-encrypted) metadata — not as a separate encrypted field
// like PDF/audio/image content — so it shows up in the shelf list without
// having to decrypt each item's full content just to list them. Keeping it
// downsized matters because every item's metadata, cover included, gets
// decrypted every time the shelf list renders.
let pendingCoverDataUrl = null; // Add sheet: null = none chosen
let editCoverDataUrl; // Edit sheet: undefined = unchanged, null = removed, string = new
function resizeCoverImage(file, maxDim, quality){
  maxDim = maxDim || 640; quality = quality || 0.82;
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      let { width, height } = img;
      if(width > maxDim || height > maxDim){
        if(width >= height){ height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      // JPEG has no alpha channel — an un-filled canvas defaults to
      // transparent-black, so a transparent PNG cover would otherwise come
      // out with a solid black background once flattened to JPEG.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}
async function onCoverPick(e, mode){
  const f = e.target.files[0];
  e.target.value = '';
  if(!f) return;
  let dataUrl;
  try{ dataUrl = await resizeCoverImage(f); }
  catch(err){ alert("Couldn't use that image \u2014 try a different file."); return; }
  if(mode === 'add') pendingCoverDataUrl = dataUrl; else editCoverDataUrl = dataUrl;
  const preview = document.getElementById(mode === 'add' ? 'coverPreview' : 'coverPreviewEdit');
  preview.src = dataUrl; preview.style.display = 'block';
  document.getElementById(mode === 'add' ? 'coverRemoveBtn' : 'coverRemoveBtnEdit').style.display = 'block';
}
function removeCover(mode){
  if(mode === 'add') pendingCoverDataUrl = null; else editCoverDataUrl = null;
  const preview = document.getElementById(mode === 'add' ? 'coverPreview' : 'coverPreviewEdit');
  preview.src = ''; preview.style.display = 'none';
  document.getElementById(mode === 'add' ? 'coverRemoveBtn' : 'coverRemoveBtnEdit').style.display = 'none';
}

let searchQuery = '';
function onSearchInput(){
  searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();
  render();
}

async function render(){
  const allItems = (await getAll()).sort((a,b)=>b.addedAt-a.addedAt);
  const items = searchQuery
    ? allItems.filter(it => it.title.toLowerCase().includes(searchQuery) || (it.category||'').toLowerCase().includes(searchQuery))
    : allItems;
  document.getElementById('empty').style.display = allItems.length ? 'none' : 'block';
  const noResults = document.getElementById('noResults');
  if(allItems.length && searchQuery && !items.length){
    document.getElementById('noResultsText').textContent = `No matches for "${document.getElementById('searchInput').value.trim()}"`;
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }
  const shelf = document.getElementById('shelf');
  shelf.innerHTML = '';
  updateStorageBadge();

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
  if(itemSortMode === 'title'){
    // numeric:true so "2" sorts before "10" (plain localeCompare would put
    // "10" first) — matters for titles like the recordings in the
    // screenshot (01, 02_1, 02_2, 02_10, ...).
    for(const list of groups.values()){
      list.sort((a,b)=>a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
    }
  }

  for(const cat of cats){
    const head = document.createElement('div');
    head.className = 'cathead';
    if(collapsedCats.has(cat)) head.classList.add('collapsed');
    head.innerHTML = `<span class="chev">&#9656;</span><span>${escapeHtml(cat)}</span>`;
    shelf.appendChild(head);

    const body = document.createElement('div');
    body.className = 'catbody';
    if(collapsedCats.has(cat)) body.classList.add('collapsed');

    head.onclick = () => {
      const nowCollapsed = body.classList.toggle('collapsed');
      head.classList.toggle('collapsed', nowCollapsed);
      if(nowCollapsed) collapsedCats.add(cat); else collapsedCats.delete(cat);
    };

    for(const it of groups.get(cat)){
      const row = document.createElement('div');
      row.className = 'spine';
      row.dataset.id = it.id;
      row.style.setProperty('--t', TYPE_COLOR[it.type]);

      if(it.type === 'audio'){
        row.classList.add('audio-row');
        row.dataset.audioId = it.id;
        if(shelfPlayingId === it.id) row.classList.add('playing');
        row.innerHTML = `<button class="inline-play">${shelfPlayingId===it.id && shelfAudioEl && !shelfAudioEl.paused ? '&#10074;&#10074;' : '&#9658;'}</button>
          ${it.cover ? `<img class="cover-thumb" src="${escapeHtml(it.cover)}">` : ''}
          <div class="meta"><div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${TYPE_LABEL[it.type]}</div>
          <div class="inline-bar"><div class="inline-bar-fill"></div></div>
          <div class="inline-time"></div></div>
          <button class="expand" title="Open full player">&#8599;</button>
          <button class="edit" title="Rename or recategorize">&#9998;</button>
          <button class="del" title="Remove">&times;</button>`;
        row.querySelector('.inline-play').onclick = (e)=>{ e.stopPropagation(); toggleShelfPlay(it.id); };
        row.querySelector('.expand').onclick = (e)=>{ e.stopPropagation(); openReader(it.id); };
        row.onclick = ()=>toggleShelfPlay(it.id);
      } else {
        row.onclick = ()=>openReader(it.id);
        row.innerHTML = `${it.cover ? `<img class="cover-thumb" src="${escapeHtml(it.cover)}">` : ''}
          <div class="meta"><div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${TYPE_LABEL[it.type]}${it.progress ? ' \u00b7 in progress' : ''}</div></div>
          <button class="edit" title="Rename or recategorize">&#9998;</button>
          <button class="del" title="Remove">&times;</button>`;
      }
      row.querySelector('.edit').onclick = (e)=>{ e.stopPropagation(); openEdit(it.id); };
      row.querySelector('.del').onclick = (e)=>{ e.stopPropagation(); removeItem(it.id); };
      body.appendChild(row);
    }
    shelf.appendChild(body);
  }
  if(shelfPlayingId) refreshShelfAudioRowUI();
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function isValidCoverDataUrl(s){
  return typeof s === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s);
}

// ---- Delete with a brief undo window ----
// Deletion is real and immediate (no confirm() dialog) — the raw encrypted
// record is kept in memory for a few seconds so Undo can restore it via
// putRaw(). Only one undo slot: starting a new delete while a previous one
// is still undoable lets that earlier one's grace period lapse right away
// (it's already permanently gone either way, so nothing is lost by that).
let lastDeleted = null; // { id, rec, timeoutId }
async function removeItem(id){
  const rec = await getOneRaw(id);
  if(!rec) return;
  await del(id);
  if(lastDeleted) clearTimeout(lastDeleted.timeoutId);
  const timeoutId = setTimeout(()=>{ lastDeleted = null; hideUndoToast(); }, 6000);
  lastDeleted = { id, rec, timeoutId };
  render();
  showUndoToast();
}
function showUndoToast(){
  document.getElementById('undoToast').classList.add('show');
}
function hideUndoToast(){
  document.getElementById('undoToast').classList.remove('show');
}
async function undoDelete(){
  if(!lastDeleted) return;
  clearTimeout(lastDeleted.timeoutId);
  const { rec } = lastDeleted;
  lastDeleted = null;
  hideUndoToast();
  try{ await putRaw(rec); }
  catch(err){ alert("Couldn't bring that back — please try again."); return; }
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
  editCoverDataUrl = undefined; // unchanged, unless the user picks/removes one below
  const coverField = document.getElementById('coverFieldEdit');
  const preview = document.getElementById('coverPreviewEdit');
  const removeBtn = document.getElementById('coverRemoveBtnEdit');
  if(it.type === 'image'){
    coverField.style.display = 'none';
  } else {
    coverField.style.display = 'block';
    if(it.cover){ preview.src = it.cover; preview.style.display = 'block'; removeBtn.style.display = 'block'; }
    else { preview.src = ''; preview.style.display = 'none'; removeBtn.style.display = 'none'; }
  }
  document.getElementById('editOverlay').style.display = 'flex';
}
function closeEdit(){ document.getElementById('editOverlay').style.display = 'none'; editId = null; }
async function saveEdit(){
  if(!editId) return;
  const title = document.getElementById('etitle').value.trim();
  const category = document.getElementById('ecat').value.trim() || 'Uncategorized';
  const updates = { ...(title && {title}), category };
  if(editCoverDataUrl !== undefined) updates.cover = editCoverDataUrl; // string (new) or null (removed)
  try{
    await putMetaOnly(editId, updates);
  }catch(err){
    alert(isQuotaError(err) ? "Your device's storage is full, so this couldn't be saved." : "Couldn't save these changes — please try again.");
    return;
  }
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
  c.className = ''; c.innerHTML = ''; c.style.display = ''; c.style.flexDirection = '';
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }

  if(it.type === 'pdf'){
    c.classList.add('pad0');
    curBlobUrl = URL.createObjectURL(it.content);
    if(it.cover){
      // The iframe normally fills #rcontent via CSS height:100%; with a
      // cover banner above it that no longer leaves room, so switch this
      // one case to a flex column and let the iframe take what's left.
      c.style.display = 'flex'; c.style.flexDirection = 'column';
      c.innerHTML = `<img class="reader-cover" src="${escapeHtml(it.cover)}"><iframe class="pdf" style="flex:1;min-height:0;" src="${curBlobUrl}"></iframe>`;
    } else {
      c.innerHTML = `<iframe class="pdf" src="${curBlobUrl}"></iframe>`;
    }
  } else if(it.type === 'image'){
    curBlobUrl = URL.createObjectURL(it.content);
    c.innerHTML = `<img class="full" src="${curBlobUrl}">`;
  } else if(it.type === 'markdown'){
    curNoteRaw = it.content;
    if(it.cover){
      const coverImg = document.createElement('img');
      coverImg.className = 'reader-cover';
      coverImg.src = it.cover;
      c.appendChild(coverImg);
    }
    const div = document.createElement('div');
    div.className = 'mdbody';
    div.id = 'mdView';
    div.innerHTML = renderMarkdown(it.content);
    wireInlineAudio(div);
    wireTaskCheckboxes(div);
    const editWrap = document.createElement('div');
    editWrap.id = 'mdEditWrap';
    editWrap.innerHTML = `<textarea class="mdedit" id="mdEditArea" spellcheck="false"></textarea>
      <div class="ebar"><button class="cancel" onclick="cancelEditNote()">Cancel</button>
      <button class="cancel" onclick="openAudioLinkPicker()">&#127925; Audio</button>
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
    // Reuses the SAME shared player as the shelf list and note-embedded
    // shelf:// links — not a separate <audio> element — so there's only
    // ever one "now playing" state, and this view, the shelf rows, and the
    // mini-player all agree. Opening this view for a track that isn't
    // already loaded loads it paused (autoplay:false) so just looking at
    // the full player doesn't itself start playback.
    if(shelfPlayingId !== id) await playShelfTrack(id, {autoplay:false});
    const aud = shelfAudioEl;
    aud.playbackRate = audioSpeed;
    const pct = aud.duration ? (aud.currentTime/aud.duration)*100 : 0;
    c.innerHTML = `
      <div class="avwrap">
        ${it.cover ? `<img class="disc-cover" src="${escapeHtml(it.cover)}">` : `<div class="disc">&#9835;</div>`}
        <div class="actrl">
          <button class="skip" onclick="skip(-10)">&#8634;10</button>
          <button class="play" id="playBtn" onclick="toggleShelfPlay('${id}')">${!aud.paused ? '&#10074;&#10074;' : '&#9658;'}</button>
          <button class="skip" onclick="skip(10)">10&#8635;</button>
        </div>
        <input type="range" class="scrub" id="scrub" min="0" max="100" value="${pct}">
        <div class="time" id="atime">${fmtTime(aud.currentTime)} / ${fmtTime(aud.duration||0)}</div>
        <button class="speedBtn" id="speedBtn" onclick="cycleSpeed()">${audioSpeed}x</button>
      </div>`;
    document.getElementById('scrub').oninput = (e)=>{ aud.currentTime = (e.target.value/100)*(aud.duration||0); };
  }
  document.getElementById('reader').classList.add('open');
  updateMiniPlayer(); // may need to hide now that the reader is showing this track
}
function skip(s){ const a = shelfAudioEl; if(!a) return; a.currentTime = Math.max(0, Math.min((a.duration||0), a.currentTime+s)); }
// Sticks for the rest of this session (not saved across app restarts) —
// picking a speed once and having it apply to the next recording you open
// matches how podcast/audiobook apps behave.
const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];
let audioSpeed = 1;
function cycleSpeed(){
  const i = SPEED_STEPS.indexOf(audioSpeed);
  audioSpeed = SPEED_STEPS[(i + 1) % SPEED_STEPS.length];
  if(shelfAudioEl) shelfAudioEl.playbackRate = audioSpeed;
  const btn = document.getElementById('speedBtn');
  if(btn) btn.textContent = audioSpeed + 'x';
}
function fmtTime(t){ t=Math.floor(t); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); }

async function saveProgress(p){
  if(!curId) return;
  try{ await putMetaOnly(curId, { progress: p }); }
  catch(err){ /* autosave — fail silently */ }
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
  try{
    await putContentOnly(curId, 'markdown', text);
  }catch(err){
    alert(isQuotaError(err) ? "Your device's storage is full, so this couldn't be saved. Your edits are still in the text box — free up space and try Save again." : "Couldn't save this note — please try again.");
    return;
  }
  curNoteRaw = text;
  document.getElementById('mdView').innerHTML = renderMarkdown(text);
  wireInlineAudio(document.getElementById('mdView'));
  wireTaskCheckboxes(document.getElementById('mdView'));
  const it = await getOne(curId);
  updateBookmarkUI(it.bookmarks || []);
  cancelEditNote();
}

// Wires up the play button on every shelf://<id> inline audio widget inside
// a just-rendered note (renderMarkdown only produces markup — it can't
// attach handlers, since it runs before the HTML exists in the DOM).
function wireInlineAudio(container){
  container.querySelectorAll('.md-audio-inline').forEach(el=>{
    const id = el.dataset.audioId;
    const btn = el.querySelector('.inline-play');
    if(btn) btn.onclick = (e)=>{ e.stopPropagation(); toggleShelfPlay(id); };
    const expandBtn = el.querySelector('.expand');
    if(expandBtn) expandBtn.onclick = (e)=>{ e.stopPropagation(); openReader(id); };
  });
  if(shelfPlayingId) refreshShelfAudioRowUI();
}

// ---- Linking a note to an audio item already on the shelf ----
// Inserts a `[Title](shelf://<id>)` link at the note editor's cursor; render
// turns that into an inline player rather than a plain outgoing link.
let mdAudioLinkCursor = null;
async function openAudioLinkPicker(){
  const ta = document.getElementById('mdEditArea');
  mdAudioLinkCursor = { start: ta.selectionStart, end: ta.selectionEnd };
  const items = (await getAll()).filter(it=>it.type==='audio');
  const list = document.getElementById('audioLinkList');
  if(!items.length){
    list.innerHTML = `<div class="alink-empty">No recordings on your shelf yet — add one first, then come back here to link it into this note.</div>`;
  } else {
    items.sort((a,b)=>(a.category||'').localeCompare(b.category||'') || a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
    list.innerHTML = items.map(it=>`
      <button class="alink-row" data-id="${escapeHtml(it.id)}" data-title="${escapeHtml(it.title)}">
        <span class="alink-title">${escapeHtml(it.title)}</span>
        <span class="alink-cat">${escapeHtml(it.category || 'Uncategorized')}</span>
      </button>`).join('');
    list.querySelectorAll('.alink-row').forEach(btn=>{
      btn.onclick = ()=>insertAudioLink(btn.dataset.id, btn.dataset.title);
    });
  }
  document.getElementById('audioLinkOverlay').style.display = 'flex';
}
function closeAudioLinkPicker(){
  document.getElementById('audioLinkOverlay').style.display = 'none';
}
function insertAudioLink(id, title){
  const ta = document.getElementById('mdEditArea');
  // Square brackets in the title would break the [label] part of the link
  // syntax — strip them from the inserted label only, the stored item title
  // itself is untouched.
  const safeLabel = title.replace(/[[\]]/g,'');
  const markdown = `[${safeLabel}](shelf://${id})`;
  const { start, end } = mdAudioLinkCursor || { start: ta.value.length, end: ta.value.length };
  ta.value = ta.value.slice(0, start) + markdown + ta.value.slice(end);
  closeAudioLinkPicker();
  ta.focus();
  const newPos = start + markdown.length;
  ta.setSelectionRange(newPos, newPos);
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
  try{ await putMetaOnly(curId, { bookmarks }); }
  catch(err){ if(isQuotaError(err)) alert("Your device's storage is full, so this bookmark couldn't be saved."); return; }
  updateBookmarkUI(bookmarks);
}
async function deleteBookmark(idx){
  const it = await getOne(curId);
  if(!it) return;
  const bookmarks = (it.bookmarks||[]).filter(b=>b.idx!==idx);
  try{ await putMetaOnly(curId, { bookmarks }); }
  catch(err){ /* removing a bookmark frees space, extremely unlikely to fail on quota */ }
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
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }
  curId = null; curType = null;
  updateMiniPlayer(); // the mini bar may need to reappear now that the reader isn't showing this track
  render();
}

// minimal markdown renderer
function renderMarkdown(src){
  let s = escapeHtml(src);
  s = s.replace(/```([\s\S]*?)```/g, (_,c)=>`<pre><code>${c.trim()}</code></pre>`);
  s = s.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  s = s.replace(/`([^`]+)`/g,'<code>$1</code>');
  // Two special link targets get their own inline widget instead of a plain
  // <a>: an audio-file URL plays via a native <audio> element (fetches live
  // over the network — the one place in Shelfmark that does); a shelf://<id>
  // link points at an audio item already stored on this shelf and reuses
  // the same on-shelf player/decrypt-on-play code path as the shelf list
  // (wireInlineAudio() attaches its click handler once this HTML is in the
  // DOM — see openReader/saveEditNote).
  const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|weba)(\?.*)?$/i;
  const SHELF_LINK = /^shelf:\/\/(.+)$/;
  s = s.replace(/\[(.+?)\]\((.+?)\)/g,(_,label,url)=>{
    const trimmedUrl = url.trim();
    const shelfMatch = trimmedUrl.match(SHELF_LINK);
    if(shelfMatch){
      const id = shelfMatch[1];
      return `<div class="md-audio-inline" data-audio-id="${id}">`
           + `<button class="inline-play">&#9658;</button>`
           + `<div class="meta"><div class="title">${label}</div>`
           + `<div class="inline-bar"><div class="inline-bar-fill"></div></div>`
           + `<div class="inline-time"></div></div>`
           + `<button class="expand" title="Open full player">&#8599;</button></div>`;
    }
    if(AUDIO_EXT.test(trimmedUrl)){
      return `<div class="md-audio"><div class="md-audio-label">${label}</div>`
           + `<audio controls preload="none" src="${trimmedUrl}"></audio></div>`;
    }
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  });
  return s.split(/\n{2,}/).map((block,idx)=>{
    let html;
    if(/^<h[123]|^<pre/.test(block)) html = block;
    else if(/^<div class="md-audio/.test(block)) html = block;
    else if(/^\s*&gt;/.test(block) && block.split('\n').every(l=>!l.trim() || /^\s*&gt;/.test(l))){
      const inner = block.split('\n').filter(l=>l.trim()).map(l=>l.replace(/^\s*&gt;\s?/,'')).join('<br>');
      html = `<blockquote>${inner}</blockquote>`;
    }
    else if(/^\s*\d+\.\s+/.test(block)){
      const items = block.split('\n').filter(l=>l.trim()).map(l=>`<li>${l.replace(/^\s*\d+\.\s+/,'')}</li>`).join('');
      html = `<ol>${items}</ol>`;
    }
    else if(/^\s*[-*]\s+/m.test(block)){
      // A checklist ("- [ ] text" / "- [x] text") is a plain unordered list
      // with a checkbox per line. data-block-idx/data-line-idx address the
      // exact raw-source line to flip on click (toggleTaskCheckbox below) —
      // line indices come from the UNFILTERED split so they still line up
      // with curNoteRaw.split(/\n{2,}/)[blockIdx].split('\n')[lineIdx].
      const lines = block.split('\n');
      let isTaskList = false;
      const items = lines.map((l,li)=>{
        if(!l.trim()) return '';
        const stripped = l.replace(/^\s*[-*]\s+/,'');
        const taskMatch = stripped.match(/^\[( |x|X)\]\s*(.*)$/);
        if(taskMatch){
          isTaskList = true;
          const checked = /x/i.test(taskMatch[1]);
          return `<li class="task-item"><label><input type="checkbox" data-block-idx="${idx}" data-line-idx="${li}"${checked ? ' checked' : ''}><span${checked ? ' class="done"' : ''}>${taskMatch[2]}</span></label></li>`;
        }
        return `<li>${stripped}</li>`;
      }).join('');
      html = `<ul${isTaskList ? ' class="task-list"' : ''}>${items}</ul>`;
    } else html = `<p>${block.replace(/\n/g,'<br>')}</p>`;
    return `<div class="mdblock" data-idx="${idx}"><button class="bm-btn" onclick="toggleBookmark(${idx})" title="Bookmark this spot">&#128278;</button>${html}</div>`;
  }).join('\n');
}

// A tap on a checklist checkbox re-splits curNoteRaw the same way
// renderMarkdown did (by blank-line blocks, then by line) to find the exact
// source line, flips its [ ]/[x], and saves — rather than trying to map
// back through the rendered HTML, which renderMarkdown has already
// transformed away from the raw source. This does mean multiple blank
// lines between blocks collapse to exactly one blank line on save, since
// the block separator isn't preserved once split.
async function toggleTaskCheckbox(blockIdx, lineIdx){
  if(!curId || curNoteRaw == null) return;
  const blocks = curNoteRaw.split(/\n{2,}/);
  if(blocks[blockIdx] == null) return;
  const lines = blocks[blockIdx].split('\n');
  const line = lines[lineIdx];
  if(line == null) return;
  const m = line.match(/^(\s*[-*]\s+\[)( |x|X)(\].*)$/);
  if(!m) return;
  lines[lineIdx] = m[1] + (m[2].trim() === '' ? 'x' : ' ') + m[3];
  blocks[blockIdx] = lines.join('\n');
  const newText = blocks.join('\n\n');
  try{ await putContentOnly(curId, 'markdown', newText); }
  catch(err){ alert("Couldn't save that change — please try again."); return; }
  curNoteRaw = newText;
  const mdView = document.getElementById('mdView');
  if(mdView){
    mdView.innerHTML = renderMarkdown(newText);
    wireInlineAudio(mdView);
    wireTaskCheckboxes(mdView);
  }
}
function wireTaskCheckboxes(container){
  container.querySelectorAll('input[type=checkbox][data-block-idx]').forEach(cb=>{
    cb.onclick = (e)=>{
      e.stopPropagation();
      toggleTaskCheckbox(Number(cb.dataset.blockIdx), Number(cb.dataset.lineIdx));
    };
  });
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
