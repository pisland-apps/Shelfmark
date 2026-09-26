# Shelfmark

Your own shelf, added by hand — a private, offline-first personal library
for PDFs, notes (Markdown), pictures, and audio recordings. Fully
client-side: no backend, no account, no analytics. Everything is encrypted
and stored only in your browser's IndexedDB, on your own device.

## Features in this build

- **Full-screen lock screen.** On first run you set a passcode (no
  recovery — there's nothing to reset server-side, so write it down). On
  every later visit you must enter it before the shelf is shown.
- **IndexedDB encryption.** AES-256-GCM, with a key derived from your
  passcode via PBKDF2 (250,000 iterations, random per-device salt). The key
  lives only in memory for the current session — it's never written to
  disk. Item metadata (titles, categories, bookmarks, reading progress) and
  file content (PDFs/images/audio bytes, note text) are encrypted
  separately, so opening the shelf list doesn't require decrypting every
  file, only the small metadata blobs.
- **PWA / offline support.** Installable (Add to Home Screen / desktop
  install prompt), with a service worker that caches the app shell so it
  keeps working with no network connection after the first load.
- **App icon.** A dedicated icon set (192/512/maskable/apple-touch), built
  from the same PDF/Markdown/Image/Audio colors used inside the app — this
  is separate from (and replaces) the small browser-tab favicon used
  before.
- **Version badge.** Bottom-right corner, visible even on the lock screen
  before you type a passcode. See "Versioning" below.

## Files

```
index.html          — shell, lock screen markup, CSS
app.js               — all app logic, crypto, and the version badge label
service-worker.js    — offline cache (has its own version constant)
manifest.json        — Web App Manifest
icons/               — favicon.svg, icon-192.png, icon-512.png,
                        icon-maskable-512.png, apple-touch-icon.png
```

## Deploying (GitHub Pages)

1. Push this whole folder's contents to your repo (root, or a `/docs`
   folder — either works, just set GitHub Pages to serve that location).
2. Settings → Pages → deploy from the branch/folder you pushed to.
3. Open the published URL once online so the service worker installs and
   precaches the app shell — after that it works offline.

### Deploy checklist — **do this on every change, not just feature ones**

- [ ] Bump `APP_VERSION` **and** `APP_VERSION_DATE` at the top of `app.js`.
- [ ] Bump `CACHE_VERSION` at the top of `service-worker.js` to match.
      (These two are independent constants in independent files — nothing
      keeps them in sync automatically. Each file has a comment pointing at
      the other as a reminder.)
- [ ] If you added/renamed/removed any static file, update `PRECACHE_URLS`
      in `service-worker.js` to match.
- [ ] Commit and push both files together, never just one.

**Why this matters:** the version badge only tells you what code shipped in
*this build* — not what the browser is actually running right now. If you
ever see a version number after deploying that doesn't match what you
expect, that's the signal to hard-refresh (Ctrl/Cmd+Shift+R) or clear the
site's Service Worker + Cache Storage in DevTools — not a sign the deploy
itself failed. A stale service worker serving an old cached shell is the
most common reason the two look out of sync.

## Security notes

- No network calls carry your data anywhere. The only external requests
  this build makes are none at all — Google Fonts was removed in this
  version specifically so the app has zero external dependencies and works
  fully offline; UI text now uses system fonts instead of Lora/Inter.
- Forgetting your passcode has no recovery path by design (there's no
  server holding a spare key). The lock screen's "Forgot passcode" option
  wipes the local IndexedDB database entirely so you can start over —
  it does not recover old data.
- Use Export (⇡ in the header) periodically if you want a backup outside
  the browser. Choose "Encrypted" (the default) and it's protected with its
  own passphrase, separate from your app-lock passcode — pick something you
  can remember independently, since it's the only way back into that file.
  "Plain JSON" is available but fully readable by anyone who opens it; only
  use it somewhere you already trust.

## Changelog

- **v1.5.6** (2026-09-26) — Markdown notes can now link to an audio item
  already on your shelf (like an Obsidian-style internal link), not just
  external URLs. In a note, tap **🎵 Link audio** in the edit toolbar, pick
  a recording, and it inserts `[Title](shelf://<id>)` at your cursor —
  rendered as an inline play button/progress bar right in the note, using
  the same on-shelf player and on-demand decrypt as the shelf list itself
  (fully offline, no network request, unlike the external-audio-URL case
  below). If the linked recording is later deleted, tapping it shows a
  plain alert rather than doing nothing silently. Renaming the recording
  doesn't break the link (it's tied to the item's id, not its title) — but
  the label typed into the note itself won't auto-update to match.
- **v1.5.5** (2026-09-25) — Markdown note links to an audio file (URL ending
  in `.mp3`/`.m4a`/`.wav`/`.ogg`/`.oga`/`.opus`/`.aac`/`.flac`/`.weba`, with
  optional query string) now render as an inline player (`<audio
  controls>`) instead of a plain clickable link — no new syntax, still
  plain `[label](url)`. Note this is the one place in the app that can make
  a real network request: playing the track fetches it live from that URL,
  unlike every other feature, which stays fully offline (see Security notes
  above). A link to anything else still renders as a normal link.
- **v1.5.4** (2026-09-25) — Added a sort toggle for items within each
  category: "Newest" (added-date descending, the original behavior) or
  "A–Z" (title, using a numeric-aware compare so "2" sorts before "10"
  rather than after). In-memory only, resets to "Newest" on reopen, same
  as the category-collapse state below.
- **v1.5.3** (2026-09-25) — Category headers on the shelf are now
  collapsible: click a category name to hide/show its items (a chevron
  shows the state). Collapsed/expanded state is kept in memory and
  survives adding, editing or removing items, but resets to all-expanded
  each time the app is reopened.
- **v1.5.2** (2026-09-25) — Fixed export throwing "Maximum call stack
  size exceeded" on any shelf with meaningful content in it: `buf2b64`
  (used to encode the encrypted export blob) was spreading the whole
  buffer into `String.fromCharCode(...bytes)`, one function argument per
  byte, which blows the JS engine's argument-count limit well before a
  shelf with a few PDFs/images/audio files in it reaches typical export
  size. Now encodes in fixed-size chunks instead, so it works at any size.
- **v1.5.1** (2026-09-25) — Export now routes through the Web Share API
  (native share sheet) when available, falling back to the old
  anchor-download otherwise. Fixes export silently doing nothing when the
  app is installed to the iOS home screen: a standalone PWA has no browser
  chrome to catch a synthetic `<a download>` click, and the `await`s
  before the click (IndexedDB reads, PBKDF2 + AES-GCM for encrypted
  exports) also broke the direct-user-gesture requirement that trick
  depends on.
- **v1.5.0** (2026-09-25) — Storage-full handling: writes to IndexedDB
  (`putRaw`/`putAuth`/`putPrefs`/`del`) now properly reject on error instead
  of silently hanging forever if the browser refuses a write (most commonly
  a `QuotaExceededError`). Adding, editing, importing, and bookmarking all
  now show a clear message when storage is full instead of hanging with no
  feedback; auto-saved playback/reading progress fails silently instead
  (it fires too often to interrupt with alerts). Import stops cleanly and
  reports how far it got if it runs out of room partway through — you can
  free up space and re-import the same file to pick up where it left off
  (already-imported items are skipped). Added a storage-usage badge in the
  header (percentage used; tap for a detail breakdown including whether
  this origin is protected from automatic browser cleanup) — only shown
  when the browser supports `navigator.storage.estimate()`. Also now
  requests persistent storage (`navigator.storage.persist()`) once per
  unlock, best-effort, to reduce the chance of the browser evicting your
  data under disk pressure.
- **v1.4.0** (2026-09-25) — Looping is now optional: a 🔁 button in the
  header toggles it on/off (persisted, encrypted, in your settings — same
  as theme/font/size). Off by default. When on, reaching the last audio
  item in a category loops back to the first one in that category instead
  of stopping; still scoped per category, same as auto-advance.
- **v1.3.0** (2026-09-25) — Auto-advance for audio: when a track finishes,
  if there's another audio item in the same category (following shelf
  order), it starts automatically — a lightweight playlist scoped to each
  category. Playing across category boundaries still requires manually
  tapping the next one; it won't jump into a different category or loop
  back to the start.
- **v1.2.0** (2026-09-25) — Audio items now play directly from the shelf
  row: a play/pause button, inline progress bar, and elapsed/total time,
  no more jumping into the full-page reader first. A single shared audio
  element is reused across tracks and the file is only decrypted at the
  moment you press play, not for every audio row up front. Playback
  position still saves automatically (same as before).
- **v1.1.0** (2026-09-25) — Export is no longer plain JSON by default. The
  export button now opens a modal offering "Encrypted" (default) or "Plain
  JSON" (opt-in, with an inline warning). Encrypted backups use their own
  passphrase — independent of your app-lock passcode, chosen at export time
  — via AES-256-GCM with a PBKDF2-derived key (250,000 iterations, random
  salt, stored alongside the ciphertext in the file). Import auto-detects
  an encrypted backup (`encrypted:true` in the file) and prompts for its
  passphrase before merging; plain/legacy export files import unchanged.
- **v1.0.0** (2026-09-25) — Packaged from the single-file prototype into a
  multi-file PWA: added the full-screen passcode lock screen, AES-256-GCM +
  PBKDF2 IndexedDB encryption (metadata and file content encrypted
  separately), offline service worker with app-shell caching, Web App
  Manifest, a dedicated icon set replacing the old favicon, and the
  bottom-right version badge visible pre-unlock. Removed the Google Fonts
  dependency so the app has no external network dependency at all.
