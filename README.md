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

- **v1.9.0** (2026-09-26) — Multi-select. Tap the ☑ button in the header
  to enter selection mode: rows show a plain checkmark indicator instead of
  their usual play/edit/delete controls, and a bar at the bottom shows how
  many are selected with **Select all**, **Move** (bulk re-category, with
  the usual category autocomplete), **Delete**, and **Done**. Bulk delete
  reuses the same undo-toast as a single delete — "Removed N items —
  Undo" restores all of them. "Select all" only selects what's currently
  visible, so it respects an active search filter. The mini-player is
  hidden while selecting (it'd otherwise compete for the same space at the
  bottom of the screen) and reappears once you tap Done.
- **v1.8.0** (2026-09-26) — Persistent mini-player, plus a real bug this
  surfaced along the way:
  - **Found while building this**: the full-page audio player (disc/cover
    art, ±10s skip, scrub bar, the speed control from v1.7.0) was
    unreachable dead code — audio items only ever opened through the
    compact shelf-row/note-widget player (`toggleShelfPlay`), never through
    `openReader()`, so that whole branch never ran, and it built its own
    *separate* `<audio>` element that would have played independently
    alongside the shared one had anything ever reached it.
  - **Fixed by unifying the two into one.** The full player now reuses the
    exact same shared audio element as the shelf list and note links —
    there is only ever one "now playing" state — and is reachable via a new
    ↗ button on audio shelf rows and on the note-embedded player widget.
  - **New: a persistent mini-player**, a fixed bar at the bottom of the
    screen showing title, progress, and play/pause, visible from the shelf
    list AND from inside the reader (a PDF, a note, an image) — so
    starting a recording, then opening something else to read, doesn't
    stop it or lose your controls. Tap the bar to jump to the full player;
    the × stops playback outright. Hidden specifically when the full
    player is already open for that exact track, since its controls are
    right there.
  - Closing the reader no longer stops playback — previously it force-
    paused the (separate, actually-unreachable) `<audio>` element; now
    closing out of the full player leaves the shared track exactly as it
    was, which is the point of having a mini-player at all.
- **v1.7.0** (2026-09-26) — Four of the suggestions from the last review,
  the more contained ones:
  - **Search.** A search box under the header filters the shelf by title
    and category as you type. Deliberately doesn't search inside note
    content — that would mean decrypting every note on every keystroke,
    which isn't worth the cost for what's meant to be a fast filter.
  - **Undo on delete.** Removing an item no longer asks for confirmation —
    it's deleted immediately, but a toast with an Undo button stays up for
    6 seconds and can bring it back exactly as it was. Only one undo slot:
    deleting something new while a previous delete is still undoable lets
    that earlier one's grace period lapse right away (it's already
    permanently gone either way). Closing the tab during the window means
    the delete stands — undo only works within the same session.
  - **Markdown: task checklists, blockquotes, ordered lists.**
    `- [ ] text` / `- [x] text` renders as a real, tappable checkbox that
    flips the source text and saves immediately — no need to open the
    editor just to check something off. `> quoted text` and `1. item`
    numbered lists now render properly too (previously fell through to
    plain paragraphs).
  - **Playback speed** on the recording player (0.5x–2x, cycled by a
    button next to the scrub bar). Sticks for the rest of the session —
    not saved across app restarts — so it carries over between recordings
    the way a podcast app's speed setting would.

  Left for later, since they're bigger jobs: a persistent mini-player,
  multi-select, PDF reading progress (needs swapping the native iframe
  viewer for a vendored pdf.js renderer), and extending shelf:// links
  (with backlinks) to note-to-note and note-to-PDF, not just note-to-audio.
- **v1.6.1** (2026-09-26) — Review/hardening pass over the last few
  releases, no new features:
  - **Security fix**: an item's `cover` field was inserted into `<img
    src="...">` markup unescaped in four places (shelf rows, PDF reader,
    audio reader). Covers the app generates itself are always safe, but an
    imported backup file could put arbitrary text there — this was a real
    HTML-attribute-injection opening via a crafted import. Fixed two ways:
    imported covers are now validated as an actual `data:image/...;base64,`
    string (anything else is dropped), and every render site now escapes
    the value regardless, matching how title/category are already handled.
  - Fixed transparent PNG covers rendering with a solid black background
    (JPEG has no alpha channel; the canvas used to resize covers now fills
    white first before flattening).
  - Added `min-height:0` to the PDF-with-cover flex layout, defensive
    against the iframe overflowing its column in some browsers.
  - Shortened the note editor's "🎵 Link audio" toolbar button to "🎵 Audio"
    — the 3-button toolbar (Cancel / Audio / Save) was tight on narrow
    phones and could wrap.
- **v1.6.0** (2026-09-26) — Optional cover image for notes, PDFs, and
  recordings (not pictures — those already are the cover). Pick one when
  adding an item, or add/change/remove it later from the item's Edit
  (pencil) button. Shows as a small square thumbnail on the shelf list and
  as a full banner image when you open the item (replaces the plain music
  note icon on the audio player screen). Stored as a resized, compressed
  JPEG (max 640px) right in the item's existing encrypted metadata rather
  than as a separate encrypted field — keeps it simple and still fully
  offline, but means every item's metadata (cover included) gets decrypted
  each time the shelf list renders, so covers are deliberately kept small.
  Included in both encrypted and plain-JSON export/import.
- **v1.5.6** (2026-09-26) — Markdown notes can now link to an audio item
  already on your shelf (like an Obsidian-style internal link), not just
  external URLs. In a note, tap **🎵 Audio** in the edit toolbar, pick
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
