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
const APP_VERSION = '1.51.0';
const APP_VERSION_DATE = '2026-09-28';

document.getElementById('versionBadge').textContent = 'v' + APP_VERSION + ' · ' + APP_VERSION_DATE;

// pdf.js — vendored locally under lib/ (no CDN dependency, same approach as
// the companion Family Health & Shield and Ledger apps). pdfjs-dist 4.x+
// only ships ES module builds, so it's loaded via dynamic import() rather
// than a <script> tag. Awaiting this promise at the point of use
// (renderPdfPage()) means it doesn't matter whether this script or the
// module finishes loading first. Worker vendored at lib/pdf.worker.min.mjs —
// must stay in lockstep with lib/pdf.min.mjs's package/version.
const pdfjsLibPromise = import('./lib/pdf.min.mjs').then(mod => {
  mod.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.mjs';
  return mod;
});

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

// Two storage modes, recorded in the 'auth' record:
//   'passcode' (default; older records have no `mode` field and are this) —
//       key = PBKDF2(passcode), only ever held in memory.
//   'device'   (v1.47.0, "no passcode") — a random non-extractable AES-256 key
//       is generated once and kept in IndexedDB next to the data, so the app
//       opens straight to the shelf. Everything is still AES-GCM encrypted at
//       rest, but anyone who can open this browser profile can open the shelf.
let authMode = 'passcode';
async function buildPasscodeAuth(passcode){
  const salt = randomBytes(16);
  const key = await deriveKey(passcode, salt, PBKDF2_ITERATIONS);
  const { iv, cipher } = await aesEncrypt(key, new TextEncoder().encode('shelfmark-ok'));
  return { key, rec:{ id:'auth', mode:'passcode', salt: buf2b64(salt), iterations: PBKDF2_ITERATIONS, verifierIv: buf2b64(iv), verifierCipher: buf2b64(cipher) } };
}
async function createPasscode(passcode){
  const { key, rec } = await buildPasscodeAuth(passcode);
  await putAuth(rec);
  cryptoKey = key;
  authMode = 'passcode';
}
async function buildDeviceAuth(){
  const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  return { key, rec:{ id:'auth', mode:'device', key } };
}
async function createDeviceKeyMode(){
  const { key, rec } = await buildDeviceAuth();
  await putAuth(rec); // rejects if this browser can't store a CryptoKey
  cryptoKey = key;
  authMode = 'device';
}
async function verifyPasscode(passcode){
  const auth = await getAuth();
  if(!auth || auth.mode === 'device') return false;
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
  const skipBtn = document.getElementById('lockSkipBtn');
  if(skipBtn) skipBtn.style.display = auth ? 'none' : 'inline-block';
  if(auth && auth.mode === 'device'){
    if(auth.key){
      cryptoKey = auth.key;
      authMode = 'device';
      await unlockApp();
      return;
    }
    // Device-key mode but the browser handed back no key (storage partly
    // cleared, or an old browser) — nothing can be decrypted, so say so.
    document.getElementById('lockTitle').textContent = 'Device key unavailable';
    document.getElementById('lockSub').textContent = 'This shelf was saved without a passcode, but this browser no longer has its key, so it can\'t be opened. You can erase it below and start over, or restore from an encrypted export.';
    document.getElementById('passcodeInput').style.display = 'none';
    confirmInput.style.display = 'none';
    document.getElementById('lockBtn').style.display = 'none';
    document.querySelector('.lock-reset').textContent = 'Erase this shelf';
    return;
  }
  if(!auth){
    document.getElementById('lockTitle').textContent = 'Set a passcode';
    document.getElementById('lockSub').textContent = 'This encrypts everything you add to your shelf. There is no recovery — write it down somewhere safe. Prefer no lock? You can skip it below and change your mind any time (press Ctrl+K, then search "passcode").';
    confirmInput.style.display = 'block';
  } else {
    document.getElementById('lockTitle').textContent = 'Shelfmark is locked';
    document.getElementById('lockSub').textContent = 'Enter your passcode to open your shelf.';
    confirmInput.style.display = 'none';
  }
  document.getElementById('passcodeInput').focus();
}
async function onSkipPasscode(){
  const errEl = document.getElementById('lockError');
  errEl.textContent = '';
  if(!confirm('Use Shelfmark without a passcode?\n\nYour shelf will open straight away, with no lock screen. It is still stored encrypted, but anyone who can open this browser on this device can read it. You can set a passcode later from the command palette (Ctrl+K).')) return;
  try{
    await createDeviceKeyMode();
  }catch(err){
    errEl.textContent = "This browser can't store a device key — please set a passcode instead.";
    return;
  }
  await unlockApp();
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
// Erase from inside the app (v1.48.2). In no-passcode mode there is no lock
// screen, so the lock screen's "Forgot passcode? Erase" link is never shown —
// this is the way to start over from the command palette / Passcode panel.
// Two steps (confirm + typing ERASE) because, unlike the lock-screen link, it
// is reachable while the shelf is open and there is no undo.
function eraseShelfFromApp(){
  if(!confirm('Erase this shelf?\n\nEvery item on this device will be permanently deleted, and Shelfmark will go back to its first-run setup. There is no undo. Export an encrypted backup first if you might want anything back.')) return;
  const typed = prompt('To confirm, type ERASE (capital letters):');
  if(typed === null) return;
  if(typed.trim() !== 'ERASE'){ alert('Not erased — you didn\'t type ERASE.'); return; }
  wipeAllData();
}
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
  restoreShelfViewPrefs();
  await ensureShelfId();
  render();
  // Best-effort: ask the browser to protect this origin's storage from
  // automatic eviction under disk pressure. Silent either way — some
  // browsers auto-grant based on site engagement, some prompt, some just
  // say no; none of that should block or interrupt using the app.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(()=>{});
  }
}


// ---- Switching between passcode and no-passcode (v1.47.0) -------------------
// Every item, draft and the prefs record are encrypted with the current key, so
// changing mode means decrypting each with the old key and re-encrypting with
// the new one. All new ciphertext is built in memory first and then written in
// ONE IndexedDB transaction together with the new auth record — so if anything
// fails (wrong data, out of memory, quota) nothing on disk has changed, and the
// old passcode/key keeps working.
function getAllRawStrict(){
  return new Promise((res,rej)=>{ const r = tx('readonly').getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
}
async function reencryptEverything(newKey, newAuthRec, onProgress){
  const oldKey = cryptoKey;
  return serialized(async ()=>{
    const raws = await getAllRawStrict();
    const prefsRec = await new Promise((res,rej)=>{ const r = txS('readonly').get('prefs'); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
    const BLOBS = [['metaIv','metaCipher'],['contentIv','contentCipher'],['draftIv','draftCipher']];
    const out = [];
    for(let i=0;i<raws.length;i++){
      const rec = raws[i];
      const n = { ...rec };
      for(const [ivF, ciF] of BLOBS){
        if(!rec[ciF]) continue;
        const plain = await aesDecrypt(oldKey, rec[ivF], rec[ciF]);
        const enc = await aesEncrypt(newKey, plain);
        n[ivF] = enc.iv; n[ciF] = enc.cipher;
      }
      out.push(n);
      raws[i] = null; // let the old ciphertext be collected as we go
      if(onProgress) onProgress(i+1, out.length + (raws.length - i - 1));
    }
    let newPrefs = null;
    if(prefsRec){
      const plain = await aesDecrypt(oldKey, prefsRec.iv, prefsRec.cipher);
      const enc = await aesEncrypt(newKey, plain);
      newPrefs = { id:'prefs', iv: enc.iv, cipher: enc.cipher };
    }
    await new Promise((res,rej)=>{
      const t = db.transaction(['items','settings','security'],'readwrite');
      const items = t.objectStore('items');
      out.forEach(r=>items.put(r));
      if(newPrefs) t.objectStore('settings').put(newPrefs);
      t.objectStore('security').put(newAuthRec);
      t.oncomplete = ()=>res();
      t.onerror = ()=>rej(t.error);
      t.onabort = ()=>rej(t.error || new Error('Write was aborted'));
    });
    cryptoKey = newKey;
  });
}

// ---- Passcode & lock info panel (v1.47.1) -----------------------------------
// In-app explanation of the two storage modes so people can find out the lock
// is optional without reading the README. Reached from the command palette
// ("Passcode & lock: info and settings"); shows the CURRENT mode and offers
// the same switch actions as the palette's "Set/Remove passcode…" entries.
function openSecInfo(){
  const isDevice = authMode === 'device';
  document.getElementById('secInfoStatus').innerHTML = isDevice
    ? '<strong>Current mode: no passcode.</strong> Shelfmark opens straight to your shelf.'
    : '<strong>Current mode: passcode.</strong> Shelfmark asks for your passcode each time you open it.';
  const btn = document.getElementById('secInfoActionBtn');
  btn.textContent = isDevice ? 'Set a passcode\u2026' : 'Remove passcode\u2026';
  btn.onclick = ()=>{ closeSecInfo(); openAuthModal(isDevice ? 'set' : 'remove'); };
  document.getElementById('secInfoOverlay').style.display = 'flex';
}
function closeSecInfo(){ document.getElementById('secInfoOverlay').style.display = 'none'; }

// ---- App guide panel (v1.48.1) ----------------------------------------------
// One in-app place that explains the newer features so people don't have to
// find them in the README: Ctrl+K, the category index, the optional passcode.
// Reached from the command palette ("App guide: index, passcode & tips").
function openGuide(){ document.getElementById('guideOverlay').style.display = 'flex'; }
function closeGuide(){ document.getElementById('guideOverlay').style.display = 'none'; }

let authModalMode = null; // 'set' (device -> passcode) | 'remove' (passcode -> device)
function openAuthModal(mode){
  authModalMode = mode;
  const isSet = mode === 'set';
  document.getElementById('authTitle').textContent = isSet ? 'Set a passcode' : 'Remove passcode';
  document.getElementById('authNote').textContent = isSet
    ? 'Everything on your shelf will be re-encrypted with a key made from this passcode, and the lock screen will appear every time you open Shelfmark. There is no recovery — write it down somewhere safe.'
    : 'Your shelf will open without a lock screen. It stays encrypted on disk, but anyone who can open this browser on this device will be able to read it. Enter your current passcode to confirm.';
  document.getElementById('authPass1').placeholder = isSet ? 'New passcode' : 'Current passcode';
  document.getElementById('authPass2').style.display = isSet ? 'block' : 'none';
  document.getElementById('authPass1').value = '';
  document.getElementById('authPass2').value = '';
  document.getElementById('authError').textContent = '';
  document.getElementById('authGoBtn').textContent = isSet ? 'Set passcode' : 'Remove passcode';
  document.getElementById('authOverlay').style.display = 'flex';
  setTimeout(()=>document.getElementById('authPass1').focus(), 0);
}
function closeAuthModal(){ document.getElementById('authOverlay').style.display = 'none'; authModalMode = null; }
async function doAuthChange(){
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  const p1 = document.getElementById('authPass1').value;
  const p2 = document.getElementById('authPass2').value;
  let newKey, newRec;
  try{
    if(authModalMode === 'set'){
      if(p1.length < 4){ errEl.textContent = 'Use at least 4 characters.'; return; }
      if(p1 !== p2){ errEl.textContent = "Passcodes don't match."; return; }
      const b = await buildPasscodeAuth(p1); newKey = b.key; newRec = b.rec;
    } else if(authModalMode === 'remove'){
      if(!(await verifyPasscode(p1))){ errEl.textContent = 'Incorrect passcode.'; return; }
      const b = await buildDeviceAuth(); newKey = b.key; newRec = b.rec;
    } else return;
  }catch(err){ errEl.textContent = 'Something went wrong: ' + (err && err.message || err); return; }

  const targetMode = authModalMode === 'set' ? 'passcode' : 'device';
  const busy = document.getElementById('busyOverlay');
  const busyText = document.getElementById('busyText');
  busyText.textContent = 'Re-encrypting your shelf\u2026';
  busy.style.display = 'flex';
  try{
    await reencryptEverything(newKey, newRec, (done,total)=>{ busyText.textContent = 'Re-encrypting your shelf\u2026 ' + done + ' / ' + total; });
    authMode = targetMode;
    busy.style.display = 'none';
    closeAuthModal();
    alert(targetMode === 'passcode' ? 'Passcode set. You\'ll be asked for it next time you open Shelfmark.' : 'Passcode removed. Shelfmark will now open straight to your shelf.');
  }catch(err){
    busy.style.display = 'none';
    const quota = err && (err.name === 'QuotaExceededError');
    errEl.textContent = (quota ? 'Not enough storage space to re-encrypt. ' : 'Could not re-encrypt: ' + (err && err.message || err) + '. ') + 'Nothing was changed — your current setup still works.';
  }
}

// ---- IndexedDB --------------------------------------------------------------
const TYPE_COLOR = {pdf:'var(--pdf)', markdown:'var(--md)', image:'var(--img)', audio:'var(--audio)'};
const TYPE_LABEL = {pdf:'PDF', markdown:'Note', image:'Picture', audio:'Recording'};
let db, pendingFile = null, pendingType = null, pendingBlankNote = false;
let curId = null, curBlobUrl = null, curType = null, curNoteRaw = null;
// Maps this edit session's `img:N` placeholders (what actually shows in the
// textarea) back to the real `data:image/...;base64,...` URI each one
// stands in for. Rebuilt every time the editor opens (collapseImagesForEdit)
// and consumed once, on Save (expandImagesForSave) — the stored note content
// itself is untouched: it's still one plain markdown string with the real
// data URIs inline, exactly as before. Only the on-screen textarea is
// decluttered, so export/import/rendering all stay the same format.
let curNoteImageRefs = [];
// Same trick for audio dropped into a note (v1.46.1): the recording lives in
// the note as `[name](data:audio/...;base64,...)`, the textarea only shows
// `[name](aud:N)`.
let curNoteAudioRefs = [];
function collapseImagesForEdit(text){
  curNoteImageRefs = [];
  curNoteAudioRefs = [];
  return text.replace(/!\[(.*?)\]\((data:[^)]+)\)/g, (_, alt, dataUri)=>{
    curNoteImageRefs.push(dataUri);
    return `![${alt || 'image ' + curNoteImageRefs.length}](img:${curNoteImageRefs.length})`;
  }).replace(/(^|[^!])\[([^\]\n]*)\]\((data:audio\/[^)]+)\)/g, (_, pre, label, dataUri)=>{
    curNoteAudioRefs.push(dataUri);
    return `${pre}[${label || 'audio ' + curNoteAudioRefs.length}](aud:${curNoteAudioRefs.length})`;
  });
}
function expandImagesForSave(text){
  return text.replace(/!\[(.*?)\]\(img:(\d+)\)/g, (whole, alt, n)=>{
    const dataUri = curNoteImageRefs[Number(n) - 1];
    // If the placeholder's number doesn't match anything (typed by hand, or
    // its image was never actually inserted this session), leave the text
    // exactly as written rather than guessing.
    return dataUri ? `![${alt}](${dataUri})` : whole;
  }).replace(/(^|[^!])\[([^\]\n]*)\]\(aud:(\d+)\)/g, (whole, pre, label, n)=>{
    const dataUri = curNoteAudioRefs[Number(n) - 1];
    return dataUri ? `${pre}[${label}](${dataUri})` : whole;
  });
}

// ---- PDF reader (page-by-page canvas render via pdf.js) ----
// curPdfDoc is the live pdf.js document for whatever's open in the reader;
// curPdfPage/curPdfNumPages track where we are. curPdfRenderToken guards
// against a slow render from a page the reader already navigated away from
// (or already closed) landing on the canvas after the fact — each call to
// renderPdfPage() takes the current token, and only applies its result if
// the token is still current when the async render finishes.
let curPdfDoc = null, curPdfPage = 1, curPdfNumPages = 0, curPdfRenderToken = 0;
// Fit-width vs fixed-zoom for the PDF page render. 'fit' scales to the
// container width (the original behavior); a number is a multiplier on TOP
// of that fit scale, so zooming still adapts to whatever width the reader
// happens to have. Resets to 'fit' every time a (possibly different) PDF is
// opened; not persisted — same lifetime as curPdfPage etc.
let pdfZoomMode = 'fit';

// ---- Inline shelf audio player ----
// Audio items play directly from the shelf row (tap to play/pause, inline
// progress bar) instead of opening the full-page reader. One shared <audio>
// element is reused across tracks; the file is only decrypted when actually
// played, not eagerly for every audio row.
let shelfAudioEl = null, shelfPlayingId = null, shelfPlayingTitle = null, shelfPlayingCategory = null, shelfAudioBlobUrl = null;
// Which category headers are collapsed. Since v1.51.0 this is remembered:
// the live Set is mirrored into the encrypted prefs record as
// prefs.collapsedCats (an array of category names) every time a header is
// toggled, and reloaded at unlock (restoreShelfViewPrefs). Default is
// all-expanded on a fresh shelf.
const collapsedCats = new Set();
// Sort order for items within each category: 'newest' (added-date desc,
// the original behavior) or 'title' (alphabetical). Also remembered since
// v1.51.0, as prefs.itemSortMode.
let itemSortMode = 'newest';
function syncSortBtn(){
  const btn = document.getElementById('sortBtn');
  if(!btn) return;
  btn.textContent = itemSortMode === 'newest' ? 'Newest' : 'A\u2013Z';
  btn.title = itemSortMode === 'newest'
    ? 'Sorting items by newest added \u2014 tap for A\u2013Z'
    : 'Sorting items A\u2013Z \u2014 tap for newest added';
}
function toggleSortMode(){
  itemSortMode = itemSortMode === 'newest' ? 'title' : 'newest';
  syncSortBtn();
  prefs.itemSortMode = itemSortMode;
  putPrefs(prefs).catch(()=>{});
  render();
}
// Called once at unlock, after the saved prefs are merged in.
function restoreShelfViewPrefs(){
  itemSortMode = prefs.itemSortMode === 'title' ? 'title' : 'newest';
  collapsedCats.clear();
  if(Array.isArray(prefs.collapsedCats)){
    for(const c of prefs.collapsedCats) if(typeof c === 'string') collapsedCats.add(c);
  }
  syncSortBtn();
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
  if(!shelfPlayingId || readerShowingThisTrack || selectMode){
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
  return serialized(async ()=>{
    const rec = await getOneRaw(id);
    if(!rec) return;
    const meta = await decryptJSON(cryptoKey, rec.metaIv, rec.metaCipher);
    Object.assign(meta, metaUpdates);
    const { iv, cipher } = await encryptJSON(cryptoKey, meta);
    rec.metaIv = iv; rec.metaCipher = cipher;
    await putRaw(rec);
  });
}
// Content-only update (editing a note's text)
async function putContentOnly(id, type, contentValue){
  return serialized(async ()=>{
    const rec = await getOneRaw(id);
    if(!rec) return;
    const bytes = type === 'markdown' ? new TextEncoder().encode(contentValue) : await contentValue.arrayBuffer();
    const { iv, cipher } = await aesEncrypt(cryptoKey, bytes);
    rec.contentIv = iv; rec.contentCipher = cipher;
    // Linked note (v1.50.0): write the file on disk FIRST; if that fails, throw
    // so the caller keeps the editor open and nothing diverges.
    let meta = null;
    if(type === 'markdown'){
      meta = await decryptJSON(cryptoKey, rec.metaIv, rec.metaCipher);
      if(meta.extPath){
        const mtime = await extWriteFile(meta.extPath, contentValue);
        meta.extMtime = mtime;
        const m = await encryptJSON(cryptoKey, meta);
        rec.metaIv = m.iv; rec.metaCipher = m.cipher;
      }
    }
    await putRaw(rec);
  });
}
// putMetaOnly / putContentOnly / the draft writers below are all
// read-modify-write on the SAME whole record (get it, change one blob, put it
// back), and each has awaits in the middle. Two of them overlapping — an
// autosaved draft landing while Save writes the note, say — would let the
// slower one put back a stale copy of the record and silently undo the
// other's change (a draft write could resurrect the OLD note text over a
// just-saved one). This queue makes them run strictly one after another.
let dbWriteQueue = Promise.resolve();
function serialized(fn){
  const p = dbWriteQueue.then(fn);
  dbWriteQueue = p.catch(()=>{});
  return p;
}
// ---- Note drafts (v1.31.0) ----
// An unsaved edit is kept as a third encrypted blob (draftIv/draftCipher) on
// the SAME record as the note — deliberately not in the content blob (Save and
// Cancel keep their meaning: only Save changes the note) and not in the
// metadata blob (that one is decrypted for every item on every shelf listing;
// a draft with pictures in it can be megabytes). Never exported, dropped with
// the note when it's deleted, and cleared by Save/Cancel.
function putDraft(id, text){
  return serialized(async ()=>{
    const rec = await getOneRaw(id);
    if(!rec) return;
    const { iv, cipher } = await encryptJSON(cryptoKey, { text, savedAt: Date.now() });
    rec.draftIv = iv; rec.draftCipher = cipher;
    await putRaw(rec);
  });
}
async function getDraft(id){
  const rec = await getOneRaw(id);
  if(!rec || !rec.draftCipher) return null;
  try{ return await decryptJSON(cryptoKey, rec.draftIv, rec.draftCipher); }
  catch(err){ return null; }
}
function clearDraft(id){
  return serialized(async ()=>{
    const rec = await getOneRaw(id);
    if(!rec || !rec.draftCipher) return;
    delete rec.draftIv; delete rec.draftCipher;
    await putRaw(rec);
  });
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
  // The "put my name in the file" choice only matters for encrypted files:
  // a plain file is readable anyway, so its header always carries the name.
  document.getElementById('expNameToggleRow').style.display = m==='enc' ? 'block' : 'none';
  document.getElementById('expError').textContent = '';
}
function openExportModal(){
  document.getElementById('exppass').value = '';
  document.getElementById('exppass2').value = '';
  document.getElementById('expError').textContent = '';
  document.getElementById('expShelfName').value = prefs.shelfName || '';
  document.getElementById('expNameInFile').checked = prefs.exportShelfName !== false;
  setExportMode('enc');
  document.getElementById('exportOverlay').style.display = 'flex';
}
function closeExportModal(){ document.getElementById('exportOverlay').style.display = 'none'; }

// ---- Shelf identity (v1.49.0) -----------------------------------------------
// Every shelf has a random `shelfId` (made once, kept in the encrypted prefs)
// and an optional human label `shelfName`. Backups carry both in a plain
// header so a file can be told apart without opening it, and import warns
// before merging a backup that came from a different shelf. The ID is the
// real identity; the name is only for people.
function newShelfId(){ return buf2b64(randomBytes(9)).replace(/\+/g,'-').replace(/\//g,'_'); }
async function ensureShelfId(){
  if(typeof prefs.shelfId === 'string' && prefs.shelfId) return;
  prefs.shelfId = newShelfId();
  try{ await putPrefs(prefs); }catch(e){}
}
function cleanShelfName(n){ return String(n == null ? '' : n).replace(/\s+/g,' ').trim().slice(0,60); }
async function setShelfName(n){
  prefs.shelfName = cleanShelfName(n);
  try{ await putPrefs(prefs); }catch(e){}
}
function renameShelf(){
  const n = prompt('Name this shelf (shown on backups so you can tell them apart).\n\nLeave empty to remove the name.', prefs.shelfName || '');
  if(n === null) return;
  setShelfName(n);
}
// Name as it appears in a file name: letters/digits only (any script), so a
// name like "Ah Meng's shelf" becomes "Ah-Meng-s-shelf".
function shelfNameForFile(n){
  return cleanShelfName(n).replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,40);
}
function backupHeader(itemCount, includeName){
  const h = { app:'shelfmark', appVersion:APP_VERSION, exportedAt:Date.now(), itemCount, shelfId:prefs.shelfId };
  if(includeName && prefs.shelfName) h.shelfName = prefs.shelfName;
  return h;
}
function backupFilename(includeName, ext){
  const day = new Date().toISOString().slice(0,10);
  const nm = includeName ? shelfNameForFile(prefs.shelfName) : '';
  return (nm ? nm+'-shelfmark-' : 'shelfmark-backup-') + day + ext;
}
// What a backup file says about its origin, or null (old files, bare arrays).
function backupIdentity(parsed){
  if(!parsed || Array.isArray(parsed) || typeof parsed.shelfId !== 'string' || !parsed.shelfId) return null;
  const n = Number(parsed.itemCount), t = Number(parsed.exportedAt);
  return {
    id: parsed.shelfId.slice(0,40),
    name: cleanShelfName(parsed.shelfName),
    count: Number.isFinite(n) && n >= 0 ? n : null,
    date: Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0,10) : ''
  };
}
function describeBackupOwner(info){
  const who = info.name ? '\u201c'+info.name+'\u201d' : 'another shelf (ID '+info.id.slice(0,6)+')';
  const bits = [];
  if(info.count != null) bits.push(info.count+' item'+(info.count===1?'':'s'));
  if(info.date) bits.push(info.date);
  return who + (bits.length ? ' ('+bits.join(', ')+')' : '');
}
const NO_OWNER_NOTE = 'This file has no owner information (it was made before v1.49.0), so it can\u2019t be checked against this shelf.';

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
// Shared by both the whole-shelf JSON export (below) and exporting a single
// item's own file (exportCurrentItem, in the reader section) — same
// share-sheet-first-then-anchor-click fallback either way, just handed
// whatever Blob/mime the caller already has.
async function downloadBlob(blob, filename){
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
  const file = new File([blob], filename, {type: blob.type || 'application/octet-stream'});
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
async function downloadJSON(obj, filename){
  await downloadBlob(new Blob([JSON.stringify(obj)], {type:'application/json'}), filename);
}

async function doExport(){
  const errEl = document.getElementById('expError');
  errEl.textContent = '';
  const items = await buildExportItems();
  if(!items.length){ errEl.textContent = 'Your shelf is empty — nothing to export yet.'; return; }

  await ensureShelfId();
  // Save the name/choice typed in the modal so it sticks for next time.
  prefs.shelfName = cleanShelfName(document.getElementById('expShelfName').value);
  if(exportMode === 'enc') prefs.exportShelfName = document.getElementById('expNameInFile').checked;
  putPrefs(prefs).catch(()=>{});
  const includeName = exportMode === 'plain' ? true : prefs.exportShelfName !== false;

  if(exportMode === 'plain'){
    await downloadJSON({...backupHeader(items.length, includeName), encrypted:false, items},
      backupFilename(includeName, '.json'));
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
    ...backupHeader(items.length, includeName), encrypted:true,
    kdf:'PBKDF2', iterations: PBKDF2_ITERATIONS,
    salt: buf2b64(salt), iv: buf2b64(iv), cipher: buf2b64(cipher)
  }, backupFilename(includeName, '.enc.json'));
  closeExportModal();
}

let pendingImportInfo = null;
async function onImportFile(e){
  const f = e.target.files[0];
  e.target.value = '';
  if(!f) return;
  let parsed;
  try{ parsed = JSON.parse(await f.text()); }
  catch(err){ alert("Couldn't read that file — make sure it's a Shelfmark export."); return; }

  const info = backupIdentity(parsed);
  let shelfEmpty = false;
  try{ shelfEmpty = (await getAll()).length === 0; }catch(err){}
  const differs = !!info && info.id !== prefs.shelfId && !shelfEmpty;

  if(parsed && parsed.encrypted === true){
    // Show where it came from BEFORE asking for the passphrase.
    pendingImportBackup = parsed;
    pendingImportInfo = info;
    const sum = document.getElementById('impSummary');
    if(!info){
      sum.textContent = shelfEmpty ? '' : NO_OWNER_NOTE;
      sum.style.color = 'var(--ink-soft)';
    } else if(differs){
      sum.textContent = 'This backup is from '+describeBackupOwner(info)+', not this shelf. Importing will merge its items into this shelf.';
      sum.style.color = '#b23b3b';
    } else {
      sum.textContent = 'This backup is from '+(info.id === prefs.shelfId ? 'this shelf' : describeBackupOwner(info))+(info.id === prefs.shelfId && (info.count != null || info.date) ? ' ('+[info.count != null ? info.count+' item'+(info.count===1?'':'s') : '', info.date].filter(Boolean).join(', ')+')' : '')+'.';
      sum.style.color = 'var(--ink-soft)';
    }
    sum.style.display = sum.textContent ? 'block' : 'none';
    document.getElementById('imppass').value = '';
    document.getElementById('impError').textContent = '';
    document.getElementById('importPassOverlay').style.display = 'flex';
    return;
  }
  if(differs && !confirm('This backup is from '+describeBackupOwner(info)+', not this shelf.\n\nMerge its items into this shelf?')) return;
  await mergeImportedItems(Array.isArray(parsed) ? parsed : (parsed.items || []), info);
}
function closeImportPassModal(){ document.getElementById('importPassOverlay').style.display = 'none'; pendingImportBackup = null; pendingImportInfo = null; }

async function doImportDecrypt(){
  const errEl = document.getElementById('impError');
  errEl.textContent = '';
  const pass = document.getElementById('imppass').value;
  if(!pendingImportBackup) return;
  try{
    const salt = b642buf(pendingImportBackup.salt);
    const key = await deriveKey(pass, salt, pendingImportBackup.iterations || PBKDF2_ITERATIONS);
    const { items } = await decryptJSON(key, b642buf(pendingImportBackup.iv), b642buf(pendingImportBackup.cipher));
    const info = pendingImportInfo;
    document.getElementById('importPassOverlay').style.display = 'none';
    pendingImportBackup = null; pendingImportInfo = null;
    await mergeImportedItems(items || [], info);
  }catch(err){
    errEl.textContent = 'Incorrect passphrase.';
  }
}

async function mergeImportedItems(items, info){
  let added = 0, updated = 0, stoppedOnQuota = false;
  try{
    const existingItems = await getAll();
    const wasEmpty = existingItems.length === 0;
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
    // Restoring onto an empty shelf (new device, after an erase): take on the
    // backup's identity so later backups from here match the original shelf.
    if(wasEmpty && added && info){
      prefs.shelfId = info.id;
      if(info.name && !prefs.shelfName) prefs.shelfName = info.name;
      putPrefs(prefs).catch(()=>{});
    }
    render();
    const tail = (!info && !wasEmpty) ? '\n\n'+NO_OWNER_NOTE : '';
    const parts = [];
    if(added) parts.push(`added ${added} new item${added===1?'':'s'}`);
    if(updated) parts.push(`updated ${updated} existing item${updated===1?'':'s'}`);
    if(stoppedOnQuota){
      alert((parts.length ? parts.join(', ')+', then s' : 'S')+"topped partway through — your device's storage is full. Free up space or remove a few items, then re-import the same file to pick up the rest (already-imported items will be skipped)."+tail);
    } else {
      alert((parts.length ? parts.join(', ')+'.' : "That file didn't contain any recognizable items.")+tail);
    }
  }catch(err){
    alert("Couldn't read that file — make sure it's a Shelfmark export.");
  }
}

const FONT_MAP = {serif:"Georgia,'Times New Roman',serif", sans:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", mono:"'SFMono-Regular',Consolas,Menlo,monospace", zh:"'PingFang SC','Heiti SC','Microsoft YaHei',sans-serif"};
const SIZE_MAP = {s:'15px', m:'17px', l:'19px', xl:'22px'};
let prefs = {theme:'auto', font:'serif', size:'m', loopAudio:false, itemSortMode:'newest', collapsedCats:[], categoryOrder:[], shelfId:'', shelfName:'', exportShelfName:true};
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
  outlinePanelOpen = false;
  document.getElementById('outlinePanel').style.display = 'none';
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

// Starting a blank note skips the file picker entirely — there's nothing to
// read off disk, so saveItem() below just stores whatever content the
// chosen template provides (empty for "Blank"). Picking an actual file
// afterwards (onFile) cancels this back out, and vice versa, since the two
// are mutually exclusive ways of filling the Add sheet.
// Each template supplies a starting title and a markdown skeleton — picking
// one is just a head start, everything stays freely editable afterwards.
const NOTE_TEMPLATES = {
  blank: {
    title: ()=> 'Untitled note',
    content: ()=> ''
  },
  diary: {
    title: ()=> new Date().toLocaleDateString(undefined, {weekday:'long', year:'numeric', month:'long', day:'numeric'}),
    content: ()=> `## ${new Date().toLocaleDateString(undefined, {weekday:'long', year:'numeric', month:'long', day:'numeric'})}\n\n`
  },
  meeting: {
    title: ()=> 'Meeting notes \u2013 ' + new Date().toLocaleDateString(),
    content: ()=> '## Attendees\n- \n\n## Agenda\n- \n\n## Notes\n\n\n## Action items\n- [ ] \n'
  },
  todo: {
    title: ()=> 'To-do list',
    content: ()=> '- [ ] \n- [ ] \n- [ ] \n'
  },
  index: {
    title: ()=> 'Index',
    content: ()=> '```index\n```\n'
  }
};
let pendingNoteTemplate = null; // key into NOTE_TEMPLATES, read by saveItem()
let lastAutoTitle = null; // last title we auto-filled, so switching templates
                          // can safely overwrite it but a title the person
                          // actually typed themselves is never clobbered
function chooseNoteTemplate(key){
  const tpl = NOTE_TEMPLATES[key];
  if(!tpl) return;
  pendingFile = null; pendingType = 'markdown'; pendingBlankNote = true; pendingNoteTemplate = key;
  document.getElementById('fbtn').textContent = 'Choose a file\u2026';
  document.getElementById('fbtn').classList.remove('has-file');
  document.querySelectorAll('#tplGrid .tpl-btn').forEach(b=>b.classList.toggle('active', b.dataset.tpl === key));
  const ti = document.getElementById('ttitle');
  const newTitle = tpl.title();
  if(!ti.value.trim() || ti.value === lastAutoTitle) ti.value = newTitle;
  lastAutoTitle = newTitle;
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('coverField').style.display = 'block';
}
function onFile(e){
  const f = e.target.files[0];
  if(!f) return;
  const t = detectType(f);
  if(!t){ alert("That file type isn't supported yet — try a PDF, markdown/text note, picture, or audio file."); return; }
  pendingBlankNote = false; pendingNoteTemplate = null;
  document.querySelectorAll('#tplGrid .tpl-btn').forEach(b=>b.classList.remove('active'));
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

async function populateCategoryDatalist(datalistId, excludeUncategorized){
  const items = await getAll();
  let cats = [...new Set(items.map(i=>i.category).filter(Boolean))];
  if(excludeUncategorized) cats = cats.filter(c=>c !== 'Uncategorized');
  cats.sort();
  document.getElementById(datalistId).innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">`).join('');
}

async function openAdd(){
  pendingFile = null; pendingType = null; pendingBlankNote = false; pendingNoteTemplate = null; lastAutoTitle = null;
  document.getElementById('fbtn').textContent = 'Choose a file\u2026';
  document.getElementById('fbtn').classList.remove('has-file');
  document.querySelectorAll('#tplGrid .tpl-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('ttitle').value = '';
  document.getElementById('tcat').value = '';
  document.getElementById('saveBtn').disabled = true;
  document.getElementById('coverField').style.display = 'none';
  removeCover('add');
  await populateCategoryDatalist('catlist');
  document.getElementById('overlay').style.display = 'flex';
}
function closeAdd(){ document.getElementById('overlay').style.display = 'none'; }

async function saveItem(){
  if(!pendingFile && !pendingBlankNote) return;
  const title = document.getElementById('ttitle').value.trim() || (pendingBlankNote ? 'Untitled note' : pendingFile.name);
  const category = document.getElementById('tcat').value.trim() || 'Uncategorized';
  let content, mime;
  if(pendingBlankNote){
    const tpl = NOTE_TEMPLATES[pendingNoteTemplate] || NOTE_TEMPLATES.blank;
    content = tpl.content(); mime = 'text/markdown';
  }
  else if(pendingType === 'markdown'){ content = await pendingFile.text(); mime = pendingFile.type; }
  else { content = pendingFile; mime = pendingFile.type; }
  const item = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2),
    title, category, type: pendingType, content, mime,
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
  const wasBlankNote = pendingBlankNote;
  closeAdd();
  render();
  // A freshly created blank note is pointless to look at unopened — jump
  // straight into its editor so "start a blank note" acts like a real
  // "new note" action rather than just adding an empty shelf row.
  if(wasBlankNote){ await openReader(item.id); startEditNote(); }
}

// ---- Quick "new note" shortcut ----
// The header's 📝 button next to "+ Add" — creates a blank untitled note in
// one tap and drops straight into its editor, bypassing the full Add sheet
// (title/category/template/cover fields) entirely for the common case of
// "I just want to jot something down right now". The note can still be
// retitled and re-categorized afterwards from the note's own edit view like
// any other item.
// `title` is optional (the header button calls this with none, falling back
// to "Untitled note") — an unresolved [[Wiki link]]'s missing-link pill also
// calls this, passing the exact title it was written with, so a link-first
// note gets created under the title the link already expects.
async function quickNewNote(title, content){
  const item = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2),
    title: (title && title.trim()) || 'Untitled note', category: 'Uncategorized', type: 'markdown',
    content: (typeof content === 'string') ? content : '', mime: 'text/markdown',
    addedAt: Date.now(), progress: null
  };
  try{
    await put(item);
  }catch(err){
    alert(isQuotaError(err) ? "Your device's storage is full, so this couldn't be saved. Free up space, remove a few items from your shelf, or export a backup and move it elsewhere — then try again." : "Couldn't create a new note — please try again.");
    return;
  }
  render();
  await openReader(item.id);
  startEditNote();
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
function reorderCategory(draggedCat, targetCat){
  const order = (prefs.categoryOrder||[]).slice();
  const from = order.indexOf(draggedCat);
  if(from===-1) return;
  order.splice(from,1);
  const to = order.indexOf(targetCat);
  order.splice(to===-1 ? order.length : to, 0, draggedCat);
  prefs.categoryOrder = order;
  putPrefs(prefs).catch(()=>{});
  render();
}
// ---- Deep search: also match inside note text (opt-in, v1.28.0) ----
// The default search only ever compares against title/category, which are
// already decrypted as part of listing the shelf — free, so it can run on
// every keystroke. Matching note *text* means decrypting every markdown
// note's content (the same cost class as buildTagIndex/renderBacklinks), so
// it's behind a toggle instead of always on. Deliberately session-only, not
// saved in prefs: it resets to off on every reopen (unlike the sort mode and
// collapsed categories, which are remembered since v1.51.0), so it stays a conscious "yes, decrypt everything"
// choice rather than something left on forever and quietly costing time/
// battery on every search.
let deepSearchOn = false;
let deepSearchMatchIds = null; // Set of note ids whose TEXT matched searchQuery; null = not computed for this query yet
let deepSearchToken = 0;       // bumped per keystroke/toggle so a stale in-flight scan discards itself (same idea as wikiACToken)
let deepSearchTimer = null;
function toggleDeepSearch(){
  deepSearchOn = !deepSearchOn;
  const btn = document.getElementById('deepSearchBtn');
  btn.classList.toggle('active', deepSearchOn);
  btn.setAttribute('aria-pressed', deepSearchOn ? 'true' : 'false');
  deepSearchMatchIds = null;
  deepSearchToken++;
  clearTimeout(deepSearchTimer);
  if(deepSearchOn && searchQuery) scheduleDeepSearch();
  render();
}
function scheduleDeepSearch(){
  clearTimeout(deepSearchTimer);
  // Debounced: without this, typing "hello" would decrypt every note five
  // times over, once per letter.
  deepSearchTimer = setTimeout(runDeepSearch, 300);
}
async function runDeepSearch(){
  const myToken = ++deepSearchToken;
  const query = searchQuery;
  if(!query || !deepSearchOn) return;
  const metas = (await getAll()).filter(m=>m.type==='markdown');
  const matches = new Set();
  for(const m of metas){
    if(myToken !== deepSearchToken) return; // a newer keystroke/toggle superseded this scan mid-way
    let full;
    try{ full = await getOne(m.id); } catch(err){ continue; } // skip unreadable/corrupt entries
    if(full && full.content && full.content.toLowerCase().includes(query)) matches.add(m.id);
  }
  if(myToken !== deepSearchToken) return;
  deepSearchMatchIds = matches;
  render();
}

function onSearchInput(){
  searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();
  // Any cached text-matches belong to the previous query; drop them until
  // the debounced scan below finishes. Meanwhile title/category matches
  // still show instantly, then text-only matches appear when the scan lands.
  deepSearchMatchIds = null;
  deepSearchToken++;
  if(deepSearchOn && searchQuery) scheduleDeepSearch();
  else clearTimeout(deepSearchTimer);
  render();
}

async function render(){
  const allItems = (await getAll()).sort((a,b)=>b.addedAt-a.addedAt);
  const items = searchQuery
    ? allItems.filter(it => it.title.toLowerCase().includes(searchQuery)
        || (it.category||'').toLowerCase().includes(searchQuery)
        || (deepSearchMatchIds && deepSearchMatchIds.has(it.id)))
    : allItems;
  document.getElementById('empty').style.display = allItems.length ? 'none' : 'block';
  const noResults = document.getElementById('noResults');
  const deepScanPending = deepSearchOn && !!searchQuery && deepSearchMatchIds === null;
  if(allItems.length && searchQuery && !items.length && !deepScanPending){
    document.getElementById('noResultsText').textContent = `No matches for "${document.getElementById('searchInput').value.trim()}"`;
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }
  const shelf = document.getElementById('shelf');
  shelf.innerHTML = '';
  updateStorageBadge();
  lastRenderedIds = items.map(it=>it.id);

  const groups = new Map();
  for(const it of items){
    const cat = it.category || 'Uncategorized';
    if(!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  // Category order is manual (drag a header to move it), stored in prefs.
  // 'Uncategorized' is never part of that ordering and always sorts last,
  // same as before. Anything not yet in the saved order (a brand-new
  // category) is appended alphabetically and the saved order is topped up
  // to match, so a fresh install still looks alphabetical until the user
  // actually drags something.
  const realCats = [...groups.keys()].filter(c=>c!=='Uncategorized');
  const hasUncat = groups.has('Uncategorized');
  let order = (prefs.categoryOrder||[]).filter(c=>realCats.includes(c));
  const known = new Set(order);
  const freshOnes = realCats.filter(c=>!known.has(c)).sort((a,b)=>a.localeCompare(b));
  order = [...order, ...freshOnes];
  if(JSON.stringify(order) !== JSON.stringify(prefs.categoryOrder||[])){
    prefs.categoryOrder = order;
    putPrefs(prefs).catch(()=>{});
  }
  const cats = hasUncat ? [...order, 'Uncategorized'] : order;
  if(itemSortMode === 'title'){
    // numeric:true so "2" sorts before "10" (plain localeCompare would put
    // "10" first) — matters for titles like the recordings in the
    // screenshot (01, 02_1, 02_2, 02_10, ...).
    for(const list of groups.values()){
      list.sort((a,b)=>a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
    }
  }

  for(const cat of cats){
    const count = groups.get(cat).length;
    const head = document.createElement('div');
    head.className = 'cathead';
    if(collapsedCats.has(cat)) head.classList.add('collapsed');
    // 'Uncategorized' is pinned last and excluded from manual ordering (see
    // above), so it gets no drag handle — nothing to drag it in front of.
    const draggable = cat !== 'Uncategorized';
    head.innerHTML = (draggable ? `<span class="cat-drag" title="Drag to reorder">&#8942;&#8942;</span>` : '')
      + `<span class="chev">&#9656;</span><span>${escapeHtml(cat)}</span>`
      + `<span class="catcount">(${count})</span>`;
    if(draggable){
      head.draggable = true;
      head.addEventListener('dragstart', e=>{
        e.dataTransfer.setData('text/plain', cat);
        e.dataTransfer.effectAllowed = 'move';
        head.classList.add('dragging');
      });
      head.addEventListener('dragend', ()=> head.classList.remove('dragging'));
      head.addEventListener('dragover', e=>{
        if(e.dataTransfer.types.includes('text/plain')){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; head.classList.add('drag-over'); }
      });
      head.addEventListener('dragleave', ()=> head.classList.remove('drag-over'));
      head.addEventListener('drop', e=>{
        e.preventDefault();
        head.classList.remove('drag-over');
        const draggedCat = e.dataTransfer.getData('text/plain');
        if(draggedCat && draggedCat !== cat) reorderCategory(draggedCat, cat);
      });
    }
    shelf.appendChild(head);

    const body = document.createElement('div');
    body.className = 'catbody';
    if(collapsedCats.has(cat)) body.classList.add('collapsed');

    head.onclick = () => {
      const nowCollapsed = body.classList.toggle('collapsed');
      head.classList.toggle('collapsed', nowCollapsed);
      if(nowCollapsed) collapsedCats.add(cat); else collapsedCats.delete(cat);
      prefs.collapsedCats = [...collapsedCats];
      putPrefs(prefs).catch(()=>{});
    };

    for(const it of groups.get(cat)){
      const row = document.createElement('div');
      row.className = 'spine';
      row.dataset.id = it.id;
      row.style.setProperty('--t', TYPE_COLOR[it.type]);

      if(selectMode){
        const isSelected = selectedIds.has(it.id);
        row.classList.toggle('selected', isSelected);
        row.innerHTML = `<div class="sel-indicator">${isSelected ? '&#10003;' : ''}</div>
          ${it.cover ? `<img class="cover-thumb" src="${escapeHtml(it.cover)}">` : ''}
          <div class="meta"><div class="title">${escapeHtml(it.title)}</div>
          <div class="sub">${TYPE_LABEL[it.type]}</div></div>`;
        row.onclick = ()=>toggleSelectItem(it.id, row);
        body.appendChild(row);
        continue;
      }

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
  if(selectMode) updateSelectBar();
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Inverse of escapeHtml — needed wherever text that renderMarkdown already
// escaped (e.g. a [[Wiki link]]'s title, kept escaped so it matches
// buildLinkTypeMap's __byTitle keys) has to go back to plain text to be
// stored as a real field, like a new note's title.
function unescapeHtml(s){ return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[e])); }
function isValidCoverDataUrl(s){
  return typeof s === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(s);
}

// ---- Delete with a brief undo window (single item or a batch) ----
// Deletion is real and immediate (no confirm() dialog) — the raw encrypted
// record(s) are kept in memory for a few seconds so Undo can restore them
// via putRaw(). Only one undo slot: starting a new delete while a previous
// one is still undoable lets that earlier one's grace period lapse right
// away (it's already permanently gone either way, so nothing is lost).
let lastDeleted = null; // { items: [{id, rec}], timeoutId }
async function deleteItemsWithUndo(ids){
  const items = [];
  for(const id of ids){
    const rec = await getOneRaw(id);
    if(rec) items.push({ id, rec });
  }
  if(!items.length) return;
  for(const { id } of items) await del(id);
  if(lastDeleted) clearTimeout(lastDeleted.timeoutId);
  const timeoutId = setTimeout(()=>{ lastDeleted = null; hideUndoToast(); }, 6000);
  lastDeleted = { items, timeoutId };
  document.getElementById('undoToastText').textContent =
    items.length === 1 ? 'Removed from your shelf' : `Removed ${items.length} items from your shelf`;
  showUndoToast();
}
async function removeItem(id){
  await deleteItemsWithUndo([id]);
  render();
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
  const { items } = lastDeleted;
  lastDeleted = null;
  hideUndoToast();
  try{ for(const { rec } of items) await putRaw(rec); }
  catch(err){ alert("Couldn't bring that back — please try again."); return; }
  render();
}

// ---- Multi-select ----
// A lightweight mode: while active, rows show a selection indicator instead
// of their normal controls (play/edit/delete/expand), and a bottom bar
// offers bulk Move-to-category and Delete. The mini-player is hidden while
// selecting to avoid competing for the same screen real estate.
let selectMode = false;
let selectedIds = new Set();
let lastRenderedIds = []; // ids currently visible (post-search), for "Select all"
function toggleSelectMode(){
  selectMode = !selectMode;
  if(!selectMode) selectedIds.clear();
  const btn = document.getElementById('selectModeBtn');
  btn.classList.toggle('active', selectMode);
  btn.innerHTML = selectMode ? '&times;' : '&#9745;';
  btn.title = selectMode ? 'Exit selection' : 'Select multiple items';
  document.getElementById('selectBar').classList.toggle('show', selectMode);
  updateSelectBar();
  updateMiniPlayer();
  render();
}
function exitSelectMode(){ if(selectMode) toggleSelectMode(); }
function toggleSelectItem(id, rowEl){
  if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  const nowSelected = selectedIds.has(id);
  if(rowEl){
    rowEl.classList.toggle('selected', nowSelected);
    const ind = rowEl.querySelector('.sel-indicator');
    if(ind) ind.innerHTML = nowSelected ? '&#10003;' : '';
  }
  updateSelectBar();
}
function updateSelectBar(){
  document.getElementById('selectCount').textContent = `${selectedIds.size} selected`;
  const allSelected = lastRenderedIds.length > 0 && lastRenderedIds.every(id=>selectedIds.has(id));
  document.getElementById('selectAllBtn').textContent = allSelected ? 'Select none' : 'Select all';
}
function selectAllToggle(){
  const allSelected = lastRenderedIds.length > 0 && lastRenderedIds.every(id=>selectedIds.has(id));
  if(allSelected) lastRenderedIds.forEach(id=>selectedIds.delete(id));
  else lastRenderedIds.forEach(id=>selectedIds.add(id));
  render();
}
async function bulkDeleteSelected(){
  if(!selectedIds.size) return;
  const ids = [...selectedIds];
  await deleteItemsWithUndo(ids);
  selectedIds.clear();
  exitSelectMode(); // renders once, already reflecting the deletion
}
function openMoveCategory(){
  if(!selectedIds.size) return;
  document.getElementById('moveCatInput').value = '';
  populateCategoryDatalist('catlist3', true);
  document.getElementById('moveCatOverlay').style.display = 'flex';
}
function closeMoveCategory(){ document.getElementById('moveCatOverlay').style.display = 'none'; }
async function confirmMoveCategory(){
  const category = document.getElementById('moveCatInput').value.trim() || 'Uncategorized';
  const ids = [...selectedIds];
  closeMoveCategory();
  let failed = 0;
  for(const id of ids){
    try{ await putMetaOnly(id, { category }); }
    catch(err){ failed++; }
  }
  selectedIds.clear();
  exitSelectMode(); // renders once, already reflecting the moved category
  if(failed) alert(`Moved ${ids.length - failed} of ${ids.length} items — ${failed} couldn't be saved. Please try those again.`);
}

let editId = null;
async function openEdit(id){
  editId = id;
  const it = await getAll().then(all=>all.find(x=>x.id===id));
  if(!it) return;
  document.getElementById('etitle').value = it.title;
  document.getElementById('ecat').value = (it.category && it.category !== 'Uncategorized') ? it.category : '';
  await populateCategoryDatalist('catlist2', true);
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
  flushDraftNow(); // opening another item while a note is mid-edit (palette jump, note link…) must not lose that edit
  stopDraftTimer();
  await extRefreshOne(id).catch(()=>{}); // linked note: pick up changes made outside (e.g. in Obsidian)
  const it = await getOne(id);
  if(!it) return;
  curId = id; curType = it.type;
  curDraft = null;
  document.getElementById('rtitle').textContent = it.title;
  document.getElementById('bmBtn').style.display = 'none';
  document.getElementById('editNoteBtn').style.display = 'none';
  document.getElementById('findBtn').style.display = 'none';
  closeFindBar(); // a find bar left open from the previous note must not carry over
  document.getElementById('settingsBtn').style.display = 'none';
  document.getElementById('outlineBtn').style.display = 'none';
  settingsPanelOpen = false;
  document.getElementById('settingsPanel').style.display = 'none';
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
  outlinePanelOpen = false;
  document.getElementById('outlinePanel').style.display = 'none';
  const c = document.getElementById('rcontent');
  c.className = ''; c.innerHTML = ''; c.style.display = ''; c.style.flexDirection = '';
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }
  // PDFDocumentProxy (what getDocument().promise resolves to) has no
  // destroy() of its own in the pdf.js build vendored here — only its
  // loadingTask does. Calling curPdfDoc.destroy() directly throws
  // "curPdfDoc.destroy is not a function", and since that throw happens
  // before curPdfDoc is ever reset to null, every openReader/closeReader
  // call afterwards hits the same throw on the same stale doc and aborts
  // immediately — which is what made the reader look like it could never
  // open a second PDF once one had been opened and closed.
  if(curPdfDoc){ curPdfDoc.loadingTask.destroy(); curPdfDoc = null; }
  // Bump the token now and remember it as THIS open's id. Every checkpoint in
  // the pdf branch below re-checks against the live counter before touching
  // shared state (curPdfDoc/curPdfNumPages) or the DOM, so a slow load from
  // an open the user has since closed or replaced can't clobber whatever's
  // current when it finally resolves — it just quietly discards itself.
  const openToken = ++curPdfRenderToken;
  curPdfPage = 1; curPdfNumPages = 0;
  // Show the reader chrome before any type-specific content loads. The pdf
  // branch measures #pdfPage's rendered width to pick a render scale; while
  // #reader still has display:none (i.e. before this class is added) that
  // width reads as 0, so the very first page was rendering at a hardcoded
  // 320px fallback and staying that small even once the reader appeared.
  document.getElementById('reader').classList.add('open');

  if(it.type === 'pdf'){
    pdfZoomMode = 'fit';
    c.classList.add('pad0');
    // Rendered page-by-page onto a <canvas> via pdf.js rather than handed to
    // an <iframe>/native PDF plugin — matches the companion Ledger and
    // Family Health & Shield apps. Two things that native viewer couldn't
    // give us: reading progress (which page you left off on, restored next
    // time you open this item) and identical rendering across every
    // platform, since some mobile browsers have no built-in PDF viewer at
    // all and would otherwise just offer the file as a download.
    c.style.display = 'flex'; c.style.flexDirection = 'column';
    const pdfWrap = document.createElement('div');
    pdfWrap.className = 'pdfwrap';
    if(it.cover){
      const coverImg = document.createElement('img');
      coverImg.className = 'reader-cover';
      coverImg.src = it.cover;
      c.appendChild(coverImg);
    }
    pdfWrap.innerHTML = `
      <div class="pdfpage" id="pdfPage"><p style="font-size:0.85rem;color:var(--ink-soft);">Loading PDF…</p></div>
      <div class="pdfnav">
        <button id="pdfPrev" onclick="pdfPrevPage()" title="Previous page">&#8249;</button>
        <span class="pnum" id="pdfPnum"></span>
        <button id="pdfNext" onclick="pdfNextPage()" title="Next page">&#8250;</button>
        <button id="pdfZoomBtn" class="zoombtn" onclick="cyclePdfZoom()" title="Fit width">Fit</button>
      </div>`;
    c.appendChild(pdfWrap);
    try{
      const buf = await it.content.arrayBuffer();
      if(openToken !== curPdfRenderToken) return; // superseded while reading the file — bail before touching anything
      const pdfjsLib = await pdfjsLibPromise;
      if(openToken !== curPdfRenderToken) return; // superseded while pdf.js was loading
      // isEvalSupported: false — belt-and-suspenders on top of only ever
      // calling getPage()/render() here: tells pdf.js not to use eval()/
      // new Function() for any internal optimization, so a malicious PDF
      // can't get script execution out of the parser. Harmless for
      // rendering — eval is only ever used there as a speed optimization.
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      if(openToken !== curPdfRenderToken){
        // The reader was closed or moved on to a different item while this
        // document was parsing. Destroy this orphaned doc immediately rather
        // than assigning it to curPdfDoc — otherwise a slow first open could
        // resolve after a second, faster open already has its own document
        // and canvas on screen, silently swapping curPdfDoc out from under
        // it and stealing the next render-page token so the real, current
        // open never finishes rendering.
        doc.loadingTask.destroy();
        return;
      }
      curPdfDoc = doc;
      curPdfNumPages = curPdfDoc.numPages;
      const startPage = (it.progress && it.progress.page) ? Math.min(Math.max(1, it.progress.page), curPdfNumPages) : 1;
      await renderPdfPage(startPage);
    } catch(pdfErr){
      if(openToken !== curPdfRenderToken) return; // reader moved on; nowhere to report this error
      const pageEl = document.getElementById('pdfPage');
      if(pageEl) pageEl.innerHTML = `<p style="color:var(--pdf);">Could not open this PDF: ${escapeHtml(pdfErr.message)}</p>`;
    }
  } else if(it.type === 'image'){
    curBlobUrl = URL.createObjectURL(it.content);
    c.innerHTML = `<img class="full" src="${curBlobUrl}">`;
  } else if(it.type === 'markdown'){
    curNoteRaw = it.content;
    curDraft = await loadDraftFor(id, it.content);
    if(it.cover){
      const coverImg = document.createElement('img');
      coverImg.className = 'reader-cover';
      coverImg.src = it.cover;
      c.appendChild(coverImg);
    }
    const div = document.createElement('div');
    div.className = 'mdbody';
    div.id = 'mdView';
    curFolds = new Set(Array.isArray(it.folds) ? it.folds : []);
    div.innerHTML = renderMarkdown(it.content, await buildLinkTypeMap());
    wireInlineAudio(div);
    wireNoteLinks(div);
    wireMissingWikiLinks(div);
    wireTagPills(div);
    wireTaskCheckboxes(div);
    wireParagraphEdit(div);
    wireHeadingFold(div);
    wireTableEdit(div);
    await renderBacklinks(id, div);
    const editWrap = document.createElement('div');
    editWrap.id = 'mdEditWrap';
    editWrap.innerHTML = `<div id="draftNotice" class="draft-notice" style="display:none;"><span id="draftNoticeText"></span><button type="button" onclick="revertToSaved()">Revert to saved</button></div>
      <textarea class="mdedit" id="mdEditArea" spellcheck="false"></textarea>
      <div class="ebar">
        <div class="ebar-tools">
          <button class="tool" id="undoBtn" onclick="undoEdit()" title="Undo">&#8617;</button>
          <button class="tool" id="redoBtn" onclick="redoEdit()" title="Redo">&#8618;</button>
          <button class="tool" onclick="toggleBoldAtSelection()" title="Bold"><b>B</b></button>
          <button class="tool" onclick="toggleStrikeAtSelection()" title="Strikethrough"><s>S</s></button>
          <button class="tool" onclick="toggleHighlightAtSelection()" title="Highlight"><span class="tool-hl">A</span></button>
          <button class="tool" onclick="toggleHeadingAtLine()" title="Heading">H</button>
          <button class="tool" onclick="insertDivider()" title="Insert divider">&#8213;</button>
          <button class="tool" onclick="insertTimestamp()" title="Insert date/time">&#128197;</button>
          <button class="tool" onclick="openAudioLinkPicker()" title="Link a recording already on your shelf">&#127925;</button>
          <button class="tool" onclick="openNoteLinkPicker()" title="Link another note already on your shelf">&#128279;</button>
          <button class="tool" onclick="openPdfLinkPicker()" title="Link a PDF already on your shelf">&#128196;</button>
          <button class="tool" onclick="document.getElementById('noteImgPick').click()" title="Insert a picture">&#128247;</button>
          <button class="tool" onclick="insertTableTemplate()" title="Insert a table">&#9638;</button>
          <button class="tool" id="helpToggleBtn" onclick="toggleMarkdownHelp()" title="Markdown formatting help — stays open while you edit" aria-pressed="false">?</button>
        </div>
        <div class="ebar-actions">
          <button class="cancel" onclick="cancelEditNote()">Cancel</button>
          <button class="save" onclick="saveEditNote()">Save</button>
        </div>
      </div>`;
    c.appendChild(div);
    c.appendChild(editWrap);
    renderDraftBanner();
    document.getElementById('mdEditArea').addEventListener('paste', onNoteEditPaste);
    ['dragenter','dragover'].forEach(t=>document.getElementById('mdEditArea').addEventListener(t, onNoteEditDragOver));
    ['dragleave','dragend'].forEach(t=>document.getElementById('mdEditArea').addEventListener(t, onNoteEditDragLeave));
    document.getElementById('mdEditArea').addEventListener('drop', onNoteEditDrop);
    document.getElementById('mdEditArea').addEventListener('input', onNoteEditInput);
    document.getElementById('mdEditArea').addEventListener('keydown', onNoteEditKeydown);
    document.getElementById('mdEditArea').addEventListener('beforeinput', onNoteEditBeforeInput);
    document.getElementById('mdEditArea').addEventListener('blur', closeWikiAutocomplete);
    if(it.progress && it.progress.scroll) c.scrollTop = it.progress.scroll;
    c.onscroll = ()=>{ clearTimeout(c._t); c._t = setTimeout(()=>saveProgress({scroll:c.scrollTop}), 400); };
    document.getElementById('bmBtn').style.display = 'flex';
    document.getElementById('editNoteBtn').style.display = 'flex';
    document.getElementById('findBtn').style.display = 'flex';
    document.getElementById('settingsBtn').style.display = 'flex';
    updateBookmarkUI(it.bookmarks || []);
    updateOutlineUI(buildOutline(div));
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
  updateMiniPlayer(); // may need to hide now that the reader is showing this track
}
// ---- Export a single item as its own file ----
// Distinct from the whole-shelf backup (doExport/downloadJSON above): this
// hands back the note/PDF/picture/recording exactly as it'd look outside
// Shelfmark — plain markdown text, or the original file bytes — with no
// encryption and no wrapper JSON, so it can be opened in any other app.
const MIME_EXT = {
  'image/jpeg':'.jpg', 'image/png':'.png', 'image/gif':'.gif', 'image/webp':'.webp',
  'image/svg+xml':'.svg', 'image/bmp':'.bmp', 'image/heic':'.heic',
  'audio/mpeg':'.mp3', 'audio/mp4':'.m4a', 'audio/x-m4a':'.m4a', 'audio/wav':'.wav',
  'audio/x-wav':'.wav', 'audio/ogg':'.ogg', 'audio/webm':'.weba', 'audio/aac':'.aac',
  'audio/flac':'.flac', 'audio/opus':'.opus'
};
function extForItem(type, mime){
  if(type === 'markdown') return '.md';
  if(type === 'pdf') return '.pdf';
  const base = mime ? mime.split(';')[0].trim().toLowerCase() : '';
  const known = MIME_EXT[base];
  if(known) return known;
  // Unrecognized but still a real mime subtype (e.g. some odd recorder
  // output) — a short guess beats no extension at all.
  if(base.includes('/')) return '.' + base.split('/')[1].replace(/[^a-z0-9]/gi,'').slice(0,5);
  return '';
}
// Strips characters that trip up common filesystems and keeps the name a
// sane length — the title itself (still shown in the app) is untouched.
function safeExportFilename(title, ext){
  let base = (title || 'Untitled').trim().replace(/[\\/:*?"<>|]+/g,'-').slice(0,80) || 'Untitled';
  // A title that already happens to end with the extension (e.g. a note
  // literally titled "notes.md") shouldn't get it doubled once the date
  // stamp is inserted before it.
  if(base.toLowerCase().endsWith(ext.toLowerCase())) base = base.slice(0, base.length - ext.length);
  // Same date stamp convention as the whole-shelf backup filename below
  // (doExport). Re-exporting the same item later in the day overwrites/
  // dedupes the same as before; exporting on a different day no longer
  // silently collides with — and gets renamed "(1)" over — the old file.
  const stamp = new Date().toISOString().slice(0,10);
  return `${base} ${stamp}${ext}`;
}
async function exportCurrentItem(){
  if(!curId) return;
  const it = await getOne(curId);
  if(!it){ alert("Couldn't find this item — it may have just been deleted."); return; }
  const filename = safeExportFilename(it.title, extForItem(it.type, it.mime));
  try{
    if(it.type === 'markdown'){
      // If a note is mid-edit, export exactly what's in the text box rather
      // than the last-saved version, so nothing just typed goes missing.
      const editWrap = document.getElementById('mdEditWrap');
      const isEditing = editWrap && editWrap.style.display === 'flex';
      const raw = isEditing
        ? expandImagesForSave(document.getElementById('mdEditArea').value)
        : it.content;
      await downloadBlob(new Blob([raw], {type:'text/markdown'}), filename);
    } else {
      await downloadBlob(it.content, filename);
    }
  }catch(err){
    alert("Couldn't export this file — please try again.");
  }
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

// Renders one page of the currently-open PDF onto a fresh canvas (pdf.js
// canvases can't be resized/reused across renders) and updates the nav bar.
// Saves {page: n} as this item's reading progress so reopening it resumes
// here — mirrors how the markdown reader saves scroll position and the
// audio reader saves playback time.
async function renderPdfPage(pageNum){
  if(!curPdfDoc) return;
  const myToken = ++curPdfRenderToken;
  const pageEl = document.getElementById('pdfPage');
  if(!pageEl) return;
  pageEl.innerHTML = '<p style="font-size:0.85rem;color:var(--ink-soft);">Loading page…</p>';
  try{
    const page = await curPdfDoc.getPage(pageNum);
    if(myToken !== curPdfRenderToken) return; // reader moved on while we awaited
    const unscaledViewport = page.getViewport({ scale: 1 });
    const containerWidth = pageEl.clientWidth || 320;
    const fitScale = Math.max(0.1, (containerWidth - 16) / unscaledViewport.width);
    // 'fit' uses the width-fitted scale as-is; a zoom level multiplies on
    // top of it, so 1.5x/2x still means "1.5x/2x bigger than fit", not an
    // absolute PDF scale — consistent across pages of different sizes.
    const scale = pdfZoomMode === 'fit' ? fitScale : fitScale * pdfZoomMode;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';
    canvas.style.margin = '12px auto';
    canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
    // The stylesheet caps canvas width to the container (max-width:calc(100%
    // - 24px)) so the fit case always looks right; zooming past fit needs
    // that cap lifted, or the canvas would just get squeezed back down to
    // the same on-screen size and "zoom" would do nothing. #pdfPage already
    // scrolls (overflow:auto), so an over-width canvas is just pannable.
    canvas.style.maxWidth = pdfZoomMode === 'fit' ? '' : 'none';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if(myToken !== curPdfRenderToken) return;
    pageEl.innerHTML = '';
    pageEl.appendChild(canvas);
    curPdfPage = pageNum;
    updatePdfNavUI();
    updatePdfZoomUI();
    saveProgress({ page: pageNum });
  } catch(pdfErr){
    if(myToken !== curPdfRenderToken) return;
    pageEl.innerHTML = `<p style="color:var(--pdf);">Could not render this page: ${escapeHtml(pdfErr.message)}</p>`;
  }
}
function updatePdfZoomUI(){
  const btn = document.getElementById('pdfZoomBtn');
  if(!btn) return;
  if(pdfZoomMode === 'fit'){
    btn.textContent = 'Fit';
    btn.title = 'Fitted to width — tap to zoom in';
  } else {
    btn.textContent = pdfZoomMode + '\u00d7';
    btn.title = 'Zoomed ' + pdfZoomMode + '\u00d7 — tap to cycle';
  }
}
function cyclePdfZoom(){
  const steps = ['fit', 1.5, 2];
  pdfZoomMode = steps[(steps.indexOf(pdfZoomMode) + 1) % steps.length];
  updatePdfZoomUI();
  if(curPdfDoc) renderPdfPage(curPdfPage);
}
function updatePdfNavUI(){
  const pnum = document.getElementById('pdfPnum');
  if(pnum) pnum.textContent = curPdfPage + ' / ' + curPdfNumPages;
  const prev = document.getElementById('pdfPrev');
  const next = document.getElementById('pdfNext');
  if(prev) prev.disabled = curPdfPage <= 1;
  if(next) next.disabled = curPdfPage >= curPdfNumPages;
}
function pdfPrevPage(){ if(curPdfPage > 1) renderPdfPage(curPdfPage - 1); }
function pdfNextPage(){ if(curPdfPage < curPdfNumPages) renderPdfPage(curPdfPage + 1); }

async function saveProgress(p){
  if(!curId) return;
  try{ await putMetaOnly(curId, { progress: p }); }
  catch(err){ /* autosave — fail silently */ }
}

function startEditNote(){
  // If an unsaved draft exists for this note, editing RESUMES it rather than
  // starting over from the saved text — otherwise the first autosave tick
  // would overwrite the draft the user never got back.
  editResumedDraft = false;
  const draftBanner = document.getElementById('draftBanner');
  if(draftBanner) draftBanner.style.display = 'none'; // the editor's own notice takes over while editing
  if(curDraft){
    document.getElementById('mdEditArea').value = collapseImagesForEdit(curDraft.text);
    editResumedDraft = true;
    editBaselineValue = null;
  } else {
    document.getElementById('mdEditArea').value = collapseImagesForEdit(curNoteRaw);
    editBaselineValue = document.getElementById('mdEditArea').value;
  }
  document.getElementById('mdView').style.display = 'none';
  document.getElementById('mdEditWrap').style.display = 'flex';
  if(helpDockWanted) openHelpDock(); else syncHelpToggleBtn();
  document.getElementById('bmBtn').style.display = 'none';
  document.getElementById('outlineBtn').style.display = 'none';
  document.getElementById('editNoteBtn').classList.add('active');
  document.getElementById('mdEditArea').focus();
  resetUndoHistory();
  draftLastValue = document.getElementById('mdEditArea').value;
  startDraftTimer();
  updateDraftNotice();
  findRefresh(); // switch an open find bar over to editor mode
}
// ---- Undo/Redo for the note editor textarea ----
// Assigning straight to ta.value (every toolbar button and autocomplete
// insert above does this) silently wipes the browser's own native undo
// stack, so Ctrl+Z stopped doing anything useful the moment any of those
// touched the textarea. This is a small undo/redo stack of our own instead:
// a snapshot is pushed before every programmatic edit (one snapshot = one
// undo step, so a toolbar action reverses in a single Undo), and plain
// typing is grouped into a step per pause rather than per keystroke, the
// same granularity most text editors use.
let undoStack = [];
let redoStack = [];
let undoTypingTimer = null;
const UNDO_TYPING_PAUSE_MS = 500;
const UNDO_MAX_STEPS = 100;
function undoSnapshotNow(){
  const ta = document.getElementById('mdEditArea');
  return { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
}
function resetUndoHistory(){
  clearTimeout(undoTypingTimer);
  undoStack = [undoSnapshotNow()];
  redoStack = [];
  updateUndoRedoButtons();
}
function updateUndoRedoButtons(){
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  // Undo is available when there's an earlier snapshot, OR when the text has
  // moved on from the newest snapshot (a programmatic edit — Replace, Bold,
  // etc. — that hasn't been snapshotted yet: undoEdit() snapshots it on
  // demand). Counting only undoStack.length left the button greyed out after
  // a first-ever Replace All, so it couldn't be tapped even though Ctrl+Z worked.
  const ta = document.getElementById('mdEditArea');
  const top = undoStack[undoStack.length - 1];
  const unsnapshotted = !!(ta && top && top.value !== ta.value);
  if(undoBtn) undoBtn.disabled = undoStack.length < 2 && !unsnapshotted;
  if(redoBtn) redoBtn.disabled = redoStack.length === 0;
}
// Call before any programmatic change to ta.value (toolbar buttons, link/
// image/wiki-link inserts) so that change becomes its own undo step.
function pushUndoBeforeEdit(){
  clearTimeout(undoTypingTimer);
  const ta = document.getElementById('mdEditArea');
  const top = undoStack[undoStack.length - 1];
  if(!top || top.value !== ta.value){
    undoStack.push(undoSnapshotNow());
    if(undoStack.length > UNDO_MAX_STEPS) undoStack.shift();
  }
  redoStack = [];
  updateUndoRedoButtons();
  // The caller changes ta.value right after this returns, so refresh once
  // more after that edit lands — otherwise the button state is computed
  // against the pre-edit text.
  setTimeout(updateUndoRedoButtons, 0);
}
// Called on every keystroke from onNoteEditInput; only actually snapshots
// after a pause in typing, so a burst of keystrokes undoes as one step.
function noteTypingForUndo(){
  redoStack = [];
  clearTimeout(undoTypingTimer);
  undoTypingTimer = setTimeout(()=>{
    const ta = document.getElementById('mdEditArea');
    const top = undoStack[undoStack.length - 1];
    if(!top || top.value !== ta.value){
      undoStack.push(undoSnapshotNow());
      if(undoStack.length > UNDO_MAX_STEPS) undoStack.shift();
    }
    updateUndoRedoButtons();
  }, UNDO_TYPING_PAUSE_MS);
}
function applyUndoSnapshot(s){
  const ta = document.getElementById('mdEditArea');
  ta.value = s.value;
  ta.focus();
  ta.setSelectionRange(s.start, s.end);
}
function undoEdit(){
  clearTimeout(undoTypingTimer);
  const ta = document.getElementById('mdEditArea');
  if(!ta || ta.closest('#mdEditWrap').style.display === 'none') return;
  // Flush whatever's been typed since the last snapshot so Undo steps back
  // from right now, not from wherever the debounce last landed.
  const top = undoStack[undoStack.length - 1];
  if(!top || top.value !== ta.value) undoStack.push(undoSnapshotNow());
  if(undoStack.length < 2) return; // nothing earlier to go back to
  redoStack.push(undoStack.pop());
  applyUndoSnapshot(undoStack[undoStack.length - 1]);
  updateUndoRedoButtons();
}
function redoEdit(){
  clearTimeout(undoTypingTimer);
  if(!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(s);
  applyUndoSnapshot(s);
  updateUndoRedoButtons();
}
// Same block split renderMarkdown uses (blank-line separated), but returns
// each block's [start,end] character offset instead of its text — lets
// editParagraphAt find exactly where a tapped paragraph starts in the
// textarea without disturbing anything renderMarkdown itself does.
function blockOffsets(text){
  const offsets = [];
  let start = 0;
  const re = /\n{2,}/g;
  let m;
  while((m = re.exec(text))){
    offsets.push([start, m.index]);
    start = m.index + m[0].length;
  }
  offsets.push([start, text.length]);
  return offsets;
}
// Jumps straight into the existing source editor with the cursor placed at
// paragraph `idx`, instead of only landing at the top via the pencil
// button. Offsets are computed against the COLLAPSED text (same
// collapseImagesForEdit output startEditNote puts in the textarea) since
// that's what's actually on screen — collapsing an image link to `img:N`
// only shortens it in place, so block boundaries still line up 1:1 with
// curNoteRaw's.
function editParagraphAt(idx){
  if(curNoteRaw == null) return;
  startEditNote();
  // Resuming a draft: paragraph numbers refer to the SAVED text, so they don't
  // line up with the draft — leave the caret alone rather than land on the
  // wrong paragraph.
  if(editResumedDraft) return;
  const ta = document.getElementById('mdEditArea');
  const range = blockOffsets(ta.value)[idx];
  if(!range) return;
  const pos = range[0];
  // Rough proportional nudge so a long note doesn't leave the caret way off
  // screen before the browser's own focus/selection scrolling takes over —
  // measuring the exact wrapped-line position isn't worth the complexity
  // here.
  if(ta.scrollHeight > ta.clientHeight){
    ta.scrollTop = Math.max(0, (pos / ta.value.length) * ta.scrollHeight - ta.clientHeight / 3);
  }
  ta.setSelectionRange(pos, pos);
}
// Lets a tap on a paragraph in reading view jump straight into edit mode at
// that paragraph. Skips taps on anything with its own tap behavior (a link,
// a button, a checkbox, an audio/note-link widget) so those keep working
// exactly as before.
// `summary` = the title row of a foldable callout: tapping it must fold/unfold, not open the editor.
const PARAGRAPH_TAP_EXCLUDE = 'button, a, input, summary, td, th, img.md-img, .md-audio-inline, .md-note-link';
let paragraphLongPressFired = false;
function wireParagraphEdit(container){
  container.querySelectorAll('.mdblock').forEach(el=>{
    el.onclick = (e)=>{
      if(paragraphLongPressFired){ paragraphLongPressFired = false; return; }
      if(e.target.closest(PARAGRAPH_TAP_EXCLUDE)) return;
      // A mouse drag that selects text still fires a click on mouseup (as
      // long as it started/ended on the same element), so without this
      // check every text selection would get yanked straight into edit
      // mode instead of leaving you free to copy. Only treat this as a
      // genuine tap when there's no active (non-empty) selection.
      const sel = window.getSelection();
      if(sel && sel.toString().length > 0) return;
      editParagraphAt(Number(el.dataset.idx));
    };
  });
  wireParagraphLongPress(container);
}
// Touch fallback for the tap-to-edit gesture above: there's no hover state
// on touch to hint a paragraph is tappable before you tap it, so a
// long-press instead pops up an explicit "Edit this paragraph" menu at the
// touch point. Same destination (editParagraphAt) — just discoverable
// without a mouse.
function wireParagraphLongPress(container){
  container.querySelectorAll('.mdblock').forEach(el=>{
    let timer = null, startX = 0, startY = 0, moved = false;
    el.addEventListener('touchstart', (e)=>{
      if(e.target.closest(PARAGRAPH_TAP_EXCLUDE)) return;
      moved = false;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      const idx = Number(el.dataset.idx);
      clearTimeout(timer);
      timer = setTimeout(()=>{
        if(moved) return;
        // A long-press is also how touch devices start a native text
        // selection, so if one has already kicked in by the time our timer
        // fires, defer to it instead of popping the edit menu on top of the
        // selection handles.
        const sel = window.getSelection();
        if(sel && sel.toString().length > 0) return;
        paragraphLongPressFired = true;
        setTimeout(()=>{ paragraphLongPressFired = false; }, 800); // fail-safe in case no click follows to reset this
        showParagraphMenu(idx, t.clientX, t.clientY);
      }, 550);
    }, {passive:true});
    el.addEventListener('touchmove', (e)=>{
      const t = e.touches[0];
      if(Math.abs(t.clientX-startX) > 10 || Math.abs(t.clientY-startY) > 10){
        moved = true;
        clearTimeout(timer);
      }
    }, {passive:true});
    el.addEventListener('touchend', ()=>clearTimeout(timer));
    el.addEventListener('touchcancel', ()=>clearTimeout(timer));
  });
}
let paragraphMenuEl = null;
function closeParagraphMenu(){
  if(paragraphMenuEl){ paragraphMenuEl.remove(); paragraphMenuEl = null; }
  document.removeEventListener('touchstart', closeParagraphMenuOnOutside, true);
  document.removeEventListener('click', closeParagraphMenuOnOutside, true);
}
function closeParagraphMenuOnOutside(e){
  if(paragraphMenuEl && !paragraphMenuEl.contains(e.target)) closeParagraphMenu();
}
function showParagraphMenu(idx, x, y){
  closeParagraphMenu();
  const menu = document.createElement('div');
  menu.className = 'para-menu';
  menu.innerHTML = `<button type="button" class="para-menu-btn">Edit this paragraph</button>`;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8);
  let top = y - rect.height - 14;
  if(top < 8) top = y + 14;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.querySelector('.para-menu-btn').onclick = (e)=>{
    e.stopPropagation();
    closeParagraphMenu();
    editParagraphAt(idx);
  };
  paragraphMenuEl = menu;
  setTimeout(()=>{
    document.addEventListener('touchstart', closeParagraphMenuOnOutside, true);
    document.addEventListener('click', closeParagraphMenuOnOutside, true);
  }, 0);
}
// ---- Draft autosave (v1.31.0) ----
// While the editor is open, the text is written to a draft every few seconds
// (only when it has changed), and immediately when the reader is closed, the
// page is hidden, or another item is opened. Same "fail silently" stance as
// reading-progress autosave — it fires too often to interrupt with an alert.
const DRAFT_INTERVAL_MS = 3000;
let curDraft = null;          // {text, savedAt} loaded when this note was opened, or null
let draftTimer = null;
let draftLastValue = null;    // textarea value as of the last draft write (or edit start)
let editResumedDraft = false; // this edit session began from a draft, not from the saved text
let editBaselineValue = null; // textarea value at edit start when NOT resuming; null when resuming
function noteEditActive(){
  const w = document.getElementById('mdEditWrap');
  return !!w && w.style.display === 'flex';
}
function startDraftTimer(){
  stopDraftTimer();
  draftTimer = setInterval(draftTick, DRAFT_INTERVAL_MS);
}
function stopDraftTimer(){
  if(draftTimer){ clearInterval(draftTimer); draftTimer = null; }
}
function draftTick(){ flushDraftNow(); }
function flushDraftNow(){
  if(!curId || curType !== 'markdown' || !noteEditActive()) return;
  const ta = document.getElementById('mdEditArea');
  if(!ta || ta.value === draftLastValue) return;
  draftLastValue = ta.value;
  putDraft(curId, expandImagesForSave(ta.value)).catch(()=>{}); // fail silently, see above
}
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushDraftNow(); });
window.addEventListener('pagehide', flushDraftNow);
// A draft only counts if it differs from what's saved — one identical to the
// saved text (typed something, then typed it back) is just cleaned up.
async function loadDraftFor(id, savedText){
  const d = await getDraft(id);
  if(!d) return null;
  if(d.text === savedText){ clearDraft(id).catch(()=>{}); return null; }
  return d;
}
function fmtDraftTime(ts){
  return new Date(ts).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function renderDraftBanner(){
  const old = document.getElementById('draftBanner');
  if(old) old.remove();
  const view = document.getElementById('mdView');
  if(!curDraft || !view) return;
  const b = document.createElement('div');
  b.id = 'draftBanner';
  b.className = 'draft-banner';
  b.innerHTML = `<span>Unsaved draft from ${escapeHtml(fmtDraftTime(curDraft.savedAt))} — your last edits weren't saved.</span>`
    + `<button type="button" onclick="startEditNote()">Continue editing</button>`
    + `<button type="button" onclick="discardDraft()">Discard</button>`;
  view.parentNode.insertBefore(b, view);
}
async function discardDraft(){
  if(!confirm("Discard this unsaved draft? This can't be undone.")) return;
  const id = curId;
  curDraft = null;
  renderDraftBanner();
  if(id) clearDraft(id).catch(()=>{});
}
function updateDraftNotice(){
  const box = document.getElementById('draftNotice');
  if(!box) return;
  box.style.display = editResumedDraft ? 'flex' : 'none';
  if(editResumedDraft && curDraft) document.getElementById('draftNoticeText').textContent = 'Resumed your unsaved draft from ' + fmtDraftTime(curDraft.savedAt) + '.';
}
// Not undoable on purpose: collapseImagesForEdit renumbers the picture
// placeholders (img:1, img:2…) for whichever text it's given, so undoing back
// across a revert would restore text whose numbers no longer match the
// picture list — and Save would then attach the wrong pictures.
function revertToSaved(){
  if(!confirm('Replace the text in the editor with the last saved version? Your unsaved draft will be lost.')) return;
  const ta = document.getElementById('mdEditArea');
  ta.value = collapseImagesForEdit(curNoteRaw);
  editResumedDraft = false;
  editBaselineValue = ta.value;
  resetUndoHistory();
  updateDraftNotice();
  findRefresh();
}
// The Cancel button: asks first if that would throw work away, then discards
// the draft too. (Closing the reader instead keeps the draft — see
// closeReader — that's the accidental-back case this whole feature is for.)
function cancelEditNote(){
  const ta = document.getElementById('mdEditArea');
  const dirty = editResumedDraft || (ta && editBaselineValue !== null && ta.value !== editBaselineValue);
  if(dirty && !confirm('Discard your unsaved changes to this note?')) return;
  stopDraftTimer();
  const id = curId;
  curDraft = null;
  renderDraftBanner();
  if(id) clearDraft(id).catch(()=>{});
  leaveEditMode();
}
function leaveEditMode(){
  stopDraftTimer();
  editResumedDraft = false;
  updateDraftNotice();
  closeWikiAutocomplete();
  document.getElementById('mdEditWrap').style.display = 'none';
  document.getElementById('mdView').style.display = 'block';
  document.getElementById('bmBtn').style.display = 'flex';
  document.getElementById('editNoteBtn').classList.remove('active');
  updateOutlineUI(buildOutline(document.getElementById('mdView')));
  findRefresh(); // back to reading view: re-highlight against the (possibly just re-rendered) text
}
async function saveEditNote(){
  if(!curId) return;
  stopDraftTimer(); // no new draft write may start once Save has (an in-flight one finishes first — see serialized())
  const text = expandImagesForSave(document.getElementById('mdEditArea').value);
  try{
    await putContentOnly(curId, 'markdown', text);
  }catch(err){
    startDraftTimer(); // save failed and the editor stays open — keep protecting the text
    alert(isQuotaError(err) ? "Your device's storage is full, so this couldn't be saved. Your edits are still in the text box — free up space and try Save again." : "Couldn't save this note — please try again.");
    return;
  }
  curNoteRaw = text;
  const mdView = document.getElementById('mdView');
  mdView.innerHTML = renderMarkdown(text, await buildLinkTypeMap());
  wireInlineAudio(mdView);
  wireNoteLinks(mdView);
  wireMissingWikiLinks(mdView);
  wireTagPills(mdView);
  wireTaskCheckboxes(mdView);
  wireParagraphEdit(mdView);
  wireHeadingFold(mdView);
  wireTableEdit(mdView);
  await renderBacklinks(curId, mdView); // link targets may have changed
  const it = await getOne(curId);
  updateBookmarkUI(it.bookmarks || []);
  updateOutlineUI(buildOutline(mdView));
  const savedId = curId;
  curDraft = null;
  renderDraftBanner();
  clearDraft(savedId).catch(()=>{}); // queued after the content write, so it can't resurrect stale text
  leaveEditMode();
}

// ---- Find / replace inside a note (v1.29.0) ----
// One find bar, two modes, because "the text you see" and "the text you edit"
// are different strings in a markdown note:
//  • Reading view: searches the RENDERED text (what you actually see — a
//    match never lands on hidden syntax like `**` or a URL) and highlights
//    hits with <mark>. Read-only: replacing needs the source text, so the
//    bar offers a "Replace…" button that opens the editor with the same
//    query carried over.
//  • Editing view: searches the textarea's own text, selects each match, and
//    Replace / All rewrite it. Every replace goes through pushUndoBeforeEdit,
//    so Replace All is a single Undo step.
// Session-only state, nothing persisted. Matches spanning two rendered
// elements (e.g. across a bold boundary) aren't found in reading view — a
// known limit of walking text nodes; edit-mode search has no such gap.
let findOpen = false;
let findCase = false;
// Set only by openNoteAtTag(): the query is a #tag and should match that WHOLE
// tag ('#idea' must not light up '#ideas'). Deliberately NOT skipping code:
// the tag index and the renderer can disagree about what counts as code (a
// stray or unbalanced backtick shifts which spans pair up), so a tag the Tags
// page lists may show up in the note only inside a code span — skipping code
// then found nothing and the jump looked broken. Cleared the moment the user
// edits the query, so ordinary find stays a plain substring search.
let findTagExact = false;
let findHits = [];       // reading view: the <mark> elements
let findEditMatches = []; // editing view: start offsets into the textarea
let findIdx = -1;
const FIND_MAX_HITS = 2000;
function findIsEditing(){
  const w = document.getElementById('mdEditWrap');
  return !!w && w.style.display === 'flex';
}
function escapeRegExp(str){ return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function findRegex(q){
  if(findTagExact && /^#[\p{L}\p{N}_-]+$/u.test(q))
    return new RegExp('(?<![\\w/#])' + escapeRegExp(q) + '(?![\\p{L}\\p{N}_-])', findCase ? 'gu' : 'giu');
  return new RegExp(escapeRegExp(q), findCase ? 'g' : 'gi');
}
function toggleFindBar(){ findOpen ? closeFindBar() : openFindBar(); }
function openFindBar(noFocus){
  if(curType !== 'markdown') return;
  findOpen = true;
  document.getElementById('findBar').style.display = 'flex';
  document.getElementById('findBtn').classList.add('active');
  updateFindBarMode();
  const inp = document.getElementById('findInput');
  // Pre-fill from a selection in the editor, if there is one — same habit as
  // every desktop editor's Ctrl+F.
  if(findIsEditing()){
    const ta = document.getElementById('mdEditArea');
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if(sel && sel.length < 100 && !sel.includes('\n')) inp.value = sel;
  }
  if(!noFocus){ inp.focus(); inp.select(); } // a programmatic jump shouldn't raise the phone keyboard
  findRefresh();
}
function closeFindBar(){
  findOpen = false;
  findTagExact = false;
  clearFindMarks();
  findHits = []; findEditMatches = []; findIdx = -1;
  const bar = document.getElementById('findBar');
  if(bar) bar.style.display = 'none';
  const btn = document.getElementById('findBtn');
  if(btn) btn.classList.remove('active');
}
function toggleFindCase(){
  findCase = !findCase;
  const b = document.getElementById('findCaseBtn');
  b.classList.toggle('active', findCase);
  b.setAttribute('aria-pressed', findCase ? 'true' : 'false');
  findRefresh();
}
// Shows the replace row only while editing; in reading view shows the
// "Replace…" shortcut into the editor instead.
function updateFindBarMode(){
  const editing = findIsEditing();
  document.getElementById('replaceRow').style.display = editing ? 'flex' : 'none';
  document.getElementById('findEditHint').style.display = editing ? 'none' : 'flex';
}
function clearFindMarks(){
  const view = document.getElementById('mdView');
  if(!view) return;
  view.querySelectorAll('mark.find-hit').forEach(m=>{
    const parent = m.parentNode;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
}
// Ranges of the editor text that must never be touched by a match: the
// (img:N) reference that stands in for an embedded picture's data.
function findProtectedRanges(text){
  const out = [];
  const re = /\((?:img|aud):\d+\)/g; let m;
  while((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function findEditOffsets(text, q){
  const prot = findProtectedRanges(text);
  const re = findRegex(q); const out = []; let m;
  while((m = re.exec(text)) && out.length < FIND_MAX_HITS){
    const a = m.index, b = m.index + m[0].length;
    if(!prot.some(([ps, pe]) => a < pe && b > ps)) out.push(a);
    if(m[0].length === 0) re.lastIndex++;
  }
  return out;
}
// A find hit inside a collapsed foldable callout is in the DOM (and counted)
// but not rendered, so scrollIntoView() on it does nothing. Open every
// <details> around it first. Only ever opens, never re-closes: stepping past
// the hit leaves the callout open, which is what you want when reading on.
function revealFindHit(el){
  for(let d = el && el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  // ...and the same for a hit under a collapsed heading (v1.37.0).
  const blk = el && el.closest && el.closest('.mdblock');
  if(blk) revealBlock(blk);
}
function highlightReader(q){
  clearFindMarks();
  findHits = [];
  const view = document.getElementById('mdView');
  if(!view || !q) return;
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      const tag = n.parentNode && n.parentNode.nodeName;
      // tag pills are <button>s but hold real note text ("#idea"), so they stay searchable
      const pill = n.parentNode.classList && n.parentNode.classList.contains('tag-pill');
      if((tag === 'BUTTON' && !pill) || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = []; let n;
  while((n = walker.nextNode())) nodes.push(n); // collect first — wrapping mutates the tree
  for(const node of nodes){
    if(findHits.length >= FIND_MAX_HITS) break;
    const text = node.nodeValue;
    const re = findRegex(q); let m, last = 0, frag = null;
    while((m = re.exec(text)) && findHits.length < FIND_MAX_HITS){
      if(m[0].length === 0){ re.lastIndex++; continue; }
      if(!frag) frag = document.createDocumentFragment();
      if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = m[0];
      frag.appendChild(mark);
      findHits.push(mark);
      last = m.index + m[0].length;
    }
    if(frag){
      if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }
}
function updateFindCount(msg){
  const el = document.getElementById('findCount');
  if(!el) return;
  if(msg){ el.textContent = msg; return; }
  const q = document.getElementById('findInput').value;
  const total = findIsEditing() ? findEditMatches.length : findHits.length;
  el.textContent = !q ? '' : (total ? `${findIdx + 1}/${total}` : '0');
}
// Recomputes matches for the current query + mode. Called on every query
// change, mode switch, and after anything that re-renders the note.
function findRefresh(){
  if(!findOpen) return;
  updateFindBarMode();
  const q = document.getElementById('findInput').value;
  if(findIsEditing()){
    clearFindMarks(); findHits = [];
    const ta = document.getElementById('mdEditArea');
    findEditMatches = q ? findEditOffsets(ta.value, q) : [];
    // land on the first match at/after the caret so typing a query doesn't
    // yank you back to the top of a long note
    const at = findEditMatches.findIndex(o => o >= ta.selectionStart);
    findIdx = findEditMatches.length ? (at === -1 ? 0 : at) : -1;
  } else {
    findEditMatches = [];
    highlightReader(q);
    findIdx = findHits.length ? 0 : -1;
    if(findIdx === 0) findHits[0].classList.add('cur');
  }
  updateFindCount();
}
function onFindInput(){
  findTagExact = false; // user is typing their own query now: back to plain substring find
  findRefresh();
  // reading view: bring the first hit into view as you type
  if(!findIsEditing() && findIdx >= 0){ revealFindHit(findHits[findIdx]); findHits[findIdx].scrollIntoView({ block:'center' }); }
}
function goToFindMatch(){
  const editing = findIsEditing();
  const total = editing ? findEditMatches.length : findHits.length;
  if(!total){ updateFindCount(); return; }
  if(editing){
    const q = document.getElementById('findInput').value;
    const ta = document.getElementById('mdEditArea');
    const start = findEditMatches[findIdx];
    ta.focus(); // focusing is what makes the browser scroll the selection into view
    ta.setSelectionRange(start, start + q.length);
  } else {
    findHits.forEach(m=>m.classList.remove('cur','pulse'));
    const curMark = findHits[findIdx];
    curMark.classList.add('cur');
    void curMark.offsetWidth; // restart the animation if this mark was already current
    curMark.classList.add('pulse');
    revealFindHit(curMark);
    curMark.scrollIntoView({ block:'center' });
  }
  updateFindCount();
}
function findStep(dir){
  const total = findIsEditing() ? findEditMatches.length : findHits.length;
  if(!total) return;
  findIdx = (findIdx + dir + total) % total;
  goToFindMatch();
}
function onFindKeydown(e){
  if(e.key === 'Enter'){ e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  else if(e.key === 'Escape'){ e.preventDefault(); closeFindBar(); }
}
function onReplaceKeydown(e){
  if(e.key === 'Enter'){ e.preventDefault(); replaceCurrent(); }
  else if(e.key === 'Escape'){ e.preventDefault(); closeFindBar(); }
}
// Replace = two-step, like most editors: the first press selects the match
// you're on (so you see what's about to change); pressing again replaces it
// and hops to the next.
function replaceCurrent(){
  if(!findIsEditing() || !findEditMatches.length) return;
  const q = document.getElementById('findInput').value;
  const rep = document.getElementById('replaceInput').value;
  const ta = document.getElementById('mdEditArea');
  const start = findEditMatches[findIdx];
  const alreadySelected = ta.selectionStart === start && ta.selectionEnd === start + q.length;
  if(!alreadySelected){ goToFindMatch(); return; }
  pushUndoBeforeEdit();
  ta.value = ta.value.slice(0, start) + rep + ta.value.slice(start + q.length);
  const caret = start + rep.length;
  ta.setSelectionRange(caret, caret);
  findEditMatches = findEditOffsets(ta.value, q);
  const next = findEditMatches.findIndex(o => o >= caret);
  findIdx = findEditMatches.length ? (next === -1 ? 0 : next) : -1;
  if(findIdx >= 0) goToFindMatch(); else updateFindCount();
}
function replaceAll(){
  if(!findIsEditing()) return;
  const q = document.getElementById('findInput').value;
  if(!q) return;
  const rep = document.getElementById('replaceInput').value;
  const ta = document.getElementById('mdEditArea');
  const offsets = findEditOffsets(ta.value, q);
  if(!offsets.length){ updateFindCount(); return; }
  pushUndoBeforeEdit(); // the whole batch is one Undo step
  // rebuild from the end so earlier offsets stay valid
  let text = ta.value;
  for(let i = offsets.length - 1; i >= 0; i--){
    text = text.slice(0, offsets[i]) + rep + text.slice(offsets[i] + q.length);
  }
  ta.value = text;
  findRefresh();
  updateFindCount(`${offsets.length} replaced`);
}
// Reading view's "Replace…": replacing edits the note's text, so switch to
// the editor and keep the query.
function startEditFromFind(){
  startEditNote();
  findRefresh();
}
// Ctrl/Cmd+F while a note is open opens this bar instead of the browser's
// own find (which can't see inside the editor and knows nothing of Replace).
document.addEventListener('keydown', (e)=>{
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'
     && curType === 'markdown' && document.getElementById('reader').classList.contains('open')){
    e.preventDefault();
    if(!findOpen) openFindBar(); else { const i = document.getElementById('findInput'); i.focus(); i.select(); }
  }
});

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

// Wires up every shelf://<id> note-link widget inside a just-rendered note
// (mirrors wireInlineAudio above, for the note-to-note case added in
// v1.16.0). A tap jumps straight into the linked note; if it's been deleted
// since the link was made, this is where that's actually discovered and
// reported — renderMarkdown itself has no way to know that ahead of time.
function wireNoteLinks(container){
  container.querySelectorAll('.md-note-link, .si-link').forEach(el=>{
    const id = el.dataset.noteId;
    el.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); openNoteLink(id); };
  });
}
// Wires up every unresolved [[Wiki link]] pill (.wiki-link-missing) inside a
// just-rendered note — tapping one creates a brand-new note titled exactly
// what was written inside the brackets and jumps straight into its editor
// (same as quickNewNote's own header-button shortcut, just pre-titled).
// Closes the "link now, write later" loop: this note's own [[Title]] link,
// and any other note's, resolves to a working .md-note-link the very next
// time it renders, since renderMarkdown looks titles up fresh every render
// (buildLinkTypeMap/__byTitle) rather than freezing to an id up front — no
// separate patch-up step needed once the title exists.
function wireMissingWikiLinks(container){
  container.querySelectorAll('.wiki-link-missing').forEach(el=>{
    el.onclick = (e)=>{
      e.stopPropagation();
      quickNewNote(unescapeHtml(el.dataset.title));
    };
  });
}
// Used both by shelf://<id> note-links (v1.16.0, markdown targets only) and
// by [[Wiki links]] (any target type — see renderMarkdown) sharing the same
// .md-note-link widget: type-agnostic existence check, then just open it.
async function openNoteLink(id){
  const items = await getAll();
  const target = items.find(it=>it.id === id);
  if(!target){
    alert("This linked item isn't on your shelf anymore — it may have been deleted.");
    return;
  }
  openReader(id);
}

// Cheap {id: type} lookup built from item metadata alone (getAll() never
// touches encrypted file content) — renderMarkdown uses this to tell a
// shelf://<id> link's target type apart so it can render an audio widget
// vs. a note-link widget without decrypting anything itself.
// Also carries a title -> item index (as a non-enumerable-looking extra
// property, __byTitle) for [[Wiki links]] below — same getAll() call, no
// extra IndexedDB round trip, and every existing map[id] lookup is
// unaffected since no real item id is ever the literal string "__byTitle".
// Keyed by the ESCAPED, lowercased title (same escapeHtml() the renderer
// already ran on the raw source), so a title containing &, <, >, or quotes
// still matches what a [[Wiki link]] typed against that title looks like
// post-escape. First item wins on a duplicate title, same "first match"
// ambiguity Obsidian itself has.
async function buildLinkTypeMap(){
  const items = await getAll();
  const map = {};
  const byTitle = new Map();
  items.forEach(it=>{
    map[it.id] = it.type;
    const key = escapeHtml((it.title||'').trim()).toLowerCase();
    if(key && !byTitle.has(key)) byTitle.set(key, it);
  });
  map.__byTitle = byTitle;
  map.__all = items; // metadata only (id/title/type/category) — used by ```index blocks
  return map;
}

// ---- Hashtags (#tag) and the Tags browse page ----
// Tags live inline in a note's own markdown text (typed as "#word") rather
// than as a separate field — they coexist with "category" (one category per
// item, set from the Add/Edit sheet) but a note can carry any number of
// tags at once, added or removed just by editing its text. Nothing extra is
// stored: tags are parsed back out of the note content every time they're
// needed, the same way renderBacklinks() re-scans every note's content
// rather than keeping a separate index that could drift out of sync.
//
// Matched syntax: "#" immediately followed by a letter/digit/underscore
// (Unicode-aware, so "#工作" and "#idea" both work), then more of the same
// plus hyphens, up to 50 chars. The lookbehind excludes a "#" that's part of
// a heading ("# Title" / "## Title" — headings always have a space or
// another "#" right after, which the lookbehind/match already rule out) or
// sitting inside a word or URL fragment ("page#section", "C#") by requiring
// the character immediately before "#" to be neither a word character nor
// "/" nor another "#".
const TAG_RE = /(?<![\w/#])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,49})/gu;
// Strips fenced and inline code out of the raw text before tag-matching, so
// a "#" typed inside a code sample (e.g. a shell flag or C# in a snippet)
// is never picked up as a tag. Only used for extraction — never written
// back, and never shown to the user.
function stripCodeForTags(raw){
  return raw.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
}
// Every distinct tag in one note, de-duplicated case-insensitively (so
// "#Idea" and "#idea" count as the same tag) — the first-seen casing is
// kept only for display; grouping/lookup always uses the lowercase form.
function extractTags(raw){
  const seen = new Map(); // lowercase -> original casing, in first-seen order
  const stripped = stripCodeForTags(raw || '');
  TAG_RE.lastIndex = 0;
  let m;
  while((m = TAG_RE.exec(stripped))){
    const key = m[1].toLowerCase();
    if(!seen.has(key)) seen.set(key, m[1]);
  }
  return seen;
}
// Scans every note on the shelf and groups them by tag — necessarily
// decrypts each note's content (tags aren't in the unencrypted-per-item
// metadata), same trade-off renderBacklinks already makes: too slow to do
// on every keystroke, fine to do once when the Tags page is opened.
async function buildTagIndex(){
  const metas = (await getAll()).filter(m=>m.type==='markdown');
  const index = new Map(); // lowercase tag -> {display, items:[{id,title,category}]}
  for(const m of metas){
    let full;
    try{ full = await getOne(m.id); } catch(err){ continue; } // skip unreadable/corrupt entries
    if(!full || !full.content) continue;
    for(const [key, display] of extractTags(full.content)){
      if(!index.has(key)) index.set(key, { display, items: [] });
      index.get(key).items.push({ id: full.id, title: full.title, category: full.category });
    }
  }
  return index;
}
// Turns "#tag" runs inside already-HTML-escaped, already-code-converted
// markdown into tappable pills. Must run AFTER the inline-code (`` ` ``)
// pass above so it can skip over already-produced <code> spans wholesale —
// splitting on them and only transforming the text between is the same
// "don't touch what's already code" approach the fenced-code placeholder
// swap uses further up in renderMarkdown.
function convertHashtags(html){
  return html.split(/(<code>[\s\S]*?<\/code>)/).map(part=>{
    if(part.startsWith('<code>')) return part;
    return part.replace(TAG_RE, (whole, tag)=>
      `<button type="button" class="tag-pill" data-tag="${escapeHtml(tag.toLowerCase())}">#${escapeHtml(tag)}</button>`);
  }).join('');
}
// Wires up every tag pill inside a just-rendered note (mirrors
// wireInlineAudio/wireNoteLinks above) — tapping one jumps straight to the
// Tags page, already filtered to that tag.
function wireTagPills(container){
  container.querySelectorAll('.tag-pill').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); openTagsPage(el.dataset.tag); };
  });
}

let tagsPageTag = null; // null = showing the full tag list; a lowercase tag = showing its notes
async function openTagsPage(tag){
  tagsPageTag = tag || null;
  document.getElementById('tagsPage').classList.add('open');
  await renderTagsPage();
}
function closeTagsPage(){
  document.getElementById('tagsPage').classList.remove('open');
}
// Opens a note scrolled to where a #tag actually sits, with every occurrence
// highlighted and the find bar's ↑/↓ ready to step between them. Built on the
// find bar rather than a separate scroll-to mechanism so highlighting,
// stepping and dismissing all behave exactly as they already do.
async function openNoteAtTag(id, tagKey){
  await openReader(id);
  if(curId !== id || curType !== 'markdown') return;
  findCase = false;
  const cb = document.getElementById('findCaseBtn');
  cb.classList.remove('active'); cb.setAttribute('aria-pressed', 'false');
  document.getElementById('findInput').value = '#' + tagKey;
  findTagExact = true;
  openFindBar(true);
  // Whole-tag mode found nothing (e.g. the tag is glued to other characters
  // in the text): retry as a plain substring so the jump still lands somewhere.
  if(!findHits.length){ findTagExact = false; findRefresh(); }
  goToFindMatch();
}
// Palette "Jump to #tag": one note has it -> go straight to the tag inside
// that note; several -> you have to pick which note, so show the Tags page.
function jumpToTag(tagKey, items){
  if(items.length === 1) openNoteAtTag(items[0].id, tagKey);
  else openTagsPage(tagKey);
}
async function renderTagsPage(){
  const index = await buildTagIndex();
  const titleEl = document.getElementById('tagsPageTitle');
  const body = document.getElementById('tagsPageBody');

  if(!tagsPageTag){
    titleEl.textContent = 'Tags';
    if(!index.size){
      body.innerHTML = `<div class="empty"><div class="serif">No tags yet</div>
        <div>Type "#" followed by a word anywhere in a note to tag it — tagged notes will show up here.</div></div>`;
      return;
    }
    const entries = [...index.entries()].sort((a,b)=>
      b[1].items.length - a[1].items.length || a[0].localeCompare(b[0]));
    body.innerHTML = `<div class="tag-cloud">` + entries.map(([key, v])=>
      `<button type="button" class="tag-chip" data-tag="${escapeHtml(key)}">#${escapeHtml(v.display)}<span class="tag-count">${v.items.length}</span></button>`
    ).join('') + `</div>`;
    body.querySelectorAll('.tag-chip').forEach(btn=>{
      btn.onclick = ()=>{ tagsPageTag = btn.dataset.tag; renderTagsPage(); };
    });
    return;
  }

  const entry = index.get(tagsPageTag);
  titleEl.textContent = '#' + (entry ? entry.display : tagsPageTag);
  const backBtnHtml = `<button type="button" class="tag-back" id="tagBackBtn">&larr; All tags</button>`;
  if(!entry || !entry.items.length){
    body.innerHTML = backBtnHtml + `<div class="empty"><div class="serif">No notes with this tag anymore</div></div>`;
  } else {
    const items = entry.items.slice().sort((a,b)=>a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
    body.innerHTML = backBtnHtml + `<div class="shelf">` + items.map(it=>
      `<div class="spine tag-result-row" data-id="${escapeHtml(it.id)}" style="--t:var(--md);">
        <div class="meta"><div class="title">${escapeHtml(it.title)}</div>
        <div class="sub">${escapeHtml(it.category || 'Uncategorized')}</div></div>
      </div>`
    ).join('') + `</div>`;
    body.querySelectorAll('.tag-result-row').forEach(row=>{
      const tagForRow = tagsPageTag;
      row.onclick = ()=>{ closeTagsPage(); openNoteAtTag(row.dataset.id, tagForRow); };
    });
  }
  document.getElementById('tagBackBtn').onclick = ()=>{ tagsPageTag = null; renderTagsPage(); };
}

// ---- Linking a note to an audio item, or to another note, already on
// the shelf ----
// Inserts a `[Title](shelf://<id>)` link at the note editor's cursor; render
// turns that into an inline player (audio target), a note-jump widget (note
// target), or a PDF-jump widget (pdf target, v1.26.0) rather than a plain
// outgoing link. Shares one overlay/list markup between all three kinds —
// only the picker's title and the item filter differ.
let mdLinkCursor = null;
async function openAudioLinkPicker(){ return openLinkPicker('audio'); }
async function openNoteLinkPicker(){ return openLinkPicker('markdown'); }
async function openPdfLinkPicker(){ return openLinkPicker('pdf'); }
const LINK_PICKER_LABELS = {
  audio: { title: 'Link a recording', empty: 'No recordings' },
  markdown: { title: 'Link a note', empty: 'No other notes' },
  pdf: { title: 'Link a PDF', empty: 'No PDFs' },
};
async function openLinkPicker(kind){
  const ta = document.getElementById('mdEditArea');
  mdLinkCursor = { start: ta.selectionStart, end: ta.selectionEnd };
  // A note can't usefully link to itself, so it's excluded from its own
  // note-link picker (there's nothing wrong with the audio/pdf pickers ever
  // matching curId — an item can't be both types at once).
  const items = (await getAll()).filter(it=>it.type === kind && it.id !== curId);
  const list = document.getElementById('audioLinkList');
  const titleEl = document.getElementById('audioLinkTitle');
  const labels = LINK_PICKER_LABELS[kind] || LINK_PICKER_LABELS.markdown;
  if(titleEl) titleEl.textContent = labels.title;
  if(!items.length){
    list.innerHTML = `<div class="alink-empty">${labels.empty} on your shelf yet — add one first, then come back here to link it into this note.</div>`;
  } else {
    items.sort((a,b)=>(a.category||'').localeCompare(b.category||'') || a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
    list.innerHTML = items.map(it=>`
      <button class="alink-row" data-id="${escapeHtml(it.id)}" data-title="${escapeHtml(it.title)}">
        <span class="alink-title">${escapeHtml(it.title)}</span>
        <span class="alink-cat">${escapeHtml(it.category || 'Uncategorized')}</span>
      </button>`).join('');
    list.querySelectorAll('.alink-row').forEach(btn=>{
      btn.onclick = ()=>insertShelfLink(btn.dataset.id, btn.dataset.title);
    });
  }
  document.getElementById('audioLinkOverlay').style.display = 'flex';
}
function closeAudioLinkPicker(){
  document.getElementById('audioLinkOverlay').style.display = 'none';
}

// ---- Markdown formatting help (the ? toolbar button, v1.27.0) ----
// The content is static HTML in index.html (#mdHelpOverlay .help-body), not
// run through renderMarkdown() — it's meant to show the syntax itself (e.g.
// the literal text "**bold**") side by side with the already-rendered
// result, which isn't something a markdown renderer can produce from its own
// output. No network fetch, no separate file: fully consistent with the rest
// of the app being offline-only.
//
// Two ways to show it (v1.36.0). Outside the editor (command palette) it is
// the modal overlay, as before. While editing it is a DOCKED panel instead —
// above the toolbar on narrow screens, beside the text on wide ones — so it
// stays on screen while you type; a modal would cover the very text you are
// trying to format. The dock is a clone of the overlay's .help-body, so
// there is still exactly one copy of the content to maintain.
let helpDockWanted = false; // remembered for the app session: once opened, it reopens in the next edit
function isHelpDockOpen(){
  const w = document.getElementById('mdEditWrap');
  return !!w && w.classList.contains('help-open');
}
function syncHelpToggleBtn(){
  const b = document.getElementById('helpToggleBtn');
  if(!b) return;
  const on = isHelpDockOpen();
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function ensureHelpDock(){
  let dock = document.getElementById('mdHelpDock');
  if(dock) return dock;
  const wrap = document.getElementById('mdEditWrap');
  dock = document.createElement('div');
  dock.id = 'mdHelpDock';
  dock.className = 'help-dock';
  dock.innerHTML = '<div class="help-dock-head"><span>Markdown formatting help</span>'
    + '<button type="button" class="help-dock-close" onclick="closeHelpDock()" aria-label="Close help">&times;</button></div>';
  dock.appendChild(document.querySelector('#mdHelpOverlay .help-body').cloneNode(true));
  wrap.insertBefore(dock, wrap.querySelector('.ebar'));
  return dock;
}
function openHelpDock(){
  if(!noteEditActive()) return;
  ensureHelpDock();
  document.getElementById('mdEditWrap').classList.add('help-open');
  helpDockWanted = true;
  syncHelpToggleBtn();
}
function closeHelpDock(){
  const w = document.getElementById('mdEditWrap');
  if(w) w.classList.remove('help-open');
  helpDockWanted = false;
  syncHelpToggleBtn();
}
// Always opens (idempotent) — used by the command palette entry.
function openMarkdownHelp(){
  if(noteEditActive()) openHelpDock();
  else document.getElementById('mdHelpOverlay').style.display = 'flex';
}
// The editor's ? button: a real toggle, since the dock stays on screen.
function toggleMarkdownHelp(){
  if(noteEditActive() && isHelpDockOpen()) closeHelpDock();
  else openMarkdownHelp();
}
// Search box at the top of the help (v1.41.0). Inline oninput on the input, and
// it finds its own .help-body via closest(), so it works identically in the
// overlay and in the docked clone (no ids that would be duplicated).
// Every word must appear somewhere in a card (folded "More details" text
// counts); matching cards are shown with their folded parts opened.
function filterHelp(input){
  const body = input.closest('.help-body');
  if(!body) return;
  const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  body.querySelectorAll('.hcard').forEach(card=>{
    const text = card.textContent.toLowerCase();
    const hit = terms.every(w => text.includes(w));
    card.style.display = hit ? '' : 'none';
    if(hit) shown++;
    card.querySelectorAll('details.hc-more').forEach(d=>{ d.open = terms.length > 0 && hit; });
  });
  const none = body.querySelector('.help-none');
  if(none) none.style.display = shown ? 'none' : '';
}
function closeMarkdownHelp(){
  document.getElementById('mdHelpOverlay').style.display = 'none';
}

function insertShelfLink(id, title){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  // Square brackets in the title would break the [label] part of the link
  // syntax — strip them from the inserted label only, the stored item title
  // itself is untouched.
  const { start, end } = mdLinkCursor || { start: ta.value.length, end: ta.value.length };
  // v1.46.2: if text was selected when the picker opened, the selection
  // becomes the link label (select "meeting notes" -> [meeting notes](shelf://id))
  // instead of being overwritten by the target's title. A selection that
  // spans lines can't be a link label, so it falls back to the title.
  const sel = start !== end ? ta.value.slice(start, end) : '';
  const useSel = sel.trim() && !sel.includes('\n');
  const safeLabel = (useSel ? sel.trim() : title).replace(/[[\]]/g,'');
  const markdown = `[${safeLabel}](shelf://${id})`;
  ta.value = ta.value.slice(0, start) + markdown + ta.value.slice(end);
  closeAudioLinkPicker();
  ta.focus();
  const newPos = start + markdown.length;
  ta.setSelectionRange(newPos, newPos);
}

// ---- [[Wiki link]] autocomplete ----
// Triggered by typing "[[" in the note editor: a small dropdown of matching
// item titles appears, filtered as you keep typing, navigable with
// Arrow/Enter/Tab/Escape. Distinct from the 🔗 picker above (openLinkPicker)
// — that inserts a `[Title](shelf://<id>)` link via button + full-list
// overlay; this is the lighter, type-to-filter Obsidian-style flow that
// resolves by title at render time (see renderMarkdown) rather than
// freezing to an id the moment it's inserted.
let wikiAC = { open:false, start:-1, items:[], activeIndex:0 };
let wikiACToken = 0;
function closeWikiAutocomplete(){
  wikiACToken++; // invalidate any in-flight query, so it can't land after this
  wikiAC.open = false;
  const el = document.getElementById('wikiAutocomplete');
  if(el) el.remove();
}
async function updateWikiAutocomplete(){
  const ta = document.getElementById('mdEditArea');
  if(!ta) return;
  const pos = ta.selectionStart;
  const value = ta.value;
  // Only the current line, only up to the caret — an already-closed [[..]]
  // earlier in the line (or note) has both brackets and so can't satisfy
  // this pattern, meaning it can never re-open the dropdown.
  const lineStart = value.lastIndexOf('\n', pos-1) + 1;
  const beforeCaret = value.slice(lineStart, pos);
  const m = beforeCaret.match(/\[\[([^\[\]|]*)$/);
  if(!m){ closeWikiAutocomplete(); return; }
  const query = m[1].toLowerCase();
  const start = lineStart + (beforeCaret.length - m[0].length);
  const myToken = ++wikiACToken;
  const items = (await getAll())
    .filter(it => it.title && it.title.toLowerCase().includes(query))
    .sort((a,b)=>{
      const aStarts = a.title.toLowerCase().startsWith(query), bStarts = b.title.toLowerCase().startsWith(query);
      if(aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'});
    })
    .slice(0, 8);
  // A faster, later keystroke (or a blur/close) may have already moved on
  // while getAll() was resolving — drop this stale result rather than
  // showing it after the fact.
  if(myToken !== wikiACToken) return;
  if(document.getElementById('mdEditArea') !== ta) return;
  wikiAC = { open:true, start, items, activeIndex:0 };
  renderWikiAutocomplete();
}
function renderWikiAutocomplete(){
  const ta = document.getElementById('mdEditArea');
  let el = document.getElementById('wikiAutocomplete');
  if(!wikiAC.open || !wikiAC.items.length){ if(el) el.remove(); return; }
  if(!el){
    el = document.createElement('div');
    el.id = 'wikiAutocomplete';
    el.className = 'wiki-ac';
    document.body.appendChild(el);
  }
  el.innerHTML = wikiAC.items.map((it,i)=>`
    <div class="wiki-ac-row${i===wikiAC.activeIndex ? ' active' : ''}" data-i="${i}">
      <span class="wiki-ac-title">${escapeHtml(it.title)}</span>
      <span class="wiki-ac-cat">${escapeHtml(it.category || 'Uncategorized')}</span>
    </div>`).join('');
  el.querySelectorAll('.wiki-ac-row').forEach(row=>{
    // mousedown (not click) + preventDefault so picking a row never blurs
    // the textarea first — a blur would otherwise close this dropdown out
    // from under the click before it registers.
    row.onmousedown = (e)=>{ e.preventDefault(); selectWikiAutocomplete(Number(row.dataset.i)); };
  });
  positionWikiAutocomplete(ta, el);
}
// Mirrors the textarea's own text-affecting styles into a hidden div holding
// the text up to the caret, then reads that div's trailing span's offset —
// the standard "textarea caret coordinates" trick, since neither the DOM nor
// CSS otherwise exposes where a caret actually sits inside a <textarea>.
function caretPixelPosition(ta, pos){
  const div = document.createElement('div');
  const cs = window.getComputedStyle(ta);
  ['boxSizing','width','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing',
   'paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderLeftWidth',
   'whiteSpace','wordWrap'].forEach(p=>{ div.style[p] = cs[p]; });
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.height = 'auto';
  document.body.appendChild(div);
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos) || '.';
  div.appendChild(span);
  const top = span.offsetTop, left = span.offsetLeft;
  document.body.removeChild(div);
  return { top, left, lineHeight: parseInt(cs.lineHeight) || 20 };
}
function positionWikiAutocomplete(ta, el){
  const rect = ta.getBoundingClientRect();
  const caret = caretPixelPosition(ta, wikiAC.start);
  const top = rect.top - ta.scrollTop + caret.top + caret.lineHeight + 4;
  const left = rect.left - ta.scrollLeft + caret.left;
  el.style.top = Math.min(top, window.innerHeight - 60) + 'px';
  el.style.left = Math.min(left, window.innerWidth - 240) + 'px';
  el.style.width = '220px';
}
function selectWikiAutocomplete(i){
  const item = wikiAC.items[i];
  if(!item) return;
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, wikiAC.start);
  const after = ta.value.slice(pos);
  const insertion = `[[${item.title.replace(/[[\]]/g,'')}]]`;
  ta.value = before + insertion + after;
  const newPos = before.length + insertion.length;
  ta.focus();
  ta.setSelectionRange(newPos, newPos);
  closeWikiAutocomplete();
}
function onNoteEditInput(){ updateWikiAutocomplete(); noteTypingForUndo(); }
// ---- Editor keyboard aids (v1.40.0) ----
// List / quote continuation on Enter, Tab inside list lines, and the
// Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl+Alt+H shortcuts.
//
// NOTE_LIST_RE matches exactly the line prefixes renderMarkdown understands:
//   groups: 1 indent, 2 bullet char (- or *), 3 task box "[ ] ", 4 ordered
//   number, 5 quote marker. (Not "+" bullets or "1)" — the renderer doesn't
//   treat those as lists, so continuing them would just add stray text.)
const NOTE_LIST_RE = /^(\s*)(?:([-*])\s+(\[[ xX]\]\s+)?|(\d+)\.\s+|(>)[ \t]?)/;
let noteEnterBusy = false;   // guards against our own edit re-triggering beforeinput
let noteTabFree = false;     // Esc pressed → the next Tab in a list moves focus normally
function noteLineBounds(v, pos){
  const ls = pos ? v.lastIndexOf('\n', pos - 1) + 1 : 0;
  let le = v.indexOf('\n', pos); if(le === -1) le = v.length;
  return { ls, le };
}
// Odd number of ``` before the line → the line is inside a fenced code block,
// where "- foo" / "1. foo" are literal code and must not be auto-continued.
function noteInCodeFence(v, lineStart){
  return ((v.slice(0, lineStart).match(/```/g) || []).length % 2) === 1;
}
// Replace [from,to) with text as ONE undoable step. Goes through
// execCommand so the browser also fires a real `input` event (draft autosave,
// wiki autocomplete, undo debounce all keep working) and keeps the caret in
// view; falls back to setRangeText + a synthetic input event where
// execCommand is unavailable.
function noteReplaceRange(ta, from, to, text){
  pushUndoBeforeEdit();
  ta.focus();
  ta.setSelectionRange(from, to);
  noteEnterBusy = true;
  let ok = false;
  try{ ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete'); }
  catch(err){ ok = false; }
  noteEnterBusy = false;
  if(!ok){
    ta.setRangeText(text, from, to, 'end');
    ta.dispatchEvent(new Event('input', { bubbles:true }));
  }
}
// Enter is handled on `beforeinput`, not keydown: soft keyboards (Gboard etc.)
// often report keydown as key "Unidentified"/keyCode 229, and an IME that is
// mid-composition must be left alone — beforeinput's inputType tells us
// reliably that a real line break is being inserted.
function onNoteEditBeforeInput(e){
  if(noteEnterBusy || e.isComposing) return;
  if(e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  if(wikiAC.open && wikiAC.items.length) return;
  const ta = e.target;
  if(ta.selectionStart !== ta.selectionEnd) return;
  const v = ta.value, pos = ta.selectionStart;
  const { ls, le } = noteLineBounds(v, pos);
  const line = v.slice(ls, le);
  const m = line.match(NOTE_LIST_RE);
  if(!m || pos - ls < m[0].length) return;        // not a list line, or caret is inside the marker
  if(noteInCodeFence(v, ls)) return;
  e.preventDefault();
  // Enter on an empty item ends the list: clear the line instead of adding another.
  if(!line.slice(m[0].length).trim() && pos === le){
    noteReplaceRange(ta, ls, le, '');
    return;
  }
  let prefix;
  if(m[5]) prefix = m[1] + '> ';
  else if(m[4]) prefix = m[1] + (parseInt(m[4], 10) + 1) + '. ';
  else prefix = m[1] + m[2] + ' ' + (m[3] ? '[ ] ' : '');   // a new task starts unchecked
  noteReplaceRange(ta, pos, pos, '\n' + prefix);
}
// Tab / Shift+Tab in the editor (v1.45.0: any line, not just list lines):
// keep focus in the textarea and indent / outdent by two spaces.
//  - multi-line selection: every selected line is indented / outdented
//  - list line (or a single-line selection, or Shift+Tab): the LINE is
//    indented / outdented, caret stays put relative to the text
//  - any other line, no selection, Tab: two spaces are inserted at the caret
// (Reading view shows the indent as left spacing since v1.45.1; lists are still
// flat <ul>/<ol>, and the indent is kept in the text for export.) Esc → Tab always lets focus out, so it
// is never a keyboard trap. Returns true if the key was handled.
function noteTabInList(e){
  const ta = e.target, v = ta.value, pos = ta.selectionStart, end = ta.selectionEnd;
  if(noteTabFree){ noteTabFree = false; return false; }
  const shift = e.shiftKey;
  const unindent = ln => { const m = ln.match(/^( {1,2}|\t)/); return m ? m[0].length : 0; };
  e.preventDefault();
  if(v.slice(pos, end).includes('\n')){
    const ls = noteLineBounds(v, pos).ls;
    const lastPos = (end > pos && v[end - 1] === '\n') ? end - 1 : end;   // selection ended at a line start → that line isn't included
    const le = noteLineBounds(v, lastPos).le;
    let first = 0, total = 0;
    const out = v.slice(ls, le).split('\n').map((ln, i) => {
      const d = shift ? -unindent(ln) : (ln.trim() ? 2 : 0);
      if(i === 0) first = d;
      total += d;
      return shift ? ln.slice(-d) : (d ? '  ' + ln : ln);
    });
    noteReplaceRange(ta, ls, le, out.join('\n'));
    ta.setSelectionRange(Math.max(ls, pos + first), Math.max(ls, end + total));
    return true;
  }
  const { ls, le } = noteLineBounds(v, pos);
  const line = v.slice(ls, le);
  const m = line.match(NOTE_LIST_RE);
  const isList = !!(m && !m[5]);
  if(!shift && pos === end && !isList){         // plain line: just insert two spaces at the caret
    noteReplaceRange(ta, pos, pos, '  ');
    return true;
  }
  if(!shift){
    noteReplaceRange(ta, ls, ls, '  ');
    ta.setSelectionRange(pos + 2, end + 2);
  } else {
    const k = unindent(line);
    if(!k) return true;
    noteReplaceRange(ta, ls, ls + k, '');
    ta.setSelectionRange(Math.max(ls, pos - k), Math.max(ls, end - k));
  }
  return true;
}
function onNoteEditKeydown(e){
  const isUndoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  const isRedoKey = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));
  if(isUndoKey && !(wikiAC.open && wikiAC.items.length)){ e.preventDefault(); undoEdit(); return; }
  if(isRedoKey && !(wikiAC.open && wikiAC.items.length)){ e.preventDefault(); redoEdit(); return; }
  // Formatting shortcuts — same toggles as the toolbar buttons.
  if((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey){
    const k = e.key.toLowerCase();
    if(k === 'b'){ e.preventDefault(); toggleBoldAtSelection(); return; }
    if(k === 'i'){ e.preventDefault(); toggleItalicAtSelection(); return; }
  }
  // Ctrl+Alt+H (Ctrl+Option+H on Mac): heading toggle. Cmd/Ctrl+H and
  // Ctrl+Shift+H are taken by browsers, hence the Alt combo.
  if(e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyH'){ e.preventDefault(); toggleHeadingAtLine(); return; }
  const acOpen = wikiAC.open && wikiAC.items.length;
  if(e.key === 'Tab' && !acOpen && !e.ctrlKey && !e.metaKey && !e.altKey){ if(noteTabInList(e)) return; }
  if(e.key === 'Escape' && !acOpen) noteTabFree = true;
  else if(!['Tab','Shift','Control','Alt','Meta'].includes(e.key)) noteTabFree = false;
  if(!wikiAC.open || !wikiAC.items.length) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); wikiAC.activeIndex = (wikiAC.activeIndex+1) % wikiAC.items.length; renderWikiAutocomplete(); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); wikiAC.activeIndex = (wikiAC.activeIndex-1+wikiAC.items.length) % wikiAC.items.length; renderWikiAutocomplete(); }
  else if(e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); selectWikiAutocomplete(wikiAC.activeIndex); }
  else if(e.key === 'Escape'){ e.preventDefault(); closeWikiAutocomplete(); }
}


// Scans every OTHER note's raw markdown for a shelf://<thisId> reference and
// lists whoever links here, appended under the note body. This has to
// decrypt every other note's content to search it — the same cost the
// v1.7.0 search box deliberately avoided paying on every keystroke — but
// here it only runs once per note-open (or note-save), not per keystroke,
// so the trade-off is different. Purely additive: nothing is written back,
// this only reads.
async function renderBacklinks(id, mountEl){
  document.querySelectorAll('.backlinks-section').forEach(el=>el.remove());
  const others = (await getAll()).filter(it=>it.type === 'markdown' && it.id !== id);
  if(!others.length) return;
  const linkRe = new RegExp(`\\]\\(shelf://${id}\\)`);
  const linkedFrom = [];
  for(const meta of others){
    let full;
    try{ full = await getOne(meta.id); } catch(err){ continue; } // skip unreadable/corrupt entries rather than aborting the whole scan
    if(full && full.content && linkRe.test(full.content)) linkedFrom.push(full);
  }
  if(!linkedFrom.length) return;
  linkedFrom.sort((a,b)=>a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}));
  const section = document.createElement('div');
  section.className = 'backlinks-section';
  section.innerHTML = `<div class="backlinks-label">Linked from</div>`
    + linkedFrom.map(n=>`<button class="backlink-row" data-id="${escapeHtml(n.id)}">${escapeHtml(n.title)}</button>`).join('');
  section.querySelectorAll('.backlink-row').forEach(btn=>{
    btn.onclick = ()=>openReader(btn.dataset.id);
  });
  mountEl.appendChild(section);
}

// ---- Copy button on fenced code blocks ----
// Reads straight from the rendered <code> element's textContent rather than
// keeping a separate raw copy anywhere — the browser has already turned any
// escaped entities (&lt; etc.) back into their literal characters by the
// time this runs, so it's just the original code, verbatim.
async function copyCodeBlock(btn){
  const codeEl = btn.closest('.code-block').querySelector('code');
  const text = codeEl.textContent;
  try{
    await navigator.clipboard.writeText(text);
  } catch(err){
    // Clipboard API can be unavailable (e.g. a non-secure context) — fall
    // back to the old select-and-execCommand trick.
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); } catch(e2){ /* best-effort only */ }
    document.body.removeChild(ta);
  }
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(()=>{ btn.textContent = original; btn.classList.remove('copied'); }, 1500);
}

// ---- Inserting a picture into a note ----
// Embedded directly as a resized/compressed data: URI right in the note's
// own (encrypted) markdown text — same idea as the item cover image, just
// bigger, since here it's meant to be read rather than shown as a thumbnail.
// That keeps a note fully self-contained: it survives export/import and
// doesn't break if some other shelf item is later deleted or renamed, unlike
// a shelf://<id> link would. The full data URI never actually appears in the
// textarea itself, though — it's added to curNoteImageRefs and only a short
// `img:N` placeholder is inserted; see collapseImagesForEdit/
// expandImagesForSave above for how that round-trips through Save.
async function onNoteImagePick(e){
  const f = e.target.files[0];
  e.target.value = '';
  await insertNoteImageFile(f);
}
// Shared by the 📷 file picker above and the clipboard-paste handler below —
// both end up with a plain File/Blob to resize and drop into the note the
// same way, so the actual insert logic only needs to live once.
async function insertNoteImageFile(f){
  if(!f) return;
  let dataUrl;
  try{ dataUrl = await resizeCoverImage(f, 900, 0.82); }
  catch(err){ alert("Couldn't use that image \u2014 try a different file."); return; }
  curNoteImageRefs.push(dataUrl);
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const md = `![image ${curNoteImageRefs.length}](img:${curNoteImageRefs.length})\n`;
  ta.value = ta.value.slice(0, start) + md + ta.value.slice(end);
  ta.focus();
  const newPos = start + md.length;
  ta.setSelectionRange(newPos, newPos);
}
// Ctrl+V (desktop) or the long-press "Paste" menu (mobile) on the note
// textarea — if the clipboard is carrying an image (e.g. a screenshot copied
// straight from the OS, not saved to a file first), insert it the same way
// the 📷 button does instead of pasting nothing/garbage. Falls through to the
// browser's normal text paste when the clipboard has no image on it.
function onNoteEditPaste(e){
  const items = e.clipboardData && e.clipboardData.items;
  if(!items) return;
  for(const item of items){
    if(item.kind === 'file' && item.type && item.type.startsWith('image/')){
      e.preventDefault();
      insertNoteImageFile(item.getAsFile());
      return;
    }
  }
}

// Dragging picture files from the OS file manager onto the note textarea
// (v1.44.0) — same insert path as paste and the 📷 button. Without these
// handlers the browser's default for a dropped file is to navigate away to it,
// which would throw away the open editor. So ANY file drag is claimed here;
// non-pictures are refused with a message instead. While dragging, only the
// item kinds/types are readable (not the files), so dragover just checks for
// "Files". The picture goes in at the caret's last position (a textarea gives
// no way to map the drop point to a text offset), one after another if
// several files are dropped.
function dragHasFiles(e){ return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')); }
function onNoteEditDragOver(e){
  if(!dragHasFiles(e)) return;              // plain text drags keep the browser's own behaviour
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('drag-over');
}
function onNoteEditDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }
const NOTE_AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|weba|webm)$/i;
function isDroppedAudio(f){ return (f.type && f.type.startsWith('audio/')) || NOTE_AUDIO_EXT.test(f.name || ''); }
// Dropping an audio file (v1.46.1): the recording is embedded IN THE NOTE,
// exactly like a dropped picture — no shelf item is created. It is read as a
// data: URI, kept in curNoteAudioRefs, and only a short `[name](aud:N)`
// placeholder goes in the textarea; Save expands it back to the real
// `[name](data:audio/...)` link (see collapseImagesForEdit /
// expandImagesForSave), and reading view renders that as a native player.
// Audio is much bigger than a resized picture and cannot be shrunk, so each
// file is capped at NOTE_AUDIO_MAX; longer recordings belong on the shelf
// (+ Add) and can be linked with the toolbar button.
const NOTE_AUDIO_MAX = 15 * 1024 * 1024;
function readFileAsDataUrl(f){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
    r.readAsDataURL(f);
  });
}
async function insertNoteAudioFile(f){
  if(f.size > NOTE_AUDIO_MAX){
    alert(`"${f.name}" is ${(f.size / 1048576).toFixed(1)} MB \u2014 too big to embed in a note (limit ${NOTE_AUDIO_MAX / 1048576} MB). Add it to your shelf with + Add instead, then link it with the \u{1F3B5} toolbar button.`);
    return false;
  }
  let dataUrl;
  try{ dataUrl = await readFileAsDataUrl(f); }
  catch(err){ alert("Couldn't read that audio file \u2014 try a different file."); return false; }
  // Some browsers leave the MIME type off for less common extensions
  // ("data:application/octet-stream;..."), which would not render as audio.
  if(!/^data:audio\//i.test(dataUrl)){
    const ext = ((f.name || '').match(/\.(\w+)$/) || [])[1];
    dataUrl = dataUrl.replace(/^data:[^;,]*/, 'data:' + (f.type && f.type.startsWith('audio/') ? f.type : 'audio/' + (ext ? ext.toLowerCase() : 'mpeg')));
  }
  curNoteAudioRefs.push(dataUrl);
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const label = ((f.name || 'Recording').replace(/\.[^.]+$/, '') || 'Recording').replace(/[[\]]/g, '');
  const md = `[${label}](aud:${curNoteAudioRefs.length})\n`;
  ta.value = ta.value.slice(0, start) + md + ta.value.slice(end);
  ta.focus();
  const newPos = start + md.length;
  ta.setSelectionRange(newPos, newPos);
  ta.dispatchEvent(new Event('input', { bubbles:true }));   // draft autosave, undo grouping
  return true;
}
async function onNoteEditDrop(e){
  if(!dragHasFiles(e)) return;
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files || []);
  let used = 0;
  for(const f of files){
    if(f.type && f.type.startsWith('image/')){ await insertNoteImageFile(f); used++; }
    else if(isDroppedAudio(f)){ if(await insertNoteAudioFile(f)) used++; }
  }
  if(!used) alert('Only picture or audio files can be dropped into a note.');
  else if(used < files.length) alert('Some dropped files were skipped \u2014 only pictures and audio can be added to a note.');
}

// ---- Inserting a table template into a note ----
// Drops a ready-to-edit pipe table at the cursor rather than trying to offer
// a real table-editing UI in a plain <textarea> — the person fills in / adds
// rows and columns as plain markdown text, same as they would in Obsidian or
// any other markdown editor. renderMarkdown() below is what turns this
// syntax back into an actual <table> in the read view.
// ---- Bold / heading toolbar buttons ----
// For people who don't already know Markdown syntax by heart: wraps the
// current selection in ** ** (or, with nothing selected, drops an empty
// **bold text** placeholder with the words pre-selected so typing replaces
// them, same as most rich editors do for an empty bold toggle).
function toggleBoldAtSelection(){ toggleWrapAtSelection('**', 'bold text'); }
function toggleItalicAtSelection(){ toggleWrapAtSelection('*', 'italic text'); }
// ---- Strikethrough / highlight toolbar buttons (v1.33.0) ----
// Same idea as the Bold button, but a real on/off toggle: tapping again on
// text that is already wrapped removes the delimiters (whether the selection
// is just the inside, or includes them). Two details come from the renderer
// (applyInlineMarks): the text between delimiters may not start or end with
// a space, so surrounding whitespace in the selection (a double-tap often
// grabs the trailing space) is kept OUTSIDE the delimiters; and a mark never
// spans a line break, so a multi-line selection is wrapped line by line,
// leaving any list / checkbox / quote / heading prefix in front —
// "- [ ] buy milk" becomes "- [ ] ~~buy milk~~", which still renders as a
// checklist item. With nothing selected it drops a placeholder with the
// words pre-selected, like Bold.
const MARK_LINE_PREFIX = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|#{1,6}\s+)?/;
function markSplitLine(line){
  const prefix = line.match(MARK_LINE_PREFIX)[0];
  const m = line.slice(prefix.length).match(/^(\s*)([\s\S]*?)(\s*)$/);
  return { prefix, lead: m[1], inner: m[2], trail: m[3] };
}
// Bold ("**") and italic ("*") share a character, so a plain startsWith/
// endsWith check can't tell them apart: "**x**" would look italic-wrapped.
// Compare the RUNS of stars instead — italic is present when the shorter run
// is odd (1 or 3, as in "***x***"), bold when it is 2 or more.
function starRun(v, pos, dir){
  let c = 0;
  while(v[dir < 0 ? pos - 1 - c : pos + c] === '*') c++;
  return c;
}
function starDelimPresent(d, before, after){
  const m = Math.min(before, after);
  return d === '**' ? m >= 2 : (m % 2 === 1);
}
function markInnerIsWrapped(inner, d){
  if(d[0] === '*'){
    if(!/[^*]/.test(inner)) return false;
    const lead = inner.length - inner.replace(/^\*+/, '').length;
    const trail = inner.length - inner.replace(/\*+$/, '').length;
    return starDelimPresent(d, lead, trail);
  }
  return inner.length > 2*d.length && inner.startsWith(d) && inner.endsWith(d);
}
function toggleWrapAtSelection(d, placeholder){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const v = ta.value, start = ta.selectionStart, end = ta.selectionEnd, n = d.length;
  const sel = v.slice(start, end);
  if(sel.includes('\n')){
    const ls = start ? v.lastIndexOf('\n', start - 1) + 1 : 0;
    let le = v.indexOf('\n', end); if(le === -1) le = v.length;
    const parts = v.slice(ls, le).split('\n').map(l => ({ l, ...markSplitLine(l) }));
    const live = parts.filter(x => x.inner);
    const allWrapped = live.length > 0 && live.every(x => markInnerIsWrapped(x.inner, d));
    const out = parts.map(x=>{
      if(!x.inner) return x.l;
      if(allWrapped) return x.prefix + x.lead + x.inner.slice(n, -n) + x.trail;
      if(markInnerIsWrapped(x.inner, d)) return x.l;
      return x.prefix + x.lead + d + x.inner + d + x.trail;
    }).join('\n');
    ta.value = v.slice(0, ls) + out + v.slice(le);
    ta.focus();
    ta.setSelectionRange(ls, ls + out.length);
    return;
  }
  const m = sel.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const inner = m[2];
  if(!inner){
    ta.value = v.slice(0, end) + d + placeholder + d + v.slice(end);
    ta.focus();
    ta.setSelectionRange(end + n, end + n + placeholder.length);
    return;
  }
  const is = start + m[1].length, ie = is + inner.length;
  const surrounded = d[0] === '*'
    ? starDelimPresent(d, starRun(v, is, -1), starRun(v, ie, 1))
    : (is >= n && v.slice(is - n, is) === d && v.slice(ie, ie + n) === d);
  if(surrounded){
    ta.value = v.slice(0, is - n) + inner + v.slice(ie + n);
    ta.focus();
    ta.setSelectionRange(is - n, ie - n);
  } else if(markInnerIsWrapped(inner, d)){
    const bare = inner.slice(n, -n);
    ta.value = v.slice(0, is) + bare + v.slice(ie);
    ta.focus();
    ta.setSelectionRange(is, is + bare.length);
  } else {
    ta.value = v.slice(0, is) + d + inner + d + v.slice(ie);
    ta.focus();
    ta.setSelectionRange(is + n, is + n + inner.length);
  }
}
function toggleStrikeAtSelection(){ toggleWrapAtSelection('~~', 'strikethrough'); }
function toggleHighlightAtSelection(){ toggleWrapAtSelection('==', 'highlight'); }
// Toggles a leading "## " on the current line — tapping again on an already-
// headed line removes it rather than stacking another #, so the button
// behaves like an on/off switch rather than only ever adding more.
function toggleHeadingAtLine(){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const value = ta.value;
  const pos = ta.selectionStart;
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = value.indexOf('\n', pos);
  if(lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const existing = line.match(/^(#{1,6})\s+/);
  let newLine, delta;
  if(existing){
    newLine = line.slice(existing[0].length);
    delta = -existing[0].length;
  } else {
    newLine = '## ' + line;
    delta = 3;
  }
  ta.value = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
  ta.focus();
  const newPos = Math.max(lineStart, pos + delta);
  ta.setSelectionRange(newPos, newPos);
}
// ---- Divider / timestamp toolbar buttons ----
// A plain "---" on its own line, surrounded by blank lines so renderMarkdown
// (which splits on blank lines) sees it as its own block and turns it into
// an <hr> rather than folding it into a neighboring paragraph.
function insertDivider(){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const needsLeadingBreak = start > 0 && ta.value[start-1] !== '\n';
  const block = (needsLeadingBreak ? '\n\n' : '') + '---\n\n';
  ta.value = ta.value.slice(0, start) + block + ta.value.slice(end);
  ta.focus();
  const newPos = start + block.length;
  ta.setSelectionRange(newPos, newPos);
}
// Drops the current date/time as plain text at the cursor — handy for diary
// entries and meeting notes. Only a leading break is forced (not a trailing
// one) so jotting several timestamped lines in a row doesn't leave a blank
// paragraph between every single one.
function insertTimestamp(){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const needsLeadingBreak = start > 0 && ta.value[start-1] !== '\n';
  const stamp = new Date().toLocaleString(undefined, {
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
  });
  const insert = (needsLeadingBreak ? '\n' : '') + stamp;
  ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
  ta.focus();
  const newPos = start + insert.length;
  ta.setSelectionRange(newPos, newPos);
}
function insertTableTemplate(){
  pushUndoBeforeEdit();
  const ta = document.getElementById('mdEditArea');
  const start = ta.selectionStart, end = ta.selectionEnd;
  const needsLeadingBreak = start > 0 && ta.value[start-1] !== '\n';
  const template = (needsLeadingBreak ? '\n\n' : '')
    + '| Column 1 | Column 2 | Column 3 |\n'
    + '| --- | --- | --- |\n'
    + '| Row 1 | Row 1 | Row 1 |\n'
    + '| Row 2 | Row 2 | Row 2 |\n\n';
  ta.value = ta.value.slice(0, start) + template + ta.value.slice(end);
  ta.focus();
  const newPos = start + template.length;
  ta.setSelectionRange(newPos, newPos);
}

let bmPanelOpen = false;
function toggleBookmarkPanel(){
  settingsPanelOpen = false;
  document.getElementById('settingsPanel').style.display = 'none';
  outlinePanelOpen = false;
  document.getElementById('outlinePanel').style.display = 'none';
  bmPanelOpen = !bmPanelOpen;
  document.getElementById('bmPanel').style.display = bmPanelOpen ? 'block' : 'none';
}
// A bookmark's `idx` is only reliable until the note is next edited — adding
// or removing a paragraph above it shifts every idx below. `snippet` (the
// paragraph's own text, captured when the bookmark was made) is what
// survives that: findBlockForBookmark prefers an exact idx+snippet hit
// (nothing changed), falls back to hunting for that same text wherever it
// now lives (the paragraph just moved), then a looser prefix match (the
// paragraph was edited but still starts the same way), and only falls back
// to the stale idx — better than nothing — if none of that finds anything.
function bookmarkSnippet(el){ return el ? el.textContent.trim().slice(0,80) : ''; }
function findBlockForBookmark(bookmark){
  const blocks = Array.from(document.querySelectorAll('.mdblock'));
  const byIdx = blocks.find(el=>Number(el.dataset.idx)===bookmark.idx);
  if(byIdx && bookmarkSnippet(byIdx)===bookmark.snippet) return byIdx;
  if(bookmark.snippet){
    const bySnippet = blocks.find(el=>bookmarkSnippet(el)===bookmark.snippet);
    if(bySnippet) return bySnippet;
    const head = bookmark.snippet.slice(0, 30);
    const byPrefix = head && blocks.find(el=>el.textContent.trim().startsWith(head));
    if(byPrefix) return byPrefix;
  }
  return byIdx || null;
}
async function toggleBookmark(idx){
  const it = await getOne(curId);
  if(!it) return;
  const bookmarks = it.bookmarks || [];
  const el = document.querySelector(`.mdblock[data-idx="${idx}"]`);
  // Same fuzzy match as everywhere else, so tapping the ribbon on a spot
  // that's already bookmarked (even under a shifted idx) removes it instead
  // of adding a duplicate.
  const pos = bookmarks.findIndex(b => findBlockForBookmark(b) === el);
  if(pos>-1){
    bookmarks.splice(pos,1);
  } else {
    const snippet = bookmarkSnippet(el) || ('Paragraph '+(idx+1));
    bookmarks.push({idx, snippet, createdAt:Date.now()});
  }
  try{ await putMetaOnly(curId, { bookmarks }); }
  catch(err){ if(isQuotaError(err)) alert("Your device's storage is full, so this bookmark couldn't be saved."); return; }
  updateBookmarkUI(bookmarks);
}
async function deleteBookmark(createdAt){
  const it = await getOne(curId);
  if(!it) return;
  const bookmarks = (it.bookmarks||[]).filter(b=>b.createdAt!==createdAt);
  try{ await putMetaOnly(curId, { bookmarks }); }
  catch(err){ /* removing a bookmark frees space, extremely unlikely to fail on quota */ }
  updateBookmarkUI(bookmarks);
}
async function jumpBookmark(createdAt){
  const it = await getOne(curId);
  const bm = it && (it.bookmarks||[]).find(b=>b.createdAt===createdAt);
  const el = bm && findBlockForBookmark(bm);
  if(el){ revealBlock(el); el.scrollIntoView({block:'center', behavior:'smooth'}); }
  else if(bm) alert("Couldn't find that spot anymore — this part of the note may have changed a lot since the bookmark was made.");
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
}
function updateBookmarkUI(bookmarks){
  document.querySelectorAll('.mdblock').forEach(el=>el.classList.remove('bookmarked'));
  bookmarks.forEach(b=>{
    const el = findBlockForBookmark(b);
    if(el) el.classList.add('bookmarked');
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
      <div class="snip" onclick="jumpBookmark(${b.createdAt})">${escapeHtml(b.snippet)}</div>
      <button class="rm" onclick="event.stopPropagation();deleteBookmark(${b.createdAt})" title="Remove bookmark">&times;</button>
    </div>`).join('');
}

// ---- Outline / table of contents ----
// Auto-generated from a note's own # to ###### headings — nothing is stored;
// it's rebuilt from the live rendered DOM every time the note (re)renders,
// the same "derive it, don't persist it" approach the Tags feature uses.
// Reuses the bookmark panel's look (.bmpanel/.bmrow chrome) but each row
// jumps to a heading's .mdblock instead of a saved spot, and there's no
// per-row remove button since there's nothing to delete — the note's own
// headings ARE the outline.
let outlinePanelOpen = false;
function toggleOutlinePanel(){
  settingsPanelOpen = false;
  document.getElementById('settingsPanel').style.display = 'none';
  bmPanelOpen = false;
  document.getElementById('bmPanel').style.display = 'none';
  outlinePanelOpen = !outlinePanelOpen;
  document.getElementById('outlinePanel').style.display = outlinePanelOpen ? 'block' : 'none';
}
// container is the rendered .mdbody element — h1-h6 tags only ever
// appear as the very first thing in whatever .mdblock they belong to (see
// renderMarkdown's block classification), so each heading's own block
// carries the data-idx that jumpBookmark's scroll-to logic already uses.
function buildOutline(container){
  const outline = [];
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h=>{
    const block = h.closest('.mdblock');
    if(!block) return;
    outline.push({ idx: Number(block.dataset.idx), level: Number(h.tagName[1]), text: h.textContent.trim() });
  });
  return outline;
}
function jumpOutline(idx){
  const el = document.querySelector(`.mdblock[data-idx="${idx}"]`);
  if(el){ revealBlock(el); el.scrollIntoView({block:'center', behavior:'smooth'}); }
  outlinePanelOpen = false;
  document.getElementById('outlinePanel').style.display = 'none';
}
function updateOutlineUI(outline){
  const btn = document.getElementById('outlineBtn');
  const panel = document.getElementById('outlinePanel');
  if(!outline.length){
    btn.style.display = 'none';
    panel.style.display = 'none';
    outlinePanelOpen = false;
    return;
  }
  btn.style.display = 'flex';
  panel.innerHTML = `<div class="outline-tools"><button type="button" onclick="foldAllHeadings(true)">Collapse all</button>`
    + `<button type="button" onclick="foldAllHeadings(false)">Expand all</button></div>`
    + outline.map(o=>
    `<button type="button" class="outline-row" data-level="${o.level}" onclick="jumpOutline(${o.idx})">${escapeHtml(o.text) || '(untitled heading)'}</button>`
  ).join('');
}

// ---- Heading fold (v1.37.0) ----
// Obsidian-style: every heading (H1-H6) that has something under it gets an
// arrow at the right edge of its row; collapsing hides everything up to the
// next heading of the SAME OR HIGHER rank (so an H2 swallows its H3s, but the
// next H2 — or an H1 — ends the section). Collapse state is pure view state:
// the note text is never touched, and a heading's own text/bookmark snippet
// doesn't change either (the arrow is a CSS-drawn, text-less button).
//
// State lives in curFolds — a Set of heading keys ("level|text|nth-with-that-
// level-and-text") — and is saved per note in its encrypted metadata as
// `folds`, so a collapsed note stays collapsed next time. Keys are text-based
// so they survive edits elsewhere in the note; retitle a heading and its
// fold state is dropped (pruned on the next render). Not part of exports.
let curFolds = new Set();
function blockHeadingLevel(block){
  const h = Array.from(block.children).find(c=>/^H[1-6]$/.test(c.tagName));
  return h ? Number(h.tagName[1]) : 0;
}
function saveFoldState(){
  const id = curId;
  if(!id) return;
  // View state, like reading progress: a failed save (e.g. storage full) is silent.
  putMetaOnly(id, { folds: Array.from(curFolds) }).catch(()=>{});
}
// Recomputes which blocks are hidden from the .fold-collapsed classes. A
// collapsed heading nested inside another collapsed one keeps its own state
// (it's simply hidden too), so expanding the outer one restores the inner.
function applyFolds(container){
  let hideLevel = 0; // 0 = not inside a collapsed section
  container.querySelectorAll('.mdblock').forEach(block=>{
    const lvl = blockHeadingLevel(block);
    let hidden = false;
    if(lvl){
      if(hideLevel && lvl > hideLevel) hidden = true;
      else hideLevel = 0;
    } else if(hideLevel){
      hidden = true;
    }
    block.classList.toggle('fold-hidden', hidden);
    if(lvl && !hidden && block.classList.contains('fold-collapsed')) hideLevel = lvl;
  });
}
function setBlockFolded(block, folded){
  block.classList.toggle('fold-collapsed', folded);
  const btn = block.querySelector(':scope > .fold-btn');
  if(btn){
    btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    btn.title = folded ? 'Expand section' : 'Collapse section';
    btn.setAttribute('aria-label', btn.title);
  }
  if(block.dataset.foldKey){
    if(folded) curFolds.add(block.dataset.foldKey); else curFolds.delete(block.dataset.foldKey);
  }
}
function toggleFold(block){
  setBlockFolded(block, !block.classList.contains('fold-collapsed'));
  applyFolds(block.parentElement);
  saveFoldState();
}
function foldAllHeadings(collapse){
  const container = document.getElementById('mdView');
  if(!container) return;
  container.querySelectorAll('.mdblock.foldable').forEach(b=>setBlockFolded(b, collapse));
  applyFolds(container);
  saveFoldState();
}
// Un-hides a block that sits under a collapsed heading (outline / bookmark
// jump, find hit): opens every collapsed heading above it that governs it.
function revealBlock(block){
  if(!block || !block.classList.contains('fold-hidden')) return;
  let minLevel = blockHeadingLevel(block) || 7;
  for(let p = block.previousElementSibling; p; p = p.previousElementSibling){
    if(!p.classList.contains('mdblock')) continue;
    const lvl = blockHeadingLevel(p);
    if(lvl && lvl < minLevel){
      minLevel = lvl;
      if(p.classList.contains('fold-collapsed')) setBlockFolded(p, false);
    }
  }
  applyFolds(block.parentElement);
  saveFoldState();
}
// Called after every (re)render of a note, next to wireParagraphEdit.
function wireHeadingFold(container){
  const blocks = Array.from(container.querySelectorAll('.mdblock'));
  const seen = new Map();
  const live = new Set();
  blocks.forEach((block, i)=>{
    block.classList.remove('foldable', 'fold-collapsed', 'fold-hidden');
    const old = block.querySelector(':scope > .fold-btn');
    if(old) old.remove();
    delete block.dataset.foldKey;
    const lvl = blockHeadingLevel(block);
    if(!lvl) return;
    // Nothing under it before the next same-or-higher heading (or the end)?
    // Then there is nothing to fold, so no arrow.
    const next = blocks[i + 1];
    const nextLvl = next ? blockHeadingLevel(next) : -1;
    const hasRest = !!block.querySelector(':scope > .heading-rest');
    const hasBelow = !!next && !(nextLvl !== 0 && nextLvl <= lvl);
    if(!hasRest && !hasBelow) return;
    const h = Array.from(block.children).find(c=>/^H[1-6]$/.test(c.tagName));
    const base = lvl + '|' + h.textContent.trim().toLowerCase();
    const nth = seen.get(base) || 0;
    seen.set(base, nth + 1);
    const key = base + '|' + nth;
    block.dataset.foldKey = key;
    live.add(key);
    block.classList.add('foldable');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fold-btn';
    btn.onclick = (e)=>{ e.stopPropagation(); toggleFold(block); };
    block.appendChild(btn);
    setBlockFolded(block, curFolds.has(key));
  });
  let pruned = false;
  Array.from(curFolds).forEach(k=>{ if(!live.has(k)){ curFolds.delete(k); pruned = true; } });
  if(pruned) saveFoldState();
  applyFolds(container);
}


function closeReader(){
  flushDraftNow(); // leaving mid-edit keeps the draft (offered back next time this note is opened)
  stopDraftTimer();
  closeWikiAutocomplete();
  closeFindBar();
  document.getElementById('reader').classList.remove('open');
  if(curBlobUrl){ URL.revokeObjectURL(curBlobUrl); curBlobUrl = null; }
  if(curPdfDoc){ curPdfDoc.loadingTask.destroy(); curPdfDoc = null; }
  curPdfRenderToken++; // invalidate any render still in flight for the closed item
  curPdfPage = 1; curPdfNumPages = 0;
  curId = null; curType = null;
  updateMiniPlayer(); // the mini bar may need to reappear now that the reader isn't showing this track
  render();
}

// A block is a pipe table when its first line contains at least one `|` and
// its second line is a separator row made only of `|`, `-`, `:` and
// whitespace (with at least one dash) — the standard GFM-style table syntax
// that insertTableTemplate() inserts. Deliberately loose (doesn't check
// column counts line-to-line) to stay "minimal", matching the rest of this
// renderer.
function looksLikeTable(block){
  const lines = block.split('\n').filter(l=>l.trim());
  if(lines.length < 2) return false;
  if(!lines[0].includes('|')) return false;
  return /^[\s|:-]+$/.test(lines[1]) && lines[1].includes('-');
}
function splitTableRow(line){
  // "\|" is a literal pipe inside a cell (v1.38.0), so split on unescaped pipes only
  const cells = line.split(/(?<!\\)\|/).map(c=>c.replace(/\\\|/g, '|'));
  if(cells.length && cells[0].trim() === '') cells.shift();
  if(cells.length && cells[cells.length-1].trim() === '') cells.pop();
  return cells.map(c=>c.trim());
}
// A table cell can't hold a real line break in pipe-table syntax, so a
// multi-line cell is stored as "line one<br>line two" (v1.42.0). The note text
// is HTML-escaped before it gets here, so a typed <br> arrives as &lt;br&gt;;
// turn just that back into a real break and leave every other tag escaped.
function cellBreaks(c){ return c.replace(/&lt;br\s*\/?&gt;/gi, '<br>'); }

// ---- Merged cells (v1.43.0) ----
// Pipe tables have no spans, so two marker cells are used (the second is
// MultiMarkdown's own rowspan marker): a cell that is exactly "<<" is merged
// into the cell on its LEFT, and one that is exactly "^^" is merged into the
// cell ABOVE. Following those markers from any cell leads to its "root" (the
// real cell that holds the text); the root's colspan / rowspan is the extent
// of everything that leads back to it. "^^" in the header row or the first
// body row, and "<<" in the first column, have nothing to merge into and are
// kept as ordinary text. isL / isU test a cell's text, so the same code can
// run on raw cells (editing) and on HTML-escaped cells (rendering).
const MERGE_L = '<<', MERGE_U = '^^';
function tableSpans(grid, isL, isU){
  const at = (r, c)=>{ const v = grid[r][c]; return v == null ? '' : v; };
  const find = (r, c)=>{
    for(let g = 0; g < 2000; g++){
      const v = at(r, c);
      if(c > 0 && isL(v)) c--;
      else if(r >= 2 && c < grid[r - 1].length && isU(v)) r--;
      else break;
    }
    return [r, c];
  };
  const info = grid.map(row=>row.map(()=>null));
  const roots = grid.map((row, r)=>row.map((_, c)=>find(r, c)));
  grid.forEach((row, r)=>row.forEach((_, c)=>{
    if(roots[r][c][0] === r && roots[r][c][1] === c) info[r][c] = { covered:false, rs:1, cs:1 };
  }));
  grid.forEach((row, r)=>row.forEach((_, c)=>{
    const [rr, cc] = roots[r][c];
    if(rr === r && cc === c) return;
    info[r][c] = { covered:true };
    const f = info[rr][cc];
    f.rs = Math.max(f.rs, r - rr + 1);
    f.cs = Math.max(f.cs, c - cc + 1);
  }));
  return info;
}
const rawIsL = v => String(v == null ? '' : v).trim() === MERGE_L;
const rawIsU = v => String(v == null ? '' : v).trim() === MERGE_U;
const rawHasText = v => { const t = String(v == null ? '' : v).trim(); return !!t && t !== MERGE_L && t !== MERGE_U; };
// What can the root cell at (m,c) of a padded, rectangular raw matrix do?
// A neighbour can be merged in only if it is itself an unmerged-into root and
// lines up exactly (same rows for "right", same columns for "down"); the
// header row can't be merged downwards into the body.
function tableMergeState(matrix, m, c){
  const info = tableSpans(matrix, rawIsL, rawIsU);
  const f = info[m] && info[m][c];
  if(!f || f.covered) return null;
  let canRight = false, canDown = false, right = null, down = null;
  if(c + f.cs < matrix[m].length){ right = info[m][c + f.cs]; canRight = !!right && !right.covered && right.rs === f.rs; }
  if(m > 0 && m + f.rs < matrix.length){ down = info[m + f.rs][c]; canDown = !!down && !down.covered && down.cs === f.cs; }
  return { rs:f.rs, cs:f.cs, merged: f.rs > 1 || f.cs > 1, canRight, canDown, right, down };
}
// dir 'R' or 'D'. dry=true only reports whether text would be lost.
function tableMerge(matrix, m, c, dir, dry){
  const st = tableMergeState(matrix, m, c);
  if(!st || !(dir === 'R' ? st.canRight : st.canDown)) return { ok:false, lost:false };
  const n = dir === 'R' ? st.right : st.down;
  const r0 = dir === 'R' ? m : m + st.rs, c0 = dir === 'R' ? c + st.cs : c;
  const lost = rawHasText(matrix[r0][c0]);
  if(!dry){
    const rows = dir === 'R' ? st.rs : n.rs, cols = dir === 'R' ? n.cs : st.cs;
    for(let r = r0; r < r0 + rows; r++)
      for(let cc = c0; cc < c0 + cols; cc++) matrix[r][cc] = dir === 'R' ? MERGE_L : MERGE_U;
  }
  return { ok:true, lost };
}
function tableSplit(matrix, m, c){
  const st = tableMergeState(matrix, m, c);
  if(!st || !st.merged) return false;
  for(let r = m; r < m + st.rs; r++)
    for(let cc = c; cc < c + st.cs; cc++) if(r !== m || cc !== c) matrix[r][cc] = '';
  return true;
}
function tableToHtml(block){
  const lines = block.split('\n').filter(l=>l.trim());
  const grid = [splitTableRow(lines[0]), ...lines.slice(2).map(splitTableRow)];
  // rendering runs on HTML-escaped text, where "<<" has become "&lt;&lt;"
  const info = tableSpans(grid, v=>v === '&lt;&lt;', v=>v === '^^');
  const rowHtml = r => grid[r].map((c, ci)=>{
    const f = info[r][ci];
    if(f.covered) return '';
    const tag = r === 0 ? 'th' : 'td';
    const span = (f.cs > 1 ? ` colspan="${f.cs}"` : '') + (f.rs > 1 ? ` rowspan="${f.rs}"` : '');
    return `<${tag}${span} data-r="${r}" data-c="${ci}">${cellBreaks(c)}</${tag}>`;
  }).join('');
  const thead = `<tr>${rowHtml(0)}</tr>`;
  const tbody = grid.slice(1).map((_, i)=>`<tr>${rowHtml(i + 1)}</tr>`).join('');
  return `<div class="md-table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

// minimal markdown renderer
// linkTypes: optional {id: type} map (from buildLinkTypeMap()) used to tell
// a shelf://<id> link's target type apart at render time — renderMarkdown
// itself never touches IndexedDB, so callers that want shelf:// links to
// render correctly must build and pass this first. An id missing from the
// map (deleted item, or map omitted entirely) renders as the generic jump
// widget rather than an audio player, since a dead link can't play anything
// anyway — the click handler wired in later (wireNoteLinks/wireInlineAudio)
// is what actually reports "no longer on your shelf" once the user taps it.
// Icon shown on a generic (non-audio) shelf://<id> jump widget, matched to
// the type colors/emoji used elsewhere in the app (shelf rows, Add sheet).
// 'markdown' keeps the pre-v1.26.0 look (a plain note-link always rendered
// this way); 'pdf' is new in v1.26.0; anything else (e.g. 'image', or a
// deleted item linkTypes has no entry for) falls back to the note glyph
// rather than guessing — it's still a working jump widget either way, since
// openNoteLink()/openReader() don't care what the icon looked like.
function shelfLinkIcon(type){
  if(type === 'pdf') return '&#128196;';
  return '&#128220;';
}
// ~~strikethrough~~ and ==highlight== (v1.32.0). Runs late in renderMarkdown
// (after inline code, images, links and widgets are already real HTML) so it
// can't corrupt them: every <code>…</code> span and every HTML tag is swapped
// for a placeholder first, the two regexes run on what's left, then the
// placeholders go back. That matters most for "==": base64 padding in a
// data: image URI or a query string in a link URL would otherwise pair up
// into a stray <mark> inside an attribute, and `a == b == c` in an inline
// code span would get highlighted. Placeholders (not a split on tags) also
// let a mark wrap other formatting, e.g. ==**bold**==. The content must not
// start or end with whitespace or the delimiter character, so "a == b" and a
// bare "======" line are left alone.
function applyInlineMarks(html){
  const held = [];
  let s = html.replace(/<code>[\s\S]*?<\/code>|<[^>]+>/g, m=>{
    held.push(m);
    return `\u0000T${held.length - 1}\u0000`;
  });
  s = s.replace(/~~([^\s~](?:.*?[^\s~])?)~~/g,'<del>$1</del>');
  s = s.replace(/==([^\s=](?:.*?[^\s=])?)==/g,'<mark class="md-mark">$1</mark>');
  return s.replace(/\u0000T(\d+)\u0000/g, (_, i)=>held[+i]);
}
// Indentation in reading view (v1.45.1). Leading spaces/tabs used to vanish
// because HTML collapses them, so the editor's Tab indent looked like it did
// nothing. Now each leading space is worth 0.75em (a tab counts as 4 spaces,
// so the editor's 2-space Tab step = 1.5em). Paragraph / heading-body lines get an
// inline spacer span; list items get a margin-left (lists stay flat <ul>/<ol>
// — no real nesting — so block/line indices used by checkboxes are unchanged).
function mdIndentEm(line){
  const m = line.match(/^[ \t]+/);
  return m ? m[0].replace(/\t/g, '    ').length * 0.75 : 0;
}
function mdBrLines(text){
  return text.split('\n').map(l=>{
    if(!l.trim()) return l;
    const em = mdIndentEm(l);
    return em ? `<span class="md-ind" style="width:${em}em"></span>` + l.replace(/^[ \t]+/, '') : l;
  }).join('<br>');
}
function mdLiOpen(line, cls){
  const em = mdIndentEm(line);
  return `<li${cls ? ` class="${cls}"` : ''}${em ? ` style="margin-left:${em}em"` : ''}>`;
}

// ---- Live category index: ```index (v1.48.0) --------------------------------
// The Obsidian "one note that lists every folder and what's in it" page. Put
//   ```index
//   ```
// in a note and reading view shows a table: one row per category (in the same
// order as the shelf, Uncategorized last) with a count in the header, and a
// tappable link to every item in that category. It's rebuilt from the shelf
// every time the note is opened, so nothing is stored and it never goes stale.
// Optional lines inside the block (all case-insensitive, all optional):
//   types: notes, pdf, pictures, recordings   (default: everything)
//   exclude: Category A, Category B
//   columns: Category | Items                 (header labels; any language)
const SHELF_INDEX_TYPE_ALIASES = {
  note:'markdown', notes:'markdown', markdown:'markdown', md:'markdown', text:'markdown',
  pdf:'pdf', pdfs:'pdf',
  image:'image', images:'image', picture:'image', pictures:'image', photo:'image', photos:'image',
  audio:'audio', recording:'audio', recordings:'audio', sound:'audio'
};
const SHELF_INDEX_ICON = { markdown:'', pdf:'&#128196; ', image:'&#128444;&#65039; ', audio:'&#127925; ' };
function renderShelfIndex(optText, linkTypes){
  const all = linkTypes && linkTypes.__all;
  if(!all) return '<div class="shelf-index"><div class="si-note">The index is available when you open the note.</div></div>';
  let types = null, exclude = new Set(), colCat = 'Category', colItems = 'Items';
  for(const line of optText.split('\n')){
    const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/);
    if(!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if(key === 'types' || key === 'type'){
      const t = val.split(/[,，]/).map(x=>SHELF_INDEX_TYPE_ALIASES[x.trim().toLowerCase()]).filter(Boolean);
      if(t.length) types = new Set(t);
    } else if(key === 'exclude'){
      val.split(/[,，]/).map(x=>x.trim().toLowerCase()).filter(Boolean).forEach(x=>exclude.add(x));
    } else if(key === 'columns' || key === 'column'){
      const parts = val.split('|').map(x=>x.trim());
      if(parts[0]) colCat = parts[0];
      if(parts[1]) colItems = parts[1];
    }
  }
  const groups = new Map();
  for(const it of all){
    if(types && !types.has(it.type)) continue;
    const cat = it.category || 'Uncategorized';
    if(exclude.has(cat.toLowerCase())) continue;
    if(!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const real = [...groups.keys()].filter(c=>c!=='Uncategorized');
  let order = (prefs.categoryOrder||[]).filter(c=>real.includes(c));
  const known = new Set(order);
  order = [...order, ...real.filter(c=>!known.has(c)).sort((a,b)=>a.localeCompare(b))];
  if(groups.has('Uncategorized')) order.push('Uncategorized');
  const byTitle = (a,b)=>(a.title||'').localeCompare(b.title||'', undefined, {numeric:true, sensitivity:'base'});
  const head = `<thead><tr><th>${escapeHtml(colCat)} <span class="si-count">(${order.length})</span></th><th>${escapeHtml(colItems)}</th></tr></thead>`;
  if(!order.length) return `<div class="shelf-index"><div class="si-note">Nothing to list yet — add something to your shelf.</div></div>`;
  const rows = order.map(cat=>{
    const list = groups.get(cat).slice().sort(byTitle);
    const links = list.map(it=>`<li><a href="#" class="si-link" data-note-id="${escapeHtml(String(it.id))}">${SHELF_INDEX_ICON[it.type] || ''}${escapeHtml(it.title || 'Untitled')}</a></li>`).join('');
    return `<tr><td class="si-cat">${escapeHtml(cat)} <span class="si-count">${list.length}</span></td><td><ul>${links}</ul></td></tr>`;
  }).join('');
  return `<div class="shelf-index"><table>${head}<tbody>${rows}</tbody></table></div>`;
}

function renderMarkdown(src, linkTypes){
  linkTypes = linkTypes || {};
  let s = escapeHtml(src);
  // Fenced code blocks are pulled out into placeholder tokens FIRST, before
  // any other regex runs, and only spliced back in as real HTML at the very
  // end (see the `codeBlocks` replace below). Otherwise a snippet containing
  // "**" or a stray backtick — completely normal in real code — would get
  // mangled by the bold/italic/inline-code passes that run on the rest of
  // `s` afterwards. `\u0000` can't appear in normal note text, so it's a
  // safe marker.
  const codeBlocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code)=>{
    // ```index — a live category index (v1.48.0), not a code sample.
    if(lang === 'index'){
      codeBlocks.push(renderShelfIndex(unescapeHtml(code), linkTypes));
      return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
    }
    const langLabel = lang ? escapeHtml(lang) : '';
    codeBlocks.push(
      `<div class="code-block">`
      + `<div class="code-bar"><span class="code-lang">${langLabel}</span>`
      + `<button class="code-copy" onclick="copyCodeBlock(this)">Copy</button></div>`
      + `<pre><code>${code.trim()}</code></pre></div>`
    );
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });
  // H1-H6 (v1.37.0; was H1-H3 only, so "#### x" used to show as literal text).
  // One pass, so the marker length alone decides the level.
  s = s.replace(/^(#{1,6}) (.*)$/gm, (_, hashes, text)=>`<h${hashes.length}>${text}</h${hashes.length}>`);
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  s = s.replace(/`([^`]+)`/g,'<code>$1</code>');
  // #tags: converted to tappable pills right after inline code above (so a
  // "#" typed inside a code span, e.g. `C#`, is skipped) and before the
  // image/link passes below (so a tag never gets mixed up with `[label](url)`
  // syntax — see convertHashtags for why splitting on <code> spans is safe
  // here even though fenced code is still just placeholder tokens).
  s = convertHashtags(s);
  // [[Wiki links]] — Obsidian-style: link by the OTHER item's exact title
  // (case-insensitive), not its id, with an optional [[Title|Alias]] display
  // override. Resolved fresh against linkTypes.__byTitle on every render, so
  // — unlike a `[Title](shelf://<id>)` link, which is frozen to that id the
  // moment it's inserted — renaming the TARGET item never breaks it; only
  // renaming/deleting the title the link itself refers to does, and that's
  // shown as a distinct "missing" pill rather than silently looking fine.
  // Must run before the `[label](url)` pass below only as a precaution —
  // `[[Title]]` has no trailing `(url)` so that regex was never actually
  // going to match it, but resolving wiki-links to real widget HTML first
  // keeps the two passes clearly separated.
  s = s.replace(/\[\[([^\[\]]+)\]\]/g, (_, inner)=>{
    const bar = inner.indexOf('|');
    const rawTitle = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const label = (bar === -1 ? inner : inner.slice(bar+1)).trim();
    const match = linkTypes.__byTitle && linkTypes.__byTitle.get(rawTitle.toLowerCase());
    if(!match){
      return `<button type="button" class="wiki-link-missing" data-title="${rawTitle}" title="No item titled &quot;${rawTitle}&quot; on your shelf — tap to create it">[[${label}]]</button>`;
    }
    if(match.type === 'audio'){
      return `<div class="md-audio-inline" data-audio-id="${match.id}">`
           + `<button class="inline-play">&#9658;</button>`
           + `<div class="meta"><div class="title">${label}</div>`
           + `<div class="inline-bar"><div class="inline-bar-fill"></div></div>`
           + `<div class="inline-time"></div></div>`
           + `<button class="expand" title="Open full player">&#8599;</button></div>`;
    }
    return `<div class="md-note-link${match.type === 'pdf' ? ' pdf-target' : ''}" data-note-id="${match.id}">`
         + `<span class="note-link-icon">${shelfLinkIcon(match.type)}</span>`
         + `<span class="note-link-title">${label}</span>`
         + `<span class="note-link-go">&#8594;</span></div>`;
  });
  // Two special link targets get their own inline widget instead of a plain
  // <a>: an audio-file URL plays via a native <audio> element (fetches live
  // over the network — the one place in Shelfmark that does); a shelf://<id>
  // link points at an audio item already stored on this shelf and reuses
  // the same on-shelf player/decrypt-on-play code path as the shelf list
  // (wireInlineAudio() attaches its click handler once this HTML is in the
  // DOM — see openReader/saveEditNote).
  // Images: `![alt](url)` — almost always a data: URI inserted by the
  // "insert picture" toolbar button (see onNoteImagePick), but any image URL
  // works. Must run BEFORE the plain-link pass below, since a leftover
  // `[alt](url)` after stripping the leading `!` would otherwise also match
  // the link regex and get turned into a stray `!<a>...</a>`.
  s = s.replace(/!\[(.*?)\]\((.+?)\)/g,(_,alt,url)=>`<img class="md-img" src="${url.trim()}" alt="${alt}">`);
  const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|weba)(\?.*)?$/i;
  const SHELF_LINK = /^shelf:\/\/(.+)$/;
  s = s.replace(/\[(.+?)\]\((.+?)\)/g,(_,label,url)=>{
    const trimmedUrl = url.trim();
    const shelfMatch = trimmedUrl.match(SHELF_LINK);
    if(shelfMatch){
      const id = shelfMatch[1];
      // Only an audio target gets the inline player widget; everything else
      // (markdown, pdf, image, or an id missing from linkTypes entirely —
      // most likely a deleted item) gets the generic jump widget instead.
      // Before v1.26.0 this branched on `linkTypes[id] === 'markdown'` only,
      // so a shelf://<id> link to a PDF (or an image) fell through to the
      // audio-inline branch below and rendered a play button that could
      // never actually play anything.
      if(linkTypes[id] !== 'audio'){
        return `<div class="md-note-link${linkTypes[id] === 'pdf' ? ' pdf-target' : ''}" data-note-id="${id}">`
             + `<span class="note-link-icon">${shelfLinkIcon(linkTypes[id])}</span>`
             + `<span class="note-link-title">${label}</span>`
             + `<span class="note-link-go">&#8594;</span></div>`;
      }
      return `<div class="md-audio-inline" data-audio-id="${id}">`
           + `<button class="inline-play">&#9658;</button>`
           + `<div class="meta"><div class="title">${label}</div>`
           + `<div class="inline-bar"><div class="inline-bar-fill"></div></div>`
           + `<div class="inline-time"></div></div>`
           + `<button class="expand" title="Open full player">&#8599;</button></div>`;
    }
    if(AUDIO_EXT.test(trimmedUrl) || /^data:audio\//i.test(trimmedUrl)){
      return `<div class="md-audio"><div class="md-audio-label">${label}</div>`
           + `<audio controls preload="none" src="${trimmedUrl}"></audio></div>`;
    }
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  });
  // ~~strike~~ / ==highlight==: last inline pass, once links/images/widgets
  // are already HTML (see applyInlineMarks for why the order matters).
  s = applyInlineMarks(s);
  // Splice the real code-block HTML back in now that every other pass —
  // which would have mangled ** / ` / [..](..) if they'd appeared inside a
  // code sample — has already run.
  codeBlocks.forEach((html, i)=>{ s = s.replace(`\u0000CODEBLOCK${i}\u0000`, html); });
  return s.split(/\n{2,}/).map((block,idx)=>{
    let html;
    if(/^<h[1-6]/.test(block)){
      // A heading with text on the lines right under it (no blank line) is
      // ONE block. Split it into the heading row and a .heading-rest wrapper
      // so folding the heading can hide that text too (v1.37.1). Blocks are
      // never split or renumbered, so paragraph edit / bookmarks / task
      // checkboxes keep addressing the same source blocks. If the rest holds
      // real HTML (code block, table...), don't touch its newlines.
      const nl = block.indexOf('\n');
      const rest = nl === -1 ? '' : block.slice(nl + 1);
      if(!rest.trim()) html = nl === -1 ? block : block.slice(0, nl);
      else html = block.slice(0, nl) + `<div class="heading-rest">${/<(div|pre|table|ul|ol)\b/.test(rest) ? rest : mdBrLines(rest)}</div>`;
    }
    else if(/^<pre/.test(block)) html = block;
    else if(/^<div class="md-audio/.test(block)) html = block;
    else if(/^<div class="md-note-link/.test(block)) html = block;
    else if(/^<div class="code-block"/.test(block)) html = block;
    else if(/^<div class="shelf-index"/.test(block)) html = block;
    else if(/^<img class="md-img"/.test(block)) html = block;
    else if(looksLikeTable(block)) html = tableToHtml(block);
    else if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(block)) html = '<hr>';
    else if(/^\s*&gt;/.test(block) && block.split('\n').every(l=>!l.trim() || /^\s*&gt;/.test(l))){
      const lines = block.split('\n').filter(l=>l.trim()).map(l=>l.replace(/^\s*&gt;\s?/,''));
      // Obsidian-style callout: a blockquote whose first line is
      // "[!type] Optional title" renders as a colored card instead of a
      // plain quote. Reuses the same --pdf/--md/--img/--audio palette the
      // rest of the app already uses for item-type accents, so callouts
      // read as part of the same visual system rather than a new one.
      const calloutMatch = lines[0] && lines[0].match(/^\[!(\w+)\]([+-]?)\s*(.*)$/);
      if(calloutMatch){
        const kind = calloutMatch[1].toLowerCase();
        const CALLOUT_INFO = {
          note:    { icon:'&#128221;', label:'Note' },
          warning: { icon:'&#9888;&#65039;', label:'Warning' },
          idea:    { icon:'&#128161;', label:'Idea' }
        };
        const info = CALLOUT_INFO[kind] || { icon:'&#128204;', label: kind.charAt(0).toUpperCase()+kind.slice(1) };
        const fold = calloutMatch[2];  // '' = static card, '-' = foldable starting closed, '+' = foldable starting open
        const titleText = calloutMatch[3].trim() || info.label;
        const bodyHtml = lines.slice(1).join('<br>');
        const cls = `callout callout-${/^(note|warning|idea)$/.test(kind) ? kind : 'other'}`;
        const titleInner = `<span class="callout-icon">${info.icon}</span>${titleText}`;
        // Foldable callout (Obsidian's `[!type]-` / `[!type]+`): a native
        // <details>, so the browser owns the open/closed state — no JS, and
        // it works with keyboard and screen readers for free. A callout with
        // no body has nothing to fold, so it stays a plain card.
        if(fold && bodyHtml){
          html = `<details class="${cls} callout-fold"${fold === '+' ? ' open' : ''}>`
               + `<summary class="callout-title">${titleInner}</summary>`
               + `<div class="callout-body">${bodyHtml}</div>`
               + `</details>`;
        } else {
          html = `<div class="${cls}">`
               + `<div class="callout-title">${titleInner}</div>`
               + (bodyHtml ? `<div class="callout-body">${bodyHtml}</div>` : '')
               + `</div>`;
        }
      } else {
        html = `<blockquote>${lines.join('<br>')}</blockquote>`;
      }
    }
    else if(/^\s*\d+\.\s+/.test(block)){
      const items = block.split('\n').filter(l=>l.trim()).map(l=>`${mdLiOpen(l)}${l.replace(/^\s*\d+\.\s+/,'')}</li>`).join('');
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
          return `${mdLiOpen(l, 'task-item')}<label><input type="checkbox" data-block-idx="${idx}" data-line-idx="${li}"${checked ? ' checked' : ''}><span${checked ? ' class="done"' : ''}>${taskMatch[2]}</span></label></li>`;
        }
        return `${mdLiOpen(l)}${stripped}</li>`;
      }).join('');
      html = `<ul${isTaskList ? ' class="task-list"' : ''}>${items}</ul>`;
    } else html = `<p>${mdBrLines(block)}</p>`;
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
    mdView.innerHTML = renderMarkdown(newText, await buildLinkTypeMap());
    wireInlineAudio(mdView);
    wireNoteLinks(mdView);
    wireMissingWikiLinks(mdView);
    wireTagPills(mdView);
    wireTaskCheckboxes(mdView);
    wireParagraphEdit(mdView);
    wireHeadingFold(mdView);
    wireTableEdit(mdView);
    await renderBacklinks(curId, mdView);
    updateOutlineUI(buildOutline(mdView));
    findRefresh(); // the re-render wiped the highlights
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

// @@TABLE-EDIT-START
// ---- Edit tables in reading view (v1.38.0) ----
// Tap a cell to edit its text in place (Obsidian-style) instead of dropping
// into the source editor. The cell shows its RAW markdown while you type
// (so **bold** is editable as **bold**), and is saved back into that exact
// table row of the note: only rows whose cells actually changed are
// rewritten, everything else in the note (including untouched table rows and
// the blank lines between blocks) stays byte-for-byte as it was.
//   Enter = save   Esc = cancel   Tab / Shift+Tab = next / previous cell
//   (Tab in the very last cell adds a row)   tapping another cell saves and moves.
// While a cell is open a small bar under the table offers + Row / + Col /
// Delete row / Delete col, acting on the open cell. Cells holding a picture
// are left to the source editor. The table's block is found by the same
// blank-line split renderMarkdown uses (as toggleTaskCheckbox does); if the
// raw text no longer lines up, nothing is changed and the user is told.
let tableEdit = null;          // {td, blockIdx, m, c, orig, done} — the open cell
let pendingTableEdit = null;   // cell to open once the current save lands (user tapped another cell)
let tableBusy = false;
let tableBarPress = false;     // a bar button is being pressed: its blur must not save the cell yet
// Multi-line cells (v1.42.0). Editing shows the stored "<br>" as real line
// breaks; on save the lines are joined back with "<br>". tableCellText reads
// the editing cell by walking its nodes (text, <br>, browser-made <div>s)
// instead of using textContent, which would silently drop breaks.
function cellRawToEdit(raw){ return String(raw == null ? '' : raw).replace(/<br\s*\/?>/gi, '\n'); }
function tableCellText(td){
  let out = '';
  (function walk(n){
    n.childNodes.forEach(ch=>{
      if(ch.nodeType === 3) out += ch.nodeValue;
      else if(ch.nodeName === 'BR') out += '\n';
      else if(ch.nodeType === 1){
        if(/^(DIV|P)$/.test(ch.nodeName) && out && !out.endsWith('\n')) out += '\n';
        walk(ch);
      }
    });
  })(td);
  return out.replace(/\u200b/g, '').replace(/\r\n?/g, '\n').split('\n').map(l=>l.trim()).join('\n').trim();
}
// Enter inside a cell: insert a line break at the caret. A break at the very
// end of a pre-wrap block isn't drawn by browsers, so in that case a zero-width
// space goes after it to give the caret a visible new line (stripped on read).
function cellInsertNewline(td){
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const tail = document.createRange();
  tail.selectNodeContents(td);
  tail.setStart(r.endContainer, r.endOffset);
  const atEnd = tail.toString().replace(/\u200b/g, '') === '';
  r.deleteContents();
  const nl = document.createTextNode('\n');
  r.insertNode(nl);
  let caretNode = nl;
  if(atEnd){
    const z = document.createTextNode('\u200b');
    nl.after(z);
  }
  const nr = document.createRange();
  nr.setStartAfter(caretNode); nr.collapse(true);
  sel.removeAllRanges(); sel.addRange(nr);
  // keep the new line in view inside a scrolled wrapper
  const b = td.getBoundingClientRect();
  if(b.bottom > window.innerHeight - 8) td.scrollIntoView({ block:'nearest' });
}
function tableArraysEqual(a, b){ return a.length === b.length && a.every((v,i)=>v === b[i]); }
function serializeTableRow(cells){
  return '| ' + cells.map(c=>String(c).replace(/\r?\n/g,' ').replace(/\|/g,'\\|').trim()).join(' | ') + ' |';
}
function readTableModel(blockIdx){
  if(curNoteRaw == null) return null;
  const parts = curNoteRaw.split(/(\n{2,})/);   // [block, sep, block, sep, ...]
  const block = parts[blockIdx * 2];
  if(block == null || !looksLikeTable(block)) return null;
  const lines = block.split('\n').filter(l=>l.trim());
  return { parts, block, lines, header: splitTableRow(lines[0]), sep: splitTableRow(lines[1]), rows: lines.slice(2).map(splitTableRow) };
}
function buildTableBlock(model, matrix, sep){
  const orig = [model.header, ...model.rows];
  const out = [];
  matrix.forEach((cells, i)=>{
    const ol = model.lines[i === 0 ? 0 : i + 1];
    out.push(ol != null && i < orig.length && tableArraysEqual(orig[i], cells) ? ol : serializeTableRow(cells));
    if(i === 0) out.push(tableArraysEqual(model.sep, sep) ? model.lines[1] : serializeTableRow(sep));
  });
  return out.join('\n');
}
async function rerenderNoteView(){
  const mdView = document.getElementById('mdView');
  if(!mdView) return;
  mdView.innerHTML = renderMarkdown(curNoteRaw, await buildLinkTypeMap());
  wireInlineAudio(mdView);
  wireNoteLinks(mdView);
  wireMissingWikiLinks(mdView);
  wireTagPills(mdView);
  wireTaskCheckboxes(mdView);
  wireParagraphEdit(mdView);
  wireHeadingFold(mdView);
  wireTableEdit(mdView);
  await renderBacklinks(curId, mdView);
  updateOutlineUI(buildOutline(mdView));
  const it = await getOne(curId);
  if(it) updateBookmarkUI(it.bookmarks || []);
  findRefresh(); // the re-render wiped the highlights
}
function removeTableBar(){ const b = document.getElementById('tableBar'); if(b) b.remove(); }
function closeTableCell(edit){
  const td = edit.td;
  td.onkeydown = td.onblur = td.onpaste = null;
  td.removeAttribute('contenteditable');
  td.classList.remove('editing');
  removeTableBar();
}
function cancelTableEdit(edit){
  if(edit.done) return;
  edit.done = true;
  edit.td.innerHTML = edit.orig;
  closeTableCell(edit);
  if(tableEdit === edit) tableEdit = null;
  pendingTableEdit = null;
}
// Saves the open cell and (optionally) restructures the table in the same
// write. op: {type:'none'} | {type:'move', target} | {type:'rowAfter'|'colAfter'|'rowDel'|'colDel', target?}
async function applyTableEdit(edit, op){
  if(edit.done) return;
  edit.done = true;
  tableBusy = true;
  let target = null, failed = false;
  try{
    const model = readTableModel(edit.blockIdx);
    const row0 = model && (edit.m === 0 ? model.header : model.rows[edit.m - 1]);
    if(!model || !row0){
      failed = true;
      alert("Couldn't match this table to the note text, so nothing was changed. Use the pencil button to edit it as text.");
    } else {
      const matrix = [model.header, ...model.rows].map(r=>r.slice());
      const sep = model.sep.slice();
      const ncols = Math.max(model.header.length, sep.length);
      const pad = (r, n)=>{ while(r.length < n) r.push(''); };
      pad(matrix[edit.m], edit.c + 1);
      // Untouched cell → keep its stored text byte-for-byte (e.g. "<br/>" stays).
      const curText = tableCellText(edit.td);
      if(curText !== edit.loaded) matrix[edit.m][edit.c] = curText.split('\n').join('<br>');
      let cancelled = false;
      if(op.type === 'rowAfter'){
        // A merged cell that continues into the row below keeps continuing
        // through the new row ("^^" / "<<" are copied down), so inserting a
        // row inside a merged block never tears it apart.
        const below = matrix[edit.m + 1];
        const nr = [];
        for(let cc = 0; cc < ncols; cc++){
          const bv = below && edit.m >= 1 ? below[cc] : '';
          const prev = nr[cc - 1];
          nr[cc] = rawIsU(bv) ? MERGE_U : (rawIsL(bv) && cc > 0 && (prev === MERGE_U || prev === MERGE_L) ? MERGE_L : '');
        }
        matrix.splice(edit.m + 1, 0, nr);
        target = { m: edit.m + 1, c: edit.c };
      } else if(op.type === 'colAfter'){
        const nc = [];
        matrix.forEach((r, ri)=>{
          pad(r, ncols);
          const rv = r[edit.c + 1], prev = nc[ri - 1];
          nc[ri] = rawIsL(rv) ? MERGE_L : (rawIsU(rv) && ri >= 2 && (prev === MERGE_L || prev === MERGE_U) ? MERGE_U : '');
        });
        matrix.forEach((r, ri)=>r.splice(edit.c + 1, 0, nc[ri]));
        pad(sep, ncols); sep.splice(edit.c + 1, 0, '---');
        target = { m: edit.m, c: edit.c + 1 };
      } else if(op.type === 'rowDel'){
        const has = matrix[edit.m].some(rawHasText);
        if(edit.m === 0 || (has && !confirm('Delete this row?'))) cancelled = true;
        else {
          // The row below may be merged INTO this one; hand the text (or the
          // "<<" of a wider merge) down so that merged block survives.
          const o = matrix[edit.m], n = matrix[edit.m + 1];
          if(n) for(let cc = 0; cc < n.length; cc++){
            if(rawIsU(n[cc]) && !rawIsU(o[cc])) n[cc] = rawIsL(o[cc]) ? MERGE_L : (o[cc] == null ? '' : o[cc]);
          }
          matrix.splice(edit.m, 1); target = { m: Math.min(edit.m, matrix.length - 1), c: edit.c };
        }
      } else if(op.type === 'colDel'){
        const has = matrix.some(r=>rawHasText(r[edit.c]));
        if(ncols <= 1 || (has && !confirm('Delete this column?'))) cancelled = true;
        else {
          matrix.forEach(r=>{
            pad(r, ncols);
            const o = r[edit.c], n = r[edit.c + 1];
            if(rawIsL(n) && !rawIsL(o)) r[edit.c + 1] = rawIsU(o) ? MERGE_U : (o == null ? '' : o);
            r.splice(edit.c, 1);
          });
          pad(sep, ncols); sep.splice(edit.c, 1);
          target = { m: edit.m, c: Math.min(edit.c, ncols - 2) };
        }
      } else if(op.type === 'mergeR' || op.type === 'mergeD' || op.type === 'split'){
        const nw = Math.max(ncols, ...matrix.map(r=>r.length));
        matrix.forEach(r=>pad(r, nw));
        if(op.type === 'split') tableSplit(matrix, edit.m, edit.c);
        else {
          const dir = op.type === 'mergeR' ? 'R' : 'D';
          const dry = tableMerge(matrix, edit.m, edit.c, dir, true);
          if(!dry.ok) alert("These cells can't be merged: the neighbour has to line up exactly with this cell (same rows / columns), and the header row can't merge downwards.");
          else if(!dry.lost || confirm("Merging keeps only this cell's text and discards the other cell's text. Continue?")) tableMerge(matrix, edit.m, edit.c, dir, false);
        }
        target = { m: edit.m, c: edit.c };
      } else if(op.type === 'move'){
        target = op.target;
      }
      if(op.target && (op.type === 'rowAfter')) target = op.target;
      if(cancelled){
        // nothing structural happened: still keep what was typed
        if(op.type === 'rowDel' || op.type === 'colDel') target = { m: edit.m, c: edit.c };
      }
      const newBlock = buildTableBlock(model, matrix, sep);
      if(newBlock !== model.block){
        model.parts[edit.blockIdx * 2] = newBlock;
        const full = model.parts.join('');
        try{
          await putContentOnly(curId, 'markdown', full);
          curNoteRaw = full;
          await rerenderNoteView();
        }catch(err){
          failed = true;
          alert(isQuotaError(err) ? "Your device's storage is full, so this table change couldn't be saved." : "Couldn't save this table change — please try again.");
        }
      }
    }
  } finally {
    if(document.body.contains(edit.td)){ // still the live cell: nothing was re-rendered
      edit.td.innerHTML = edit.orig;
      closeTableCell(edit);
    }
    removeTableBar();
    tableBusy = false; tableBarPress = false;
    if(tableEdit === edit) tableEdit = null;
  }
  const next = failed ? null : (target ? { blockIdx: edit.blockIdx, ...target } : pendingTableEdit);
  pendingTableEdit = null;
  if(next) openTableCellAt(next);
}
function openTableCellAt(pos){
  const block = document.querySelector(`.mdblock[data-idx="${pos.blockIdx}"]`);
  const table = block && block.querySelector('table');
  // Cells carry their logical position (data-r / data-c) because merged cells
  // make DOM row/cell indexes differ from it. A target inside a merged block
  // resolves to the nearest cell to its left in that row.
  let cell = table && table.querySelector(`[data-r="${pos.m}"][data-c="${pos.c}"]`);
  if(!cell && table){
    const same = [...table.querySelectorAll(`[data-r="${pos.m}"]`)].filter(x=>Number(x.dataset.c) <= pos.c);
    cell = same[same.length - 1] || null;
  }
  if(cell) startTableCellEdit(cell);
}
function startTableCellEdit(td){
  if(tableEdit || tableBusy) return;
  const block = td.closest('.mdblock');
  if(!block) return;
  if(td.querySelector('img')){ alert('This cell holds a picture — use the pencil button to edit it as text.'); return; }
  const blockIdx = Number(block.dataset.idx);
  const m = Number(td.dataset.r), c = Number(td.dataset.c);
  const model = readTableModel(blockIdx);
  const row = model && (m === 0 ? model.header : model.rows[m - 1]);
  if(!row){ alert("Couldn't match this table to the note text — use the pencil button to edit it as text."); return; }
  const edit = tableEdit = { td, blockIdx, m, c, orig: td.innerHTML, done: false };
  td.classList.add('editing');
  try{ td.contentEditable = 'plaintext-only'; }catch(e){}
  if(td.contentEditable !== 'plaintext-only') td.contentEditable = 'true';
  td.textContent = cellRawToEdit(row[c]);
  edit.loaded = tableCellText(td);
  td.onpaste = (e)=>{
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if(!t.includes('\n')){ document.execCommand('insertText', false, t); return; }
    // multi-line paste: each line becomes a line in the cell
    const sel = window.getSelection();
    if(!sel.rangeCount) return;
    const r = sel.getRangeAt(0); r.deleteContents();
    const node = document.createTextNode(t); r.insertNode(node);
    const nr = document.createRange(); nr.setStartAfter(node); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
  };
  td.onblur = ()=>{ if(!tableBarPress) applyTableEdit(edit, { type:'none' }); };
  td.onkeydown = (e)=>{
    // Enter = new line inside the cell (v1.42.0); Ctrl/Cmd+Enter, the Done
    // button, or tapping elsewhere saves. (IME composition Enter is left alone.)
    if(e.key === 'Enter' && !e.isComposing){
      e.preventDefault();
      if(e.ctrlKey || e.metaKey) applyTableEdit(edit, { type:'none' });
      else cellInsertNewline(td);
    }
    else if(e.key === 'Escape'){ e.preventDefault(); cancelTableEdit(edit); }
    else if(e.key === 'Tab'){
      e.preventDefault();
      const cellsInOrder = [...td.closest('table').querySelectorAll('th, td')];
      const i = cellsInOrder.indexOf(td);
      const at = x=>({ m: Number(x.dataset.r), c: Number(x.dataset.c) });
      let t = null, type = 'move';
      if(!e.shiftKey){
        if(i + 1 < cellsInOrder.length) t = at(cellsInOrder[i + 1]);
        else { type = 'rowAfter'; t = { m: m + 1, c: 0 }; }
      } else if(i > 0) t = at(cellsInOrder[i - 1]);
      applyTableEdit(edit, t ? { type, target: t } : { type:'none' });
    }
  };
  // structure bar under the table
  removeTableBar();
  const wrap = td.closest('.md-table-wrap');
  const table = td.closest('table');
  const bar = document.createElement('div');
  bar.id = 'tableBar';
  bar.className = 'table-bar';
  const nw = Math.max(model.header.length, model.sep.length, ...model.rows.map(r=>r.length));
  const grid = [model.header, ...model.rows].map(r=>{ const x = r.slice(); while(x.length < nw) x.push(''); return x; });
  const ms = tableMergeState(grid, m, c) || { canRight:false, canDown:false, merged:false };
  const defs = [['none','\u2713 Done', false], ['rowAfter','+ Row below', false], ['colAfter','+ Col right', false],
                ['rowDel','Delete row', m === 0], ['colDel','Delete col', nw <= 1],
                ['mergeR','Merge \u2192', !ms.canRight], ['mergeD','Merge \u2193', !ms.canDown], ['split','Unmerge', !ms.merged]];
  defs.forEach(([type, label, off])=>{
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.disabled = off;
    b.onpointerdown = (e)=>{ e.preventDefault(); tableBarPress = true; };
    const release = ()=>setTimeout(()=>{
      tableBarPress = false;
      if(tableEdit === edit && !edit.done && document.activeElement !== td) td.focus(); // pressed but never clicked
    }, 400);
    b.onpointerup = release; b.onpointercancel = release;
    b.onclick = (e)=>{ e.stopPropagation(); applyTableEdit(edit, { type }); };
    bar.appendChild(b);
  });
  if(wrap) wrap.insertAdjacentElement('afterend', bar);
  td.focus();
  const range = document.createRange();
  range.selectNodeContents(td); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}
function wireTableEdit(container){
  container.querySelectorAll('.md-table-wrap td, .md-table-wrap th').forEach(cell=>{
    cell.classList.add('tcell');
    cell.onpointerdown = ()=>{
      // Tapping another cell while one is open: blur is about to save the open
      // one; remember where to go next.
      if(tableEdit && tableEdit.td !== cell && !tableBarPress){
        const b = cell.closest('.mdblock');
        pendingTableEdit = { blockIdx: Number(b.dataset.idx), m: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      }
    };
    cell.onclick = (e)=>{
      if(e.target.closest('a, button, input, img.md-img, .md-audio-inline, .md-note-link')) return;
      if(tableEdit || tableBusy || !cell.isConnected) return;
      const sel = window.getSelection();
      if(sel && sel.toString().length > 0) return; // dragging to select text to copy
      startTableCellEdit(cell);
    };
  });
}
// @@TABLE-EDIT-END

// @@IMGZOOM-START
// ---- Picture thumbnails + tap to enlarge (v1.39.0) ----
// In reading view a picture in a note is shown as a small thumbnail (CSS,
// .mdbody img.md-img); tapping it opens it full-screen here. Tap the picture
// again to switch between "fit to screen" and actual size (scrolls); tap the
// backdrop, the x, or press Esc to close. Display only — the note text and
// the stored / exported picture data are untouched. One delegated listener
// (not per-render wiring) because mdView is re-rendered often.
let imgZoomEl = null;
function imgZoomKey(e){
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeImageZoom(); }
}
function closeImageZoom(){
  if(!imgZoomEl) return;
  imgZoomEl.remove();
  imgZoomEl = null;
  document.removeEventListener('keydown', imgZoomKey, true);
}
function openImageZoom(src, alt){
  closeImageZoom();
  const ov = document.createElement('div');
  ov.className = 'img-zoom';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', alt || 'Picture');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.onclick = (e)=>{ e.stopPropagation(); ov.classList.toggle('actual'); };
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'img-zoom-x';
  x.textContent = '\u00d7';
  x.setAttribute('aria-label', 'Close');
  x.onclick = (e)=>{ e.stopPropagation(); closeImageZoom(); };
  ov.onclick = closeImageZoom;
  ov.append(img, x);
  document.body.appendChild(ov);
  imgZoomEl = ov;
  document.addEventListener('keydown', imgZoomKey, true);
}
document.addEventListener('click', (e)=>{
  const img = e.target.closest && e.target.closest('#mdView img.md-img');
  if(!img) return;
  e.preventDefault();
  openImageZoom(img.currentSrc || img.src, img.alt);
});
// @@IMGZOOM-END

// ---- Command palette (Ctrl+K) ----
// Header used to carry one icon per action (storage/sort/loop/tags/select/
// import/export/quick-note) plus Add — enough to wrap to two rows on a
// narrow phone. This is the replacement: one 🔍 button (or Ctrl+K) opens a
// fuzzy-searchable list of the same actions, plus a live "jump to #tag"
// entry per tag on the shelf. The old buttons are still in the DOM (see
// #legacyHeaderIcons in index.html) just hidden, so every existing
// toggleX()/showX() function keeps working exactly as before — this only
// changes how they're reached.
let cmdPaletteOpen = false;
let cmdPalActiveIndex = 0;
let cmdPalFiltered = [];
let cmdPalTagCommands = [];
function buildStaticCommands(){
  const storageBtn = document.getElementById('storageBtn');
  const storageHint = (storageBtn && storageBtn.style.display !== 'none') ? storageBtn.textContent : '';
  const THEME_LABEL = {auto:'Auto (match device)', light:'Light', dark:'Dark', sepia:'Sepia'};
  const themeCmds = ['auto','light','dark','sepia'].map(t=>({
    id:'theme-'+t, icon:'&#9681;', label:'Theme: '+THEME_LABEL[t],
    hint: prefs.theme === t ? 'current' : '', action: ()=>setPref('theme', t)
  }));
  return [
    { id:'new-note', icon:'&#128221;', label:'New note', hint:'', action: ()=>quickNewNote() },
    { id:'new-index', icon:'&#128450;&#65039;', label:'New index note (all categories)', hint:'', action: ()=>quickNewNote('Index', NOTE_TEMPLATES.index.content()) },
    { id:'add-item', icon:'&#10133;', label:'Add item\u2026', hint:'pdf / note / image / audio', action: ()=>openAdd() },
    { id:'import', icon:'&#8681;', label:'Import from JSON', hint:'', action: ()=>document.getElementById('importPick').click() },
    ...(EXT_SUPPORTED ? [
      { id:'ext-open', icon:'&#128193;', label: extRootName ? 'Change notes folder\u2026' : 'Open a notes folder\u2026', hint: extRootName || 'Obsidian-style', action: ()=>extPickFolder() },
      ...(extRootName ? [{ id:'ext-sync', icon:'&#128260;', label:'Sync notes folder now', hint: extRootName, action: ()=>extSync(true) },
                         { id:'ext-unlink', icon:'&#128279;', label:'Unlink notes folder', hint:'keeps files on disk', action: ()=>extUnlink() }] : [])
    ] : []),
    { id:'export', icon:'&#8679;', label:'Export shelf as JSON', hint:'', action: ()=>openExportModal() },
    { id:'shelf-name', icon:'&#127991;&#65039;', label:'Shelf name\u2026', hint: prefs.shelfName || 'not set', action: ()=>renameShelf() },
    { id:'tags', icon:'#', label:'Browse tags', hint:'', action: ()=>openTagsPage() },
    { id:'select', icon: selectMode ? '&times;' : '&#9745;', label: selectMode ? 'Exit selection mode' : 'Select multiple items', hint:'', action: ()=>toggleSelectMode() },
    { id:'sort', icon:'&#8645;', label:'Sort: switch to '+(itemSortMode === 'newest' ? 'A\u2013Z' : 'Newest first'), hint:'now '+(itemSortMode === 'newest' ? 'Newest' : 'A\u2013Z'), action: ()=>toggleSortMode() },
    { id:'loop', icon:'&#128257;', label:'Audio loop: turn '+(prefs.loopAudio ? 'off' : 'on'), hint: prefs.loopAudio ? 'on' : 'off', action: ()=>toggleLoopAudio() },
    authMode === 'device'
      ? { id:'passcode-set', icon:'&#128274;', label:'Set a passcode\u2026', hint:'currently none', action: ()=>openAuthModal('set') }
      : { id:'passcode-remove', icon:'&#128275;', label:'Remove passcode\u2026', hint:'', action: ()=>openAuthModal('remove') },
    { id:'guide', icon:'&#128218;', label:'App guide: index, passcode & tips', hint:'', action: ()=>openGuide() },
    { id:'erase-shelf', icon:'&#128465;&#65039;', label:'Erase this shelf and start over\u2026', hint:'deletes everything', action: ()=>eraseShelfFromApp() },
    { id:'passcode-info', icon:'&#128272;', label:'Passcode & lock: info and settings', hint: authMode === 'device' ? 'no passcode' : 'passcode on', action: ()=>openSecInfo() },
    { id:'storage', icon:'&#128190;', label:'Storage used', hint: storageHint, action: ()=>showStorageDetail() },
    { id:'md-help', icon:'?', label:'Markdown formatting help', hint:'', action: ()=>openMarkdownHelp() },
    ...themeCmds
  ];
}
// Tag commands need buildTagIndex(), which decrypts every note to find its
// tags — the same cost the Tags page already pays once per open, not
// something worth blocking the palette's own opening on. So the palette
// opens instantly with just the static commands, and tag entries fade in a
// moment later once this resolves (re-rendering only if still open).
async function loadCommandPaletteTags(){
  let index;
  try{ index = await buildTagIndex(); } catch(err){ cmdPalTagCommands = []; return; }
  cmdPalTagCommands = Array.from(index.entries())
    .map(([key, info])=>({
      id:'tag-'+key, icon:'#', label:'Jump to #'+info.display,
      hint: info.items.length + (info.items.length === 1 ? ' note' : ' notes'),
      action: ()=>jumpToTag(key, info.items)
    }))
    .sort((a,b)=>a.label.localeCompare(b.label, undefined, {numeric:true, sensitivity:'base'}));
  if(cmdPaletteOpen) renderCommandPalette();
}
function openCommandPalette(){
  if(!cryptoKey) return; // nothing to search while locked
  cmdPaletteOpen = true;
  cmdPalActiveIndex = 0;
  const input = document.getElementById('cmdPalInput');
  input.value = '';
  document.getElementById('cmdPalette').classList.add('open');
  renderCommandPalette();
  setTimeout(()=>input.focus(), 0);
  loadCommandPaletteTags();
}
function closeCommandPalette(){
  cmdPaletteOpen = false;
  document.getElementById('cmdPalette').classList.remove('open');
}
// Subsequence fuzzy match: every character of the query must appear in
// order somewhere in the target, scored higher for consecutive runs and
// for matches near the start — enough to let "nn" find "New note" or
// "drk" find "Theme: Dark" without a real fuzzy-match library.
function fuzzyScore(query, target){
  query = query.toLowerCase(); target = target.toLowerCase();
  let qi = 0, score = 0, lastMatch = -1;
  for(let ti = 0; ti < target.length && qi < query.length; ti++){
    if(target[ti] === query[qi]){
      score += (lastMatch === ti - 1) ? 3 : 1;
      if(ti === 0) score += 2;
      lastMatch = ti;
      qi++;
    }
  }
  return qi === query.length ? score : -1;
}
function onCmdPalInput(){ cmdPalActiveIndex = 0; renderCommandPalette(); }
function renderCommandPalette(){
  const query = document.getElementById('cmdPalInput').value.trim();
  // "Jump to #tag" rows are NOT listed by default: with many tags they buried
  // the real commands, and "Browse tags" already covers browsing. They only
  // appear when you ask for them — start the query with "#" (only tags,
  // matched on the tag name itself), or type anything else and they compete
  // with the commands as before.
  const statics = buildStaticCommands();
  if(!query){
    cmdPalFiltered = statics;
  } else if(query.startsWith('#')){
    const tagQ = query.slice(1);
    cmdPalFiltered = !tagQ ? cmdPalTagCommands.slice() : cmdPalTagCommands
      .map(c=>({ c, score: fuzzyScore(tagQ, c.label.replace(/^Jump to #/, '')) }))
      .filter(x=>x.score >= 0)
      .sort((a,b)=>b.score - a.score)
      .map(x=>x.c);
  } else {
    cmdPalFiltered = statics.concat(cmdPalTagCommands)
      .map(c=>({ c, score: fuzzyScore(query, c.label) }))
      .filter(x=>x.score >= 0)
      .sort((a,b)=>b.score - a.score)
      .map(x=>x.c);
  }
  if(cmdPalActiveIndex >= cmdPalFiltered.length) cmdPalActiveIndex = 0;
  const list = document.getElementById('cmdPalList');
  if(!cmdPalFiltered.length){
    list.innerHTML = `<div class="cmdpal-empty">No matching command</div>`;
    return;
  }
  list.innerHTML = cmdPalFiltered.map((c,i)=>`
    <button type="button" class="cmdpal-row${i === cmdPalActiveIndex ? ' active' : ''}" data-i="${i}">
      <span class="cmdpal-icon">${c.icon}</span>
      <span class="cmdpal-label">${escapeHtml(c.label)}</span>
      ${c.hint ? `<span class="cmdpal-hint">${escapeHtml(c.hint)}</span>` : ''}
    </button>`).join('');
  list.querySelectorAll('.cmdpal-row').forEach(row=>{
    row.onclick = ()=>runCommandPaletteItem(Number(row.dataset.i));
  });
}
function runCommandPaletteItem(i){
  const c = cmdPalFiltered[i];
  if(!c) return;
  closeCommandPalette();
  c.action();
}
function onCmdPalKeydown(e){
  if(e.key === 'Escape'){ e.preventDefault(); closeCommandPalette(); }
  else if(e.key === 'ArrowDown'){ e.preventDefault(); if(cmdPalFiltered.length){ cmdPalActiveIndex = (cmdPalActiveIndex + 1) % cmdPalFiltered.length; renderCommandPalette(); } }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); if(cmdPalFiltered.length){ cmdPalActiveIndex = (cmdPalActiveIndex - 1 + cmdPalFiltered.length) % cmdPalFiltered.length; renderCommandPalette(); } }
  else if(e.key === 'Enter'){ e.preventDefault(); runCommandPaletteItem(cmdPalActiveIndex); }
}
// Global Ctrl+K (Cmd+K on Mac) opens the palette from anywhere — the shelf
// list, a note, the tags page, mid-edit, wherever focus happens to be.
document.addEventListener('keydown', (e)=>{
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
    e.preventDefault();
    if(!cryptoKey) return;
    if(cmdPaletteOpen) document.getElementById('cmdPalInput').focus();
    else openCommandPalette();
  }
});

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


// ---- External notes folder (v1.50.0) ---------------------------------------
// Pick a folder (e.g. an Obsidian vault). Every .md inside becomes a "linked"
// note: reading refreshes it from the file, saving writes the file back. The
// app keeps an encrypted mirror so list/search/tags/backlinks keep working;
// the files on disk are ordinary plain text. Chromium browsers only.
const EXT_SUPPORTED = typeof window.showDirectoryPicker === 'function';
let extRoot = null, extRootName = '', extSyncing = false;
function extDb(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('shelfmark-ext',1);
    r.onupgradeneeded = ()=> r.result.createObjectStore('h');
    r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
  });
}
async function extIdb(mode, fn){
  const d = await extDb();
  return new Promise((res,rej)=>{
    const t = d.transaction('h', mode); const out = fn(t.objectStore('h'));
    t.oncomplete = ()=>res(out && out.result); t.onerror = ()=>rej(t.error);
  });
}
async function extLoad(){
  if(!EXT_SUPPORTED) return;
  try{ extRoot = (await extIdb('readonly', st=>st.get('root'))) || null; extRootName = extRoot ? extRoot.name : ''; }catch(e){}
}
async function extPerm(ask){
  if(!extRoot) return false;
  const o = { mode:'readwrite' };
  if((await extRoot.queryPermission(o)) === 'granted') return true;
  return ask ? (await extRoot.requestPermission(o)) === 'granted' : false;
}
async function extPickFolder(){
  try{
    const h = await window.showDirectoryPicker({ mode:'readwrite' });
    extRoot = h; extRootName = h.name;
    await extIdb('readwrite', st=>st.put(h,'root'));
    await extSync(true);
  }catch(e){ if(e && e.name !== 'AbortError') alert('Could not open that folder: '+e.message); }
}
async function extUnlink(){
  if(!confirm('Unlink the notes folder?\n\nFiles on disk are not touched. Notes already imported stay on your shelf as ordinary notes.')) return;
  const all = await getAll();
  for(const m of all){ if(m.extPath) await putMetaOnly(m.id, { extPath:null, extMtime:null }); }
  extRoot = null; extRootName = '';
  await extIdb('readwrite', st=>st.delete('root'));
  render();
}
async function extWalk(dir, prefix, out){
  for await (const [name, h] of dir.entries()){
    if(name.startsWith('.')) continue; // .obsidian, .git, .trash …
    if(h.kind === 'directory') await extWalk(h, prefix+name+'/', out);
    else if(/\.md$/i.test(name)) out.push({ path: prefix+name, handle: h });
  }
}
async function extFileHandle(path, create){
  const parts = path.split('/'); let d = extRoot;
  for(let i=0;i<parts.length-1;i++) d = await d.getDirectoryHandle(parts[i], { create });
  return d.getFileHandle(parts[parts.length-1], { create });
}
async function extWriteFile(path, text){
  if(!(await extPerm(true))) throw new Error('Permission to the notes folder was not granted.');
  const fh = await extFileHandle(path, false);
  const w = await fh.createWritable(); await w.write(text); await w.close();
  return (await fh.getFile()).lastModified;
}
async function extRefreshOne(id){
  if(!extRoot || !(await extPerm(false))) return;
  const rec = await getOneRaw(id); if(!rec) return;
  const meta = await decryptMeta(rec);
  if(!meta.extPath) return;
  let file; try{ file = await (await extFileHandle(meta.extPath, false)).getFile(); }catch(e){ return; }
  if(file.lastModified === meta.extMtime) return;
  await putContentOnlyRaw(id, await file.text());
  await putMetaOnly(id, { extMtime: file.lastModified });
}
// Store text without writing back to disk (used only when the disk is the source).
async function putContentOnlyRaw(id, text){
  return serialized(async ()=>{
    const rec = await getOneRaw(id); if(!rec) return;
    const { iv, cipher } = await aesEncrypt(cryptoKey, new TextEncoder().encode(text));
    rec.contentIv = iv; rec.contentCipher = cipher; await putRaw(rec);
  });
}
async function extSync(interactive){
  if(!extRoot || !cryptoKey || extSyncing) return;
  if(!(await extPerm(interactive))) return;
  extSyncing = true;
  let added = 0, updated = 0;
  try{
    const files = []; await extWalk(extRoot, '', files);
    const byPath = new Map((await getAll()).filter(m=>m.extPath).map(m=>[m.extPath, m]));
    for(const f of files){
      const file = await f.handle.getFile(); const cur = byPath.get(f.path);
      if(cur){
        if(cur.extMtime !== file.lastModified){
          await putContentOnlyRaw(cur.id, await file.text());
          await putMetaOnly(cur.id, { extMtime: file.lastModified }); updated++;
        }
      } else {
        const dirPart = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        await put({
          id: Date.now()+'-'+Math.random().toString(36).slice(2),
          title: f.path.split('/').pop().replace(/\.md$/i,''),
          category: dirPart || 'Uncategorized', type:'markdown', mime:'text/markdown',
          content: await file.text(), addedAt: file.lastModified, progress: null,
          extPath: f.path, extMtime: file.lastModified
        }); added++;
      }
    }
    if(added || updated) await render();
    if(interactive) alert(`Notes folder "${extRootName}": ${added} added, ${updated} updated, ${files.length} .md files in total.`);
  }catch(e){ if(interactive) alert('Sync failed: '+e.message); }
  finally{ extSyncing = false; }
}
extLoad();
window.addEventListener('focus', ()=>{ extSync(false); }); // back from Obsidian: refresh (no prompt)
