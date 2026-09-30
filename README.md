# Shelfmark

Your own shelf, added by hand — a private, offline-first personal library
for PDFs, notes (Markdown), pictures, and audio recordings. Fully
client-side: no backend, no account, no analytics. Everything is encrypted
and stored only in your browser's IndexedDB, on your own device.

## Features in this build

- **Table of contents beside the note on wide screens (v1.57.0).** On a PC or a tablet held sideways
  (window at least 800px wide) the ☰ outline is no longer a dropdown: it sits as a column on the left of the
  note, open by default, and stays there while you read. Tap a row to jump; Collapse all / Expand all stay at
  the top of the column. The ☰ button now shows or hides the column, and Shelfmark remembers your choice. On a
  phone or a narrow window nothing changes: ☰ still opens the dropdown. Nothing is stored except that one
  show/hide setting.

- **Callouts in the outline (v1.56.2).** A callout card (`> [!note] Title`, any type word) appears in the ☰
  outline as a small italic row with a green bar, showing the card's title, listed under the heading above it.
  Tap it to jump there. Plain quotes (`> text`) are not listed (v1.56.0 listed them; v1.56.2 removed that).

- **Tap outside to close panels (v1.55.0).** The ⚙ / ☰ / 🔖 panels and the Index ▾ dropdown in the reader top
  bar now close when you tap anywhere outside them, or press Escape — not only by tapping the same button
  again. Tapping inside a panel keeps it open; tapping its own button still toggles it. Only one is open at a
  time, as before.

- **Index dropdown on every page (v1.54.0).** If your shelf has a note titled **Index**, every other
  item's top bar gets an **Index ▾** button. Tap it and the Index note's content drops down (the live
  ```` ```index ```` table or any links you wrote by hand); tap an item to jump straight to it, no trip back
  to the shelf. Works on notes, PDFs, pictures and recordings, and is hidden on the Index note itself and
  when no note is titled Index. Nothing is stored; it is rebuilt each time.

- **Reading look per page (v1.53.0).** In a note's ⚙ panel, *Apply to* chooses **All pages**
  (the old app-wide setting) or **This page only**. A page's own page color / font / text size is
  saved with that note and wins over the app-wide one while the note is open; only the options you
  set for the page are stored, the rest still follow the app. The ⚙ button is highlighted on a note
  that has its own look, and *Reset this page to the app-wide look* removes it. Notes only (PDFs,
  pictures and audio have no reading panel). The Ctrl+K Theme commands stay app-wide.

- **Auto-lock and Lock now (passcode mode).** The shelf locks itself after 10
  minutes without a tap/key/scroll, or after 5 minutes in the background
  (both adjustable, or Never, under Ctrl+K → *Passcode & lock*). Ctrl+K →
  *Lock now* locks at once. An unsaved note edit is kept as a draft. It waits
  while sound is playing or an export/import is running. Not used in
  no-passcode mode.
- **Edit tables in reading view.** Tap a cell, type, Enter to save; Tab moves
  on; a bar adds/deletes rows and columns. No need to open the source editor.
- **Foldable headings (H1–H6).** Tap the arrow at the right of any heading in
  reading view to fold the section under it; the outline has Collapse all /
  Expand all. Folds are remembered per note.
- **Draft autosave.** While you edit a note, the text is saved as a
  separate draft every 3 seconds (and instantly when you leave). Back out,
  switch away or lose the page by accident and the note opens with an
  "Unsaved draft" banner: Continue editing / Discard. Save and Cancel keep
  their meaning — only Save changes the note; Cancel asks before throwing
  changes away.
- **Find & replace in a note.** A 🔍 button in the note page's top bar
  (or Ctrl/Cmd+F) opens a find bar: matches are highlighted in reading
  view with a prev/next stepper and a `3/12` counter; a match-case toggle
  (Aa) is included. In the editor the same bar gains Replace and All —
  Replace All is one Undo step.
- **Deep search (note text).** A toggle button beside the search box
  (off by default, resets to off on every reopen) makes search also match
  inside markdown notes' own text, not just title/category. Debounced
  (300 ms) so typing doesn't decrypt the whole shelf once per letter.
- **Markdown formatting help.** A new **?** button in the note editor
  toolbar (and a "Markdown formatting help" entry in the command palette,
  reachable from anywhere) opens a guide covering every syntax the
  editor supports (docked beside/above the text while editing, so it stays
  visible as you type; a modal overlay elsewhere) — bold/italic/~~strikethrough~~/==highlight== (with the S / A toolbar buttons)/headings, lists and `- [ ]` checklists,
  `> [!note]`-style callouts (including foldable `[!note]-` / `[!note]+`), fenced code blocks, tables, images/dividers,
  external links, the three shelf-link pickers (🎵/🔗/📄), `[[Wiki links]]`,
  and `#tags` — each shown as the literal syntax next to its already-
  rendered result. Fully static and offline: no network fetch, and it
  doesn't reuse the note renderer itself (see the Changelog's v1.27.0 entry
  for why).
- **Note → PDF links.** The 📄 button in the note editor toolbar (next to
  🎵 Audio and 🔗 Note) links to a PDF already on your shelf the same way —
  inserts `[Title](shelf://<id>)`, and the note reader shows it as a small
  tappable jump widget (PDF-red accent, matching the app's type colors)
  instead of a plain link. This is the last of the three `shelf://` target
  types (audio, note, now PDF); see the Changelog's v1.26.0 entry.
- **Full-screen lock screen (optional).** On first run you set a passcode (no
  recovery — there's nothing to reset server-side, so write it down). On
  every later visit you must enter it before the shelf is shown. Or tap
  "Continue without a passcode" to skip the lock screen entirely (see
  "No-passcode mode" below).
- **No-passcode mode.** Shelfmark generates a random, non-extractable
  AES-256 key and keeps it in IndexedDB beside the data, so the app opens
  straight to the shelf. Data is still encrypted at rest, but anyone who can
  open this browser profile can read it — pick this only on a device you
  trust. Switch either way later from the command palette (Ctrl+K → "Set a
  passcode…" / "Remove passcode…"); every item is re-encrypted in one
  all-or-nothing write, so a failure leaves your current setup untouched.
- **IndexedDB encryption.** AES-256-GCM, with a key derived from your
  passcode via PBKDF2 (600,000 iterations for passcodes set from v1.51.8; earlier
  shelves keep the 250,000 they were made with; random per-device salt). The key
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
- **#Tags, alongside categories.** Type `#word` anywhere in a note's text to
  tag it — a note can carry any number of tags, on top of its one category.
  The header's `#` button opens a Tags page: a cloud of every tag in use,
  tap one to see the notes that carry it.
- **Auto table of contents.** A note's `#`/`##`/`###` headings are picked up
  automatically — no separate step to build it — and shown as a jump-to
  outline (the &#9776; button next to the reader's bookmark button), same
  panel style as bookmarks, just generated instead of hand-picked.
- **Export a single item.** The &#8679; button in the reader (any item type)
  saves just that note/PDF/picture/recording as its own plain file — a
  `.md` for a note, the original bytes for everything else — no encryption,
  no wrapper JSON, so it opens straight up in any other app. Separate from
  the header's whole-shelf backup export below.
- **Tap a paragraph to edit it.** Reading a note and tapping (mouse click,
  or touch long-press for a "Edit this paragraph" menu) a paragraph jumps
  straight into the source editor with the caret already there, instead of
  only landing at the top via the pencil button.
- **Callouts.** A blockquote starting with `[!note]`, `[!warning]`, or
  `[!idea]` renders as a colored card (any other `[!type]` still gets a
  generic-accented card) instead of a plain quote — same palette as the
  PDF/Markdown/Image/Audio type colors used everywhere else.
- **Undo/Redo in the note editor.** Toolbar buttons (Bold, Heading, image
  insert, etc.) all bypass the browser's native undo history by setting the
  textarea's value directly, so this is a small undo/redo stack of the
  app's own — Ctrl+Z/Ctrl+Shift+Z or the ↩/↪ toolbar buttons, one step per
  toolbar action, typing grouped into one step per pause.
- **Command palette.** 🔍 in the header, or Ctrl+K/⌘K from anywhere, opens a
  fuzzy-searchable list of app-wide actions (new note, import/export,
  themes, sort/loop toggles, storage) plus a "jump to #tag" entry per tag —
  see the Changelog's v1.25.0 entry for the full list and why it replaced
  the old header icon strip.

## Files

```
index.html          — shell, lock screen markup, CSS
app.js               — all app logic, crypto, and the version badge label
service-worker.js    — offline cache (has its own version constant)
manifest.json        — Web App Manifest
icons/               — favicon.svg, icon-192.png, icon-512.png,
                        icon-maskable-512.png, apple-touch-icon.png
lib/                  — vendored pdf.js (pdf.min.mjs, pdf.worker.min.mjs),
                        used by the PDF reader; no CDN dependency
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

- Nothing in a note can make the app contact a server. The app itself makes no external
  requests, and the page's Content-Security-Policy only allows images and audio from the
  app itself, `data:` and `blob:`. A remote `http(s)` image or audio link inside a note (one
  you wrote, or one from an imported backup or a synced notes folder) is shown as a plain link
  and is never loaded; tapping it opens the address in a new tab, which is then an ordinary
  visit to that site. Pictures pasted into a note (`data:`) still display.
- Treat an imported backup, and any folder you link for notes sync, as
  untrusted input, not just your own data — they're read from disk/file and
  parsed, so a corrupted or tampered file is handled defensively (bad items
  are skipped, not blindly trusted) rather than assumed safe.
- Auto-lock (v1.51.11) closes the gap of leaving an unlocked shelf open on a
  phone or shared computer: the key lives only in memory, and locking drops it
  and reloads the page, which also discards every decrypted thing held in
  memory (open note, PDF pages, audio, search results). It is a convenience
  guard, not a defence against someone already using the unlocked app, and it
  does not apply in no-passcode mode (the key is stored in the browser there).
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

- **v1.56.0** (2026-09-30) — Plain quote blocks are listed in the ☰ outline next to the headings.
- **v1.56.1** (2026-09-30) — Callout type can now be any word, including Chinese (`> [!重装流程]`); before, only letters/digits/underscore worked and anything else showed as a plain italic quote with the `!`.
- **v1.56.2** (2026-09-30) — The ☰ outline now lists callout cards (by title) instead of plain quotes.
  - Each quote shows as an italic row with a green bar, under the heading it sits below; tap to jump. Only
    the first line is shown (80 characters at most). Callouts are not listed. Nothing is stored.
- **v1.57.0** (2026-09-30) — On wide screens the ☰ outline docks as a left column beside the note (open by default; ☰ shows/hides it, remembered). Phones keep the dropdown.
  - New pref `tocSideHidden` (default false). The dropdown's outside-click / Escape closing is unchanged and does not touch the docked column.
- **v1.57.1** (2026-09-30) — Outline callout rows are always flush-left (no longer nested under the heading above). A callout with no title now shows its type exactly as typed (`[!CosyVoice-300M-Instruct]` was shown as `Cosyvoice-300m-instruct`).

- **v1.55.2** (2026-09-30) — A code block with blank lines inside it is now one block, with one Copy button for all of it.
  - Before: the reader split the note at every blank line after the code was already turned into HTML, so a
    block with a blank line in it was cut in two. Copy only covered the part above the first blank line, and
    the rest showed as loose paragraphs. Now blank lines inside a block are protected while the note is split,
    and block numbers still match the raw text, so bookmarks, paragraph edit and task checkboxes stay aligned.
  - Also (v1.55.1): a fence can be 4+ backticks and closes on its own line, so code that itself contains three
    backticks can be wrapped in four.
  - No data-format change. Tests: `tests/test_fences.js` (35 checks).
- **v1.55.0** (2026-09-30) — Top-bar panels close on an outside tap or Escape.
  - Before: ⚙ settings, ☰ outline, 🔖 bookmarks and the Index ▾ dropdown closed only by tapping their own
    button again. Now one capture-phase `click` listener closes whichever is open when the tap lands outside
    every panel and every panel button (`closeTopBarPanels`), and Escape does the same unless the Ctrl+K palette
    is open. It never calls `preventDefault`, so the tapped control still works (the tap both closes the panel
    and does its normal job).
  - No data-format change; nothing stored. Tests: `tests/test_panel_outside_click.js`.

- **v1.54.0** (2026-09-29) — "Index ▾" button in the reader top bar.
  - Looks for a markdown note titled `Index` (case-insensitive, first match). If found, and you are not
    already on it, the button shows on every item type; tapping it renders that note in a dropdown and
    tapping a link opens the item (which closes the dropdown). Opens/closes with the other top-bar panels
    (⚙, ☰, 🔖): only one is open at a time.
  - The dropdown copy has its bookmark/outline hooks (`.mdblock`, `data-idx`) removed so the reader's
    own bookmark, outline and find code can never match it.
  - No data-format change; nothing stored. Tests: `tests/test_index_dropdown.js`.

- **v1.53.0** (2026-09-29) — Page color, font and text size can be set for one note.
  - The ⚙ panel gained an *Apply to* switch: **All pages** (unchanged behaviour) or **This page only**.
    A page's setting is stored in that note's metadata (`readerPrefs`, only the keys you changed) and is
    applied on top of the app-wide setting when the note opens; closing the note puts the app-wide look
    back. Opening a note that has its own look starts the panel on *This page only*.
  - Kept with the note through rename, move, edit, and export / import (plain and encrypted backups);
    values are checked on read (`readPrefsClean`), so a hand-edited or old backup can only ever set a known
    theme, font or size. Backups without the field import as before.
  - Not changed: the Ctrl+K *Theme:* commands and the app-wide values themselves. **One-way, mildly:** an
    older build ignores `readerPrefs` (harmless) and drops it the next time it re-saves that note's metadata
    from an import.
  - Tests: `tests/test_page_reading_prefs.js` (30 checks; fails on v1.52.5). `tests/test_dispatcher.js` now
    clicks the panel's `setReadPref` buttons instead of `setPref`.
  - **By hand:** open a note, ⚙ → *This page only* → pick Sepia + XL, close and reopen it (still Sepia + XL),
    open another note (unchanged), then *Reset this page…*; try it on a phone in the installed PWA.

- **v1.52.5** (2026-09-29) — Smaller fixes from the v1.52.1 review.
  - **Service worker: no stale precache.** The offline cache was filled with `cache.addAll()`, which goes
    through the browser's HTTP cache. On a host that caches files for a few minutes (GitHub Pages sends about
    10), a deploy soon after a previous visit could store the *old* `app.js` under the *new* cache name.
    Each file is now fetched with `cache: 'reload'`. Still all-or-nothing (any failed file fails the
    install). A dead `.catch(()=>cached)` in the fetch handler was removed.
  - **Passcode change:** holds off auto-lock while it runs, and reads the old records one at a time instead of
    loading the whole shelf first. Measured in Node with fake-indexeddb on a 200 MB shelf (directional
    only): the read phase peaked at about 2.1x the shelf before and about 1.3x now. The overall peak did
    not change in that test, because the single all-or-nothing write at the end sets it there. Not measured
    in a real browser. A big shelf may still run out of memory on a phone when changing the passcode; the
    failure is safe (nothing is written, the old passcode keeps working). Making the write lighter would need
    a staged rewrite and is not done.
  - **Auto-lock and audio:** documented, not changed. While sound is playing the shelf stays open, so a
    recording set to repeat keeps it open until you stop it (the panel text now says so). If a lock was due
    but held back and you come back to the app, the timers restart; only the timer retries a held-back lock.
  - Tests: `tests/test_service_worker.js` (5 checks), `tests/test_rekey_hold.js` (6 checks; 4 fail on v1.52.3).
  - **Still worth doing by hand:** deploy twice within ten minutes and check the installed app picks up the new
    build; change the passcode on a shelf with a few hundred MB on a phone.
- **v1.52.4** (2026-09-29) — Remote images / audio in notes: removed the "load" switch.
  - **Why.** The switch could never work: the Content-Security-Policy (`img-src` / `media-src` allow only
    the app itself, `data:` and `blob:`) blocks a remote image or audio file no matter what the app asks
    for, so "tap to load" produced a broken picture, and the README said otherwise. The tap handler also
    rebuilt an `<audio>` element from the link with `innerHTML`; a crafted link could add extra attributes
    to it (an `onplay=` was added in a test). The policy stopped it from running, but it was the same kind
    of gap steps 1 and 2 closed.
  - **What changed.** A remote `![](https://...)` or https audio link is now shown as a plain link (opens in
    a new tab when tapped, `noopener`); nothing is ever loaded from a note. The command-palette entry,
    the setting and the tap handler are gone. Old saved settings that still contain the key are harmless.
  - **Behaviour change to know about:** remote images can no longer be shown inside a note. If you want one,
    save the picture and paste it in (it is then a `data:` image on your shelf).
  - Tests: `tests/test_remote_media.js` (16 checks; 10 fail on v1.52.3), `tests/test_links.js` updated.
- **v1.52.3** (2026-09-29) — Fix: the shelf listing no longer loads every file's content into memory.
  - **The problem.** Listing items (home screen, palette, search, `[[links]]`, tags, and about 15 more
    places) went through `store.getAll()`, which returns whole records, PDF / recording / picture
    ciphertext included, only for the app to decrypt the small metadata part. Opening the edit
    dialog for one item did the same for the whole shelf. In a Node + fake-indexeddb measurement with
    a 200 MB shelf, that added about 160 MB of memory per listing versus about 40 MB for the fix
    (directional only; not measured in a browser).
  - **The fix.** `getAll()` now walks a cursor and keeps only the four fields it decrypts (`getAllMetaRaw`),
    and the edit dialog reads one record (`getMeta`). Results are identical to before, including for
    old-format records. No data or format change; nothing to migrate and no rollback issue.
  - Tests: `tests/test_list_meta.js` (8 checks).
  - **Still worth doing by hand:** a shelf with a few hundred MB of PDFs on a phone: open the app,
    change category, open the palette, edit an item, and check that nothing stalls.
- **v1.52.2** (2026-09-29) — Fix: erasing (or upgrading) with two Shelfmark windows open.
  - **The problem.** The main database never reacted to `versionchange`, unlike the folder-link one. With
    the app open in a browser tab and as an installed app, "erase shelf" in one window was blocked by the
    other, yet was treated as finished: the page reloaded with the data still there and then waited on the
    pending delete. A future schema upgrade would have been blocked the same way.
  - **The fix.** Every window now closes its connection when another one erases or upgrades and shows a
    banner asking to reload. Erase waits up to 5 seconds for the delete; if another window still blocks
    it, it says so and does not reload (the delete finishes on its own once that window closes).
  - Tests: `tests/test_db_versionchange.js` (10 checks; on v1.52.1 it does not finish, and the new
    watchdog ends the run).
  - **Still worth doing by hand:** installed app plus a browser tab on the same shelf: erase in one and
    check the other shows the banner and the shelf is empty after reload.
- **v1.52.1** (2026-09-29) — Fix: a save that failed at the very end (typically "storage
  full") could be reported as saved and then quietly dropped.
  - **The bug (since the first version, found while testing v1.52.0).** IndexedDB reports a
    `put()` as successful first and commits it afterwards; a quota failure only shows up at the
    commit. The save helpers resolved on the first signal, so the app believed the write had
    happened. Measured in real Chromium with a capped quota, on v1.51.14: 15 PDFs of 20 MB were
    added, every add said OK, and only 10 were on the shelf. An import said "added 15 new items"
    for a shelf that held 10 of them. The "storage is full" messages that already exist in about
    eight places (add, edit, bookmark, table edit, import) could never appear for this case.
  - **The fix.** The four write helpers (items, delete, passcode record, preferences) now finish
    only when the transaction commits, and fail with the browser's own error otherwise, so every
    existing "storage is full" message now works and an import stops at the first item that does
    not fit and counts only what was really stored. Same fix as the passcode change and folder
    link writes already had. Same real-Chromium repro on v1.52.1: the items that do not fit fail
    with `QuotaExceededError`, and stored count equals the count that said OK (12 and 12).
  - **Cost.** Each write waits for its commit; a 300 MB import went from about 10 s to about 12.5 s.
  - **Known, left alone.** (1) Items already lost to this bug in the past are not recoverable
    from here. If a shelf ever filled up, compare it with your latest backup. (2) After a "storage
    is full" stop, a v2 import still reads the rest of the file (nothing more is stored), so it
    can take a moment before it reports. (3) `test_autolock.js` still hangs in jsdom.
  - Tests: `tests/test_commit_failure.js` (12 checks; 7 fail on v1.52.0, including the import
    claiming 5 items when 2 were stored). A test probe `__getDb` / `__setDb` was added to `load.js`.
- **v1.52.0** (2026-09-29) — Whole-shelf backups no longer hold the shelf in memory:
  a new streamed, chunked encrypted format, and one-item-at-a-time import.
  - **Why.** The old encrypted export built the shelf as several giant strings at once
    (data: URLs, one JSON string, its bytes, the ciphertext, that ciphertext as base64,
    the wrapper JSON), 1.33x to 1.78x the shelf each. Chromium's single-string limit
    (about 512 MiB) puts the ceiling near a 290 MB shelf, and memory ran out well before.
  - **Measured** (real Chromium, 4 GB / 1 CPU test machine, 20 MB PDFs): v1.51.14 exported
    a 100 MB shelf as a 178 MB file (1.78x) using about +1.5 GB of memory, and the tab
    then crashed importing that same file; a 200 MB shelf crashed the tab during export.
    v1.52.0 exported and re-imported 100, 200, 300 and 400 MB shelves; the file is the same
    size as the shelf (1.00x) and every item came back byte-identical (SHA-256). Peak memory
    was about 1.1 to 1.3 GB during export and 1.3 to 1.8 GB during import (baseline about
    0.6 to 0.7 GB): far lower than before, but it still grows somewhat with shelf size,
    so it is "much flatter", not flat.
  - **Encrypted backups are now `.shelfmark` files** (binary, not JSON). Each item's bytes
    are sealed in 8 MB segments with their own IVs. Every segment is bound (AES-GCM
    additional data) to the file header, its item number, its segment number and a
    last-segment flag, and the file ends with an authenticated item-count trailer, so a
    dropped, reordered, duplicated, truncated or spliced-in piece fails, not just a
    flipped byte.
  - **Import** reads the file in slices, never as one string. It first checks the whole
    file (nothing is retained), and only then imports item by item, so a damaged or
    altered file imports **nothing** and says so. A wrong passphrase still reads
    "Incorrect passphrase."; a damaged file reads as damaged. Same newer-wins rule,
    counts, storage-full stop and shelf-identity adoption as before. Cancel is honoured.
  - **Saving.** Where the browser has the save dialog (desktop Chromium) the file streams
    straight to disk; elsewhere it is built from small parts and downloaded as before.
    The dialog is opened first thing on the click (it is refused after any wait).
    Export shows "item n of N", and Cancel discards the half-written file.
  - **Plain JSON export** keeps exactly the old format (older versions can read it) but is
    assembled item by item.
  - **Behaviour change (one-way):** a `.shelfmark` file **cannot be opened by v1.51.14 or
    earlier**. Every older backup (encrypted or plain, with or without `iterations`,
    `shelfId` or `updatedAt`) still imports in v1.52.0.
  - **Known, left alone.** (1) Each item is still handled whole in memory while it is
    read, sealed or stored, so one very large single file costs a few times its own size.
    (2) An old-format (single JSON string) backup over 256 MB is refused with a message
    instead of freezing the tab; open it in the version that made it and re-export.
    (3) A plain JSON backup is still one JSON file, so importing a very large one is
    limited by the same 256 MB guard; use an encrypted backup for big shelves.
    (4) The import picker no longer filters by file type (a `.shelfmark` file is not JSON).
    (5) Test suites: `test_autolock.js` still hangs in the jsdom run (as on v1.51.12).
  - Tests: `tests/test_export_stream.js` (89 checks: round trip at chunk sizes 1, 7, 14, 100,
    101 and 1000; zero-byte and exact-multiple items; truncation, flipped bytes, dropped,
    swapped, duplicated and grafted frames, edited header, hostile header fields, a 4 GB
    frame length; wrong passphrase; the save-dialog path; cancel; plain round trip; and
    the v1.51.14 fixtures in `tests/fixtures/`, made by `tests/make_legacy_fixtures.js`).
    Against v1.51.14 the new-format checks fail. `test_item_binding.js` now reads its
    export through a plain `doExport`, since `buildExportItems` is gone.
- **v1.51.14** (2026-09-29) — Fixes: code fences must start a line; Undo no longer
  survives a passcode change.
  - **Code fences.** An opening fence (three backticks) now has to be at the start of a
    line; leading spaces or a tab are fine, so a fence indented inside a list still works.
    Before, three backticks anywhere opened a block, so a line that merely mentioned them
    inside an inline code span swallowed everything up to the next fence and showed it as
    code (this is what garbled the older entries in this changelog). An opener with no
    closing fence stays plain text. The closing fence is unchanged (the next three
    backticks after the opener). The reading view, the Tags page and the editor's
    "am I inside a code block" check share one rule.
  - **Behaviour change:** a block written after other text on the same line, such as
    `see: ` followed by three backticks and code, is no longer a block. Put the fence on its own line.
  - **Undo vs passcode change.** Undo restores a record exactly as it was encrypted at
    delete time. If a passcode was set or removed inside the 6-second Undo window, that
    record would have come back under the old key and could never be opened, and one such
    record stops the whole shelf from listing. A passcode change now empties the Undo slot
    and hides the toast. A delete that was already in progress when the key changed is
    also final (no Undo is offered).
  - Tests: `tests/test_fences.js` (26 checks; 5 fail on v1.51.12) and
    `tests/test_undo_rekey.js` (17 checks; fails on v1.51.12). Also run in real Chromium.

- **v1.51.13** (2026-09-29) — Hardening: each encrypted record is now tied to its own id.
  - Every encrypted blob of an item (details, content, unsaved draft) is sealed with
    AES-GCM additional data naming the item's id and which blob it is. A record copied
    onto a different id, or a blob swapped into another slot, no longer decrypts. This
    guards against someone with write access to this browser's storage (not your
    passcode) rearranging records; it hides nothing new and changes no key.
  - **Old data keeps working.** Items saved before this version have no such tie and open
    as before. Each blob picks it up the next time it is written: details on a rename,
    move, progress or bookmark change; content on a note save; a draft on its next
    autosave; everything on setting or removing the passcode. A large PDF or recording is
    not rewritten by normal use, so it stays in the old form until the passcode is changed.
    Nothing is migrated in the background and no prompt appears.
  - Backups (encrypted and plain) are unchanged: they carry decrypted content and are
    re-encrypted under each item's id on import, so old backups import as before.
  - **One-way:** once an item has been saved by this version, an older version (v1.51.12
    or earlier) cannot open it. Take a backup before updating if you might roll back.
  - Tests: `tests/test_item_binding.js` (42 checks; 17 fail on v1.51.12). Also run in
    real Chromium: copy-to-another-id refused, an old record and a 40 MB old PDF open
    (one decrypt each), passcode change binds everything, reload + unlock.

- **v1.51.12** (2026-09-29) — Fix: inline code holding a literal backtick turned
  the rest of the note into code.
  - A double-backtick span such as ``a ` b`` left an unclosed
    `<code>`, and the browser applied code styling to everything below it. Inline
    code now follows CommonMark: N backticks close at the next run of exactly N.
  - A span must close on the same line; a backtick with no partner is plain text.
    (Before, a single-backtick span could continue onto the next line of a
    paragraph; now both backticks show as text.)
  - The Tags page reads code spans the same way as reading view.
  - Tests: `tests/test_inline_code.js`.

- **v1.51.11** (2026-09-29) — Auto-lock, plus a "Lock now" command (the app
  had no manual lock before).
  - **Idle lock and background lock** (passcode mode only). Defaults: 10 minutes
    idle, 5 minutes in the background; each can be set to Never (idle: 2 / 5 /
    10 / 30; background: 1 / 5 / 15) in the *Passcode & lock* panel. Settings are
    kept in the encrypted prefs. Both rules are checked every 15 s and again when
    the tab comes back to the foreground (timers are throttled in the background,
    so the elapsed time is compared against the clock, not counted).
  - **What locking does.** Cover the screen, save a mid-edit note as a draft, wait
    (up to 4 s) for queued writes, drop `cryptoKey`, reload. The reload is on
    purpose: it clears everything decrypted in memory without tracking each
    piece. After unlocking, the draft is offered back as usual.
  - **What it waits for.** It does not lock while sound is playing (a reload
    would cut it off) or while an export/import runs (`holdAutoLock`); it locks at
    the next check once that ends.
  - **Lock now** in the command palette and in the *Passcode & lock* panel.
  - **Known limits.** An unsaved table-cell edit (not a note edit) is not kept. Undo
    for a delete made just before locking is gone after the reload. Idle is
    measured by input events, so reading a long note without touching anything
    counts as idle: raise the idle time, or set it to Never, if that annoys you.
  - Tests: `tests/test_autolock.js`. Also checked by hand-scripted run in real
    Chromium with a virtual clock (idle, background, palette, draft, settings,
    audio hold, no-passcode mode).

- **v1.51.10** (2026-09-29) — Two hardening fixes from the remaining-fixes list,
  plus a rendering bug found while testing the second one.
  - **Writes are queued.** `put()`, `del()` and the Undo restore now go through
    the same write queue as every other writer (`putMetaOnly`,
    `putContentOnly`, drafts). Before, a delete could land while another writer
    was between reading a record and writing it back, and that writer then
    put its stale copy back: a deleted item came back, or an import/add was
    overwritten by an old copy. Encryption in `put()` now happens inside the
    queue, so an item added during a passcode change is stored under the new
    key instead of the old one. A failed put still rejects for its caller and
    does not block later writes.
  - **Placeholder forgery.** `renderMarkdown` marks fenced code blocks with a
    NUL-delimited token. A literal NUL in a note (crafted backup, synced `.md`)
    is now stripped first, so it can't splice another block's HTML into the
    page or print "undefined". The token swap is one pass, so text inside a
    block can never pose as a token either. Same guard for the inline-mark
    placeholders in `applyInlineMarks`.
  - **Bug found on the way:** code samples containing `$&`, `` $` `` or `$'`
    (a regex, a shell line; `$'` is stored as `$&#39;`) came out garbled, e.g.
    `s.replace(/x/, '$&')` showed `CODEBLOCK0amp;`. The old splice passed the
    HTML as a plain replacement string, where JS treats those as commands; it
    now uses a replacer function.
  - Tests: `tests/test_write_queue.js` (10 checks; forces the interleavings, and
    fails on v1.51.9), and 26 new cases in `tests/test_links.js` (forged
    tokens, `$`-patterns).

- **v1.51.9** (2026-09-29) — Clearer import summary. The message used to say
  "skipped N items that looked corrupted or outdated", which lumped two very
  different things together and alarmed people whose shelf was simply newer
  than the backup. Now it says:
  - "left N items unchanged because your shelf already has a newer copy" — the
    normal, harmless case (the v1.51.3 newer-wins rule; a linked notes-folder
    note counts as newer every time its file changes), and
  - "skipped N items that couldn't be read (unknown type or damaged data)" —
    the backup item itself was unusable.
  - Nothing about what is imported changed, only the wording and the split of
    the counts. Tests: new `tests/test_import_merge.js` (10 checks).

- **v1.51.8** (2026-09-29) — Stronger key derivation for new passcodes and
  backups, and a guard against crafted backup files. The 4-character minimum
  passcode is unchanged.
  - **600,000 PBKDF2 iterations** (was 250,000) for every *new* passcode and
    every *new* encrypted export. Each stored record already carries its own
    count, so an existing shelf keeps opening with the count it was made with
    and old backups still import; nothing is migrated. An existing shelf only
    moves to 600,000 when you set a new passcode (Ctrl+K → remove passcode,
    then set one again), because that re-encrypts everything with a new key.
    Unlocking is a little slower (about 0.1–0.3 s on a desktop, possibly around
    a second on an old phone).
  - **Backup iteration count is validated** (`safeIterations`): it must be a
    whole number from 1 to 1,000,000. A crafted backup asking for a billion
    rounds is refused with a clear message when the file is chosen, before any
    passphrase prompt, and again in `doImportDecrypt`. A tampered stored
    passcode record is refused the same way.
  - **Legacy fix built in:** a backup with *no* `iterations` field at all is
    read with the old default of 250,000, not the new 600,000. Without this,
    such an old backup would have been reported as "Incorrect passphrase".
  - **Passcode strength hint** (advisory, blocks nothing): under the passcode
    fields (set-passcode lock screen and dialog) and the backup passphrase, a
    short (< 8) or all-digit (< 10) entry shows a note that it can be guessed
    quickly if someone copies your data. 4 characters still works.
  - Honest limit: more iterations slow down each guess but cannot save a very
    short passcode. A 4-digit PIN has only 10,000 possibilities, so anyone who
    gets a copy of your data or backup file can still try them all. A longer
    passphrase is the real protection, especially for exported backups, which
    leave your device.
  - Tests: new `tests/test_kdf.js` (54 checks): iteration validation, 600k for
    new passcodes, existing 250k records and backups (with and without the
    field) still open, crafted counts refused instantly, minimum still 4, hint
    rules. `tests/load.js` gained a `__setPendingImport` probe.

- **v1.51.7** (2026-09-29) — Notes-folder sync now handles renamed, moved and
  deleted files, and no longer duplicates notes that are already on the shelf.
  Before, sync knew files only by path: renaming or moving one in Obsidian
  created a second note, a deleted file left its note linked to nothing, and
  linking a folder whose files were already on the shelf duplicated them.
  - **Renamed / moved:** a new file with *identical text* as a linked note whose
    file disappeared is treated as the same note. The note keeps its id,
    reading position and bookmarks, and follows the file (`extPath`). Its title
    and category follow too, but only if they were still the auto-derived ones;
    a title or category you changed yourself is left alone.
  - **Deleted:** if the file is confirmed gone, the note stays on the shelf as
    an ordinary note (link cleared), nothing is deleted. "Confirmed" means the
    browser says *not found*; a permission error or an unreadable folder (e.g.
    a drive that is unplugged) never unlinks anything. A file moved to
    `.trash` counts as deleted, since dot-folders are skipped.
  - **Already on the shelf:** a new file that matches an ordinary note (same
    title and text, or identical non-empty text that is unique on both sides)
    is adopted instead of duplicated. This also makes Unlink → relink of the
    same folder safe. Two look-alike notes or files are never guessed.
  - **Known limit:** a file that is renamed/moved *and edited* before the next
    sync looks like "old deleted, new added": the old note is kept unlinked and
    the new file becomes a new note. This is deliberate; guessing could
    overwrite the only shelf copy of a deleted note. Empty files never pair.
  - The Sync-now summary lists renamed/moved, matched and unlinked counts.
  - Logic is in `extSync`, plus two pure helpers (`extPairMoves`,
    `extPairAdopt`) and `extIsGone`.
  - Tests: new `tests/test_ext_sync.js` (41 checks) runs the real `extSync`
    against an in-memory fake folder, plus the matchers on their own.

- **v1.51.6** (2026-09-29) — "Erase and start over" now also forgets the
  linked notes folder.
  - `wipeAllData` deleted the `shelfmark` IndexedDB database but not
    `shelfmark-ext` (where the folder handle is kept), so after an erase the
    old folder could come back and re-sync on the next window focus. It now
    calls the new `extForget()`, which clears the in-memory `extRoot` /
    `extRootName` and deletes `shelfmark-ext` too. A failure there never
    blocks the erase itself.
  - Root cause was slightly bigger: `extIdb()` opened a new connection on every
    call and never closed it, so deleting the database would have been
    "blocked" by the app's own connections. `extIdb()` now closes its
    connection when the transaction ends (and on `versionchange`).
  - "Unlink notes folder" is unchanged (it only removes the `root` key, on
    purpose, since it is reversible).
  - Tests: new `tests/test_ext_wipe.js` (fails on v1.51.5, passes now).
    `tests/load.js` gained two small probes (`__ext`, `__setExt`) so tests can
    read the folder state.

- **v1.51.5** (2026-09-29) — Link/image URLs with parentheses, plus one
  older bug found while testing it.
  - `[a](https://en.wikipedia.org/wiki/Foo_(bar))` now links to the full URL.
    Before, the URL was cut at the first `)` and a stray `)` was left as
    visible text. The old `\((.+?)\)` regex is replaced by a small scanner
    (`parseMdLinkTail` / `replaceMdLinks` in `app.js`) that counts nested
    parentheses and stops at the first unmatched `)`. Same for `![alt](url)`.
  - Anything that linked before still links: if the URL can't be parsed
    cleanly (an unbalanced `(`, or a raw space inside it) the scanner falls
    back to the old "up to the first `)`" behavior.
  - New: `[a](<https://example.com/my file (v2).pdf>)` — angle brackets let a
    URL contain spaces and unbalanced parentheses. An optional
    `"title"` after the URL is accepted and ignored instead of ending up in
    the `href`.
  - **Bug fix (was in v1.51.3/v1.51.4):** every apostrophe in a note was
    rendered as `it&` + a `#39` tag pill + `;s`. `escapeHtml` turns `'` into
    `&#39;`, and the hashtag pass then read `#39` as a tag. The hashtag
    pattern now ignores a `#` that directly follows `&`. Apostrophes inside
    link URLs and image alt text were affected too (the pill's HTML was
    spliced into the attribute).
  - Added `tests/` (dev only, not deployed): the dispatcher tests from
    v1.51.4 plus `test_links.js`, which covers the cases above and the
    hostile-input checks (unsafe schemes, attribute breakout, a 6 MB
    data-URI image). See `tests/README.md`.
- **v1.51.4** (2026-09-29) — Removed every inline event handler, so the
  Content-Security-Policy is now `script-src 'self'` (no `'unsafe-inline'`).
  Even if markup containing a `<script>` tag or an `onclick=` attribute got
  into the page, the browser would refuse to run it. No visible change.
  - All ~120 `onclick`/`onchange`/`oninput`/`onkeydown` attributes (static
    ones in `index.html`, plus the ones built in template strings in
    `app.js`: PDF and audio controls, the note editor toolbar, bookmarks,
    outline, code-block Copy) became `data-on-click` / `data-on-change` /
    `data-on-input` / `data-on-keydown` attributes. One delegated listener
    at the bottom of `app.js` ("Event dispatcher") handles them.
  - The dispatcher only calls functions listed in `UI_ACTIONS` (an explicit
    allow-list; it never uses `eval` or looks names up on `window`).
    **When you add a button, give it `data-on-click="yourFunction"` and add
    `yourFunction` to `UI_ACTIONS`.** A plain `onclick="..."` will silently
    do nothing under this CSP. Arguments: `data-arg-click="text"` (one string,
    use for ids), `data-args-click='[1,"x"]'` (JSON; `"$ev"` = the event,
    `"$el"` = the element), `data-stop-click`, `data-self-click`,
    `data-click-target="elementId"`. Full contract is in the comment above
    `UI_ACTIONS`.
  - Handlers that were already assigned in code (`row.onclick = ...`) are
    unchanged; those are fine under the CSP.
- **v1.51.3** (2026-09-29) — Security/robustness pass, prompted by treating
  a note's content as untrusted (it can arrive via an imported backup or a
  synced notes folder, not just your own typing), plus one privacy default:
  - Only `http(s)`/`mailto`/`tel` are accepted as link targets and only
    `http(s)`/`data`/`blob` as image/audio sources; anything else (notably
    `javascript:`) now renders as plain text instead of a live, clickable
    element. Added a Content-Security-Policy meta tag as defense-in-depth
    (blocks cross-origin requests, plugins, and off-site form submission).
  - Import (JSON restore) now validates each item before trusting it: an
    item id is checked against a safe pattern instead of being written
    verbatim into the reader's inline handler; `type` is checked against
    the four known kinds; non-markdown `content` must be a `data:` URI
    before it's fetched. A bad item is skipped, not treated as reason to
    abort the whole import.
  - Items now carry an `updatedAt`. Restoring an older backup no longer
    silently overwrites a newer local edit to the same item — the newer
    copy wins and the older one is skipped, reported as such in the import
    summary.
  - Saving a linked note (one synced from your notes folder) now checks
    the file's current modified time against what Shelfmark last saw
    before writing. If the file changed outside Shelfmark (e.g. edited in
    Obsidian) since you opened the note, you're asked before your save
    overwrites that outside change, instead of it happening silently.
  - New "Remote images/audio in notes" setting (command palette), off by
    default: a remote `http(s)` image or audio link in a note now shows as
    a tap-to-load placeholder instead of loading automatically, so opening
    an imported or synced note can't silently phone home. `data:`/`blob:`
    media (pasted-in pictures, on-shelf audio links) are unaffected.

- **v1.51.2** (2026-09-28) — App guide: the Category index card now explains
  each optional line (`types`, `exclude`, `columns`) on its own, says that
  all of them are optional and what the default headers are, and adds tips
  (shelf order, A–Z links, text around the block, several index blocks in one
  note). The Markdown help card points to it. Text only, no logic change.

- **v1.51.1** (2026-09-28) — Removed the grey background that appeared under
  the mouse when hovering a paragraph in reading view (it dimmed the text and
  emoji). Tap/click-to-edit still works; desktop just shows the pointer
  cursor as the hint instead.

- **v1.51.0** (2026-09-28) — The shelf now remembers your view. The sort
  choice (Newest / A–Z) and which category headers are collapsed are saved
  (encrypted, in the same prefs record as theme/font) and restored each
  time you unlock, instead of resetting on every reopen. Per device, not
  part of backups. Deep search still resets to off on purpose.

- **v1.50.0** (2026-09-28) — Notes folder (Obsidian-style). Ctrl+K → "Open a
  notes folder…" and pick a folder/vault: every `.md` inside (subfolders
  become categories; dot-folders are skipped) appears as a linked note.
  Opening a note re-reads the file, Save writes it back, and the app
  re-syncs when you switch back to it. Chromium browsers only. Files on disk
  are plain text; the app keeps an encrypted copy for search/tags/links.
  Not yet: renaming/deleting/creating files from the app, images/PDFs in
  the folder, files deleted outside.

- **v1.49.1** (2026-09-28) — Passphrase/passcode fields in dialogs (export,
  import, set/remove passcode) now use the same rounded style as the lock screen.

- **v1.49.0** (2026-09-28) — Backups now say whose shelf they came from.
  Each shelf gets a random `shelfId` (made once, kept in the encrypted
  prefs) and an optional name (Export dialog, or Ctrl+K → "Shelf name…").
  Backup files carry `shelfId`, `itemCount`, `appVersion` and `exportedAt` in
  the plain header, plus `shelfName` and a name in the file name
  (`Ah-Meng-shelfmark-2026-09-28.enc.json`) unless you untick "Show the name
  in the file name and in the file's header" in the Export dialog (encrypted
  exports only; the random ID is always there). Import compares the file's
  `shelfId` with this shelf: a different shelf asks before merging, and
  encrypted files show their origin before the passphrase prompt. Files from
  older versions still import, with a note that they have no owner
  information. Restoring onto an empty shelf skips the warning and adopts the
  backup's shelf ID and name. Old app versions ignore the new header fields.
  Bump `CACHE_VERSION` in `service-worker.js` to match on deploy.

- **v1.48.2** (2026-09-28) — Reset without a lock screen. New Ctrl+K command
  "Erase this shelf and start over…" (also a button in the Passcode & lock
  panel), for no-passcode mode where the lock screen's "Forgot passcode?
  Erase" link never appears. Works in either mode; asks for a confirmation
  and then for the word ERASE to be typed, then deletes the local database and
  returns to first-run setup. Bump `CACHE_VERSION` in `service-worker.js` to
  match on deploy.

- **v1.48.1** (2026-09-28) — New in-app "App guide" panel (Ctrl+K → "App
  guide: index, passcode & tips") covering the command palette, the category
  index (what it is, how to make one, the optional `types:` / `exclude:` /
  `columns:` lines, plus a "Create an index note" button), the optional
  passcode (with a shortcut to its settings) and note writing. The index card
  in the Markdown help now opens expanded. Bump `CACHE_VERSION` in
  `service-worker.js` to match on deploy.

- **v1.48.0** (2026-09-28) — Live category index, like an Obsidian index note.
  Put a ```` ```index ```` block in a note and reading view shows a table: one
  row per category (shelf order, Uncategorized last), the category count in
  the header, an item count beside each name, and a tappable link to every
  item in it (PDFs/pictures/recordings get a small icon). Rebuilt each time
  the note opens, so nothing is stored and it can't go stale. Optional lines
  inside the block: `types: notes, pdf, pictures, recordings`,
  `exclude: Cat A, Cat B`, `columns: 分类 | 笔记` (rename the headers). Quick
  ways to make one: Add → "Index of categories" template, or Ctrl+K → "New
  index note". Also in the Markdown help. Bump `CACHE_VERSION` in
  `service-worker.js` to match on deploy.

- **v1.47.1** (2026-09-28) — In-app explanation of the passcode options.
  New command-palette entry "Passcode & lock: info and settings" opens a
  panel showing the current mode, what each mode means (including the
  tradeoffs and the browser-loses-its-key caveat), and a button to switch.
  The first-run screen now mentions the skip option and where to change it
  later, and the empty-shelf message points to Ctrl+K. Bump `CACHE_VERSION`
  in `service-worker.js` to match on deploy.

- **v1.47.0** (2026-09-28) — Passcode is now optional. First-run lock screen
  gets a "Continue without a passcode" link (device-key mode: random
  non-extractable AES-GCM key stored in IndexedDB, app opens straight to the
  shelf). Command palette gains "Set a passcode…" / "Remove passcode…" to
  switch modes later: removal asks for the current passcode; both re-encrypt
  every item, draft and the prefs record with a progress overlay, committing
  everything plus the new auth record in a single IndexedDB transaction.
  Existing passcode shelves are unchanged (old auth records have no `mode`
  field and are treated as passcode mode). Remember to bump `CACHE_VERSION` in
  `service-worker.js` to match on deploy.

- **v1.46.2** (2026-09-28) — The 🔗 / 🎵 / 📄 link buttons no longer swallow
  selected text. Select "meeting notes", tap a button, pick a target → you get
  `[meeting notes](shelf://id)`; before, the selection was replaced by the
  target's title. A multi-line selection can't be a link label, so it still
  falls back to the target's title. Nothing selected: unchanged.
- **v1.46.1** (2026-09-28) — Dropped audio is now embedded in the note itself,
  like a dropped picture, instead of becoming a separate shelf item (that was
  v1.46.0). The file is read as a `data:audio/...` URI and stored inline in the
  note as `[name](data:audio/...;base64,...)`; the editor only shows a short
  `[name](aud:N)` placeholder (`curNoteAudioRefs`, collapsed / expanded by
  `collapseImagesForEdit` / `expandImagesForSave` next to the `img:N` ones;
  find ignores `(aud:N)`). Reading view renders a `data:audio/` link as the
  native `<audio>` player (`md-audio`). Cap: 15 MB per file (`NOTE_AUDIO_MAX`),
  since audio can't be resized like pictures and base64 adds a third; bigger
  files go on the shelf with + Add and are linked with the 🎵 button.
- **v1.46.0** (2026-09-28) — Drag-and-drop audio into the note editor (first
  version: saved each file to the shelf as a new audio item and inserted a
  `shelf://` link — replaced by the in-note version in v1.46.1). Accepts
  `audio/*` or .mp3/.m4a/.wav/.ogg/.oga/.opus/.aac/.flac/.weba/.webm; pictures
  and audio can be mixed in one drop, other files are skipped with a message.
- **v1.45.2** (2026-09-28) — Quote (`> `) lines are easier to see in reading
  view: the left bar is now 4px in the note-green accent (`--md`, was a faint
  3px `--line`) on a light green tint with rounded right corners, matching the
  callout cards. CSS only.
- **v1.45.1** (2026-09-28) — Indentation now shows in reading view. Leading
  spaces / tabs were being collapsed by HTML, so Tab indent (v1.45.0) only
  showed in the editor. `mdIndentEm` counts 0.75em per leading space (tab = 4
  spaces): paragraph and heading-body lines get an inline `.md-ind` spacer
  span, list / ordered / task items get `margin-left`. Lists remain flat
  `<ul>`/`<ol>` (no real nesting), so block and line indices used by task
  checkboxes and tap-to-edit are untouched.
- **v1.45.0** (2026-09-28) — Tab / Shift+Tab now indent on **every** line in
  the note editor, not only list lines. Before, Tab on a plain line (or a
  marker-less `*asdf`) still moved focus out of the textarea. Now: multi-line
  selection → all selected lines indent / outdent two spaces; list line or
  single-line selection → that line; plain line → two spaces at the caret;
  Shift+Tab outdents the line. Esc then Tab still moves focus (no keyboard
  trap). Help text updated.
- **v1.44.0** (2026-09-28) — Drag-and-drop pictures into the note editor.
  Dropping image files on the textarea calls `insertNoteImageFile` (same path
  as paste and the 📷 button; several files go in one after another, each its
  own undo step). The picture lands at the caret's last position — a textarea
  can't map a drop point to a text offset. Any *file* drag is claimed
  (`preventDefault`), because the browser default for a dropped file is to
  navigate to it and lose the open editor; non-pictures get a message
  instead. A dashed outline shows while dragging over the editor.
- **v1.43.0** (2026-09-28) — Merged table cells (Excel-style). While a cell is
  open, the table bar has **Merge →**, **Merge ↓** and **Unmerge**. Pipe
  tables have no spans, so the text uses two marker cells: `<<` = merged into
  the cell on its left, `^^` = merged into the cell above (`^^` is
  MultiMarkdown's rowspan marker). `tableSpans` follows the markers to each
  cell's root and derives colspan/rowspan from the extent, so any rectangular
  block works; `^^` in the header or first body row and `<<` in the first
  column are kept as plain text. A merge only proceeds when the neighbour
  lines up exactly (same rows / columns) and asks before discarding its text;
  the header row merges sideways only. Because merges break the
  DOM-index = logical-index assumption, table cells now carry `data-r` /
  `data-c`, and Tab follows reading order. Insert/delete row/column are merge-
  aware (markers are copied into an inserted row/column that lies inside a
  merged block; deleting a block's root row/column hands its text to the next
  one). Help updated (Tables card + Quick reference).
- **v1.42.0** (2026-09-28) — Multi-line table cells. In reading-view cell
  editing, **Enter** now inserts a line break in the cell (it used to save);
  save with Ctrl/Cmd+Enter, the new **✓ Done** button in the table bar, or by
  tapping elsewhere. Pipe tables can't hold a real newline, so a multi-line
  cell is stored as `one<br>two`; `tableToHtml` turns an escaped `&lt;br&gt;`
  (only that tag) back into a real break, so the same text also works when
  typed in the note editor. The cell is read back by walking its nodes
  (`tableCellText`), an end-of-cell break gets a zero-width space so the new
  line is visible (stripped on save), and an untouched cell keeps its stored
  text byte-for-byte. Multi-line paste keeps its lines. Help text updated.
- **v1.41.0** (2026-09-28) — Markdown help redesigned to be scannable: a sticky
  search box (all words must match; matching cards open their folded text),
  a *Quick reference* grid of the most-used syntax, and one colour-edged card
  per topic in the same style as callout cards (green = writing, blue =
  inserts, gold = links, red = shortcuts). Secondary paragraphs are folded
  into *More details*. Still one copy of the content: the docked help clones
  the overlay, so the search box uses an inline `oninput` + `closest()`
  (`filterHelp`) instead of ids.
- **v1.40.0** (2026-09-28) — Editor keyboard aids. **Enter** at the end of a
  list / task / numbered / quote line continues it (`- `, `* `, next number,
  fresh `- [ ] `, `> `); Enter on the empty item ends the list. Not applied
  inside fenced code blocks or with a text selection. Implemented on
  `beforeinput` (`insertLineBreak`/`insertParagraph`) rather than `keydown`,
  because soft keyboards report unreliable `keydown` keys and IMEs mid-
  composition must not be touched. **Tab / Shift+Tab** on a list line
  indent / outdent two spaces instead of moving focus (list lines only; Esc
  then Tab always moves focus, so it is never a keyboard trap; the reader
  still renders lists flat). **Ctrl/⌘+B**, **Ctrl/⌘+I**, **Ctrl+Alt+H**
  (bold, italic, heading — Ctrl/Cmd+H is a browser shortcut). The B button
  is now a true on/off toggle (`toggleWrapAtSelection('**')`) and italic
  uses `'*'`; because `*` and `**` share a character, detection compares
  runs of stars (`starRun` / `starDelimPresent`) so `**x**` is never read as
  italic. All edits go through `noteReplaceRange` (one undo step each, real
  `input` event so drafts/autocomplete keep working). Markdown help updated:
  Lists, Quotes, Text and a new *Typing shortcuts* section (the docked help
  clones the overlay, so there is still one copy to maintain).
- **v1.39.0** (2026-09-28) — Pictures in notes are thumbnails in reading view
  (max 280 × 200 px, aspect ratio kept); tap one to open it full-screen. In
  the viewer, tap the picture again to toggle fit-to-screen / actual size
  (scrolls), tap the backdrop, the x or press Esc to close. Display only: the
  note text and the stored / exported picture data are unchanged (pictures are
  still resized to 900 px on insert, as before). Implemented as one delegated
  click listener on `#mdView img.md-img` (between the `@@IMGZOOM-START/END`
  markers in `app.js`) rather than per-render wiring; `img.md-img` was added
  to `PARAGRAPH_TAP_EXCLUDE` and the table-cell click guard so tapping a
  picture no longer opens the paragraph editor. To edit a picture's line, use
  the pencil button. Tested in Chromium at 420 px.
- **v1.38.0** (2026-09-28) — Edit tables in reading view, no source mode.
  Tap a table cell to edit it in place; it shows its raw markdown while open
  (`**bold**` stays editable). **Enter** saves, **Esc** cancels, **Tab** /
  **Shift+Tab** move between cells (Tab in the last cell adds a row), and
  tapping another cell saves the open one and moves on. While a cell is open
  a bar under the table gives **+ Row below / + Col right / Delete row /
  Delete col** (delete asks first if the row/column has content; the header
  row can't be deleted). Saving rewrites only the table rows whose cells
  changed — untouched rows, the rest of the note and the blank lines between
  blocks are left byte-for-byte as they were. The table is located by the
  same blank-line block split as `toggleTaskCheckbox`; if the raw text no
  longer lines up, or a cell holds a picture, the app says so and leaves the
  text alone (use the pencil editor). A literal pipe in a cell is written
  `\|` (`splitTableRow` now honours it). Code lives between the
  `@@TABLE-EDIT-START/END` markers in `app.js`. Tested in Chromium.
- **v1.37.1** (2026-09-28) — Fix: heading fold now works when the text sits
  on the lines directly under a heading with no blank line (`# Trip` then
  `daf` on the next line). That is one block in the renderer, so v1.37.0 gave
  it no arrow (or left the text visible when folded). `renderMarkdown()` now
  wraps such text in a `.heading-rest` div inside the same block (line breaks
  are kept as `<br>`, like paragraphs), and folding hides it. Blocks are not
  split or renumbered, so paragraph edit, bookmarks and checkboxes are
  unaffected. A heading whose only content is that text is foldable even as
  the last block of a note.
- **v1.37.0** (2026-09-28) — Heading fold, Obsidian-style, for **H1–H6**. In
  reading view every heading that has something under it gets an arrow at the
  right of its row; tapping it hides everything up to the next heading of the
  same or higher level (an H2 folds its H3s; the next H2 or an H1 ends the
  section). A collapsed heading shows `…` after its text and a highlighted
  arrow. The outline (☰) gains **Collapse all / Expand all**. Fold state is
  remembered per note (`folds` in the item's encrypted metadata, keyed by
  heading level + text + n-th occurrence; not included in exports) and is
  pure view state — the note text is never changed. A heading with nothing
  under it gets no arrow. Outline jumps, bookmark jumps and find hits
  auto-expand whatever is hiding their target. A nested heading keeps its own
  fold state when the outer one is reopened. Also: `####`–`######` now
  actually render as headings (the renderer only knew H1–H3, so they used to
  show as literal text), and the outline lists all six levels. The arrow is a
  text-less CSS-drawn button, so bookmark snippets, find and the outline
  (which all read `textContent`) are unaffected. Retitling a heading drops its
  saved fold (pruned on the next render). Tested in Chromium at 420 px.
- **v1.36.0** (2026-09-28) — Markdown help stays on screen while you edit.
  Before, the editor's **?** opened a modal overlay that covered the very text
  you were trying to format. Now, while editing, **?** toggles a *docked*
  panel: a capped strip (30 % of the height, max 240 px) between the text and
  the toolbar on narrow screens, and a column beside the text at 700 px and
  wider (so landscape phones get it too). It scrolls on its own, the **?**
  button shows a pressed state, and the text area stays fully usable. There
  is still exactly one copy of the help content: the dock is a clone of the
  overlay's `.help-body` (`ensureHelpDock()`), so `index.html` remains the
  only place to edit it. Outside the editor (command palette → *Markdown
  formatting help*) the modal overlay is used as before; from inside the
  editor the palette entry opens the dock (never closes it). Once you open
  the dock it reopens in later edit sessions until you close it (kept in
  memory only, not saved). Implementation note: on wide screens
  `#mdEditWrap.help-open` switches to a grid with `display:grid !important`
  scoped by `:not([style*="none"])` — `startEditNote()` / `leaveEditMode()`
  set `display` inline, so without that guard the editor would reappear
  after saving. Tested in Chromium at 390×780, 844×390 and 1280×800.
- **v1.35.0** (2026-09-28) — Foldable callouts, Obsidian syntax: `> [!note]-
  Title` starts collapsed, `> [!note]+ Title` is foldable but starts open;
  no `-`/`+` is the old static card, unchanged. Rendered as a native
  `<details class="callout … callout-fold">` with the title row as
  `<summary>` — no JS state, and keyboard / screen-reader folding comes free.
  A callout with a fold marker but no body lines stays a plain card (nothing
  to fold). Three integration points worth knowing about: (1) `summary` was
  added to `PARAGRAPH_TAP_EXCLUDE`, otherwise tapping a title to unfold would
  also jump into edit mode (tap-to-edit and the long-press menu share that
  selector); tapping the callout *body* still edits that paragraph, same as
  any other block. (2) Find-in-note counts hits inside folded callouts, and
  `revealFindHit()` opens every enclosing `<details>` before stepping to one
  — `scrollIntoView` on a hidden element silently does nothing. It only ever
  opens; it never re-closes. (3) Fold state is not persisted: reopening or
  re-rendering a note returns each callout to its `-`/`+` starting state.
  The `[!type]±` character must come directly after the `]` — `[!note] - x`
  is still a static card titled "- x". The Markdown formatting help has an
  example of each.
- **v1.34.0** (2026-09-28) — Markdown formatting help (the **?** button /
  command palette entry) now has its own "Strikethrough & highlight" section
  instead of a one-line mention: the two syntaxes rendered, the **S** / **A**
  toolbar buttons and their tap-again-to-remove behavior, the multi-line /
  checklist case, and the two gotchas (no spaces just inside the marks;
  nothing is marked inside code). The Text section also mentions the **B**
  and **H** buttons. Still fully static HTML in `index.html`, not run
  through `renderMarkdown()`.
- **v1.33.0** (2026-09-28) — Editor toolbar buttons for `~~strikethrough~~`
  (**S**) and `==highlight==` (highlighted **A**), next to Bold. Unlike Bold
  (which only ever wraps) these are real toggles: tap again on wrapped text
  and the delimiters come off, whether the selection is the inside or
  includes them. Whitespace in the selection stays outside the delimiters
  (the renderer refuses `== word ==`, and a double-tap often grabs a
  trailing space). A multi-line selection is wrapped line by line — marks
  never span a line break — and keeps each line's list / `- [ ]` checkbox /
  `>` quote / heading prefix in front, so `- [ ] buy milk` becomes
  `- [ ] ~~buy milk~~` and is still a checklist item. With nothing selected
  it inserts a placeholder with the word pre-selected, like Bold. Logic is
  `toggleWrapAtSelection()` in `app.js`; Bold itself is unchanged.
- **v1.32.0** (2026-09-28) — `~~strikethrough~~` and `==highlight==` in
  notes. Rendered as `<del>` and `<mark class="md-mark">` by a new
  `applyInlineMarks()` that runs as the *last* inline pass in
  `renderMarkdown` (after inline code, images, links and the shelf widgets
  are already HTML): every `<code>…</code>` span and every HTML tag is held
  behind a placeholder while the two regexes run. That is deliberate — `==`
  turns up in base64 padding (`data:` image URIs) and link query strings, and
  in code like `a == b`, none of which may be turned into a mark. The text
  between the delimiters must not start or end with a space (or the
  delimiter itself), so `a == b == c` and a bare `======` line stay literal;
  marks can wrap other formatting (`==**bold**==`, `~~==both==~~`) and work
  inside table cells, headings and callout titles. The highlight color is a
  soft yellow, deliberately different from the gold find-hit, and a find
  hit inside a highlight gets a stronger tone so it stays visible. The
  Markdown formatting help gained a row for both. No editor toolbar buttons
  for them yet (added in v1.33.0).
- **v1.31.0** (2026-09-28) — Draft autosave. Before: an edit lived only in the
  textarea until Save, so leaving mid-edit (back button, opening another
  note, the tab being killed) lost it. Now the editor writes a draft every 3 s
  when the text has changed (`draftTick`), and immediately on leaving
  (`closeReader`, `openReader` of another item, `visibilitychange`,
  `pagehide`). The draft is NOT written over the note: it is a third
  encrypted blob (`draftIv`/`draftCipher`) on the same record — not in the
  content blob (so Save/Cancel still mean what they say) and not in the
  metadata blob (decrypted for every item on every shelf listing; a draft
  with pictures can be megabytes). It is never exported, goes with the note
  if it's deleted, and is dropped if identical to the saved text. Reopening
  a note with a draft shows a banner (Continue editing / Discard); any way
  of entering the editor (✎, tapping a paragraph) resumes the draft, with a
  notice + "Revert to saved" (confirmed and not undoable, because Undo would
  cross a re-numbering of the `img:N` picture placeholders). Cancel now asks
  first if it would discard changes, then clears the draft.
  **Also fixed a latent race:** `putMetaOnly`/`putContentOnly` (and the new
  draft writers) are read-modify-write on the whole record with awaits in
  the middle, so two overlapping (say a draft landing during Save) could put
  back a stale record and undo the other's change. They now run through one
  queue (`serialized`). Limits: a draft is device-local and not backed up; it
  temporarily adds roughly the note's size to storage; a checkbox ticked in
  reading view while a draft exists changes the saved text, not the draft;
  resuming a draft skips paragraph-tap caret placement (paragraph numbers
  refer to the saved text).

- **v1.30.2** (2026-09-28) — Find highlight made much easier to spot. Every
  hit gets a gold wash; the current hit is solid gold (#d4af37, dark text so
  it reads on every theme) with a ring, and pulses once each time you jump to
  it. CSS + a two-line change in `goToFindMatch`; no behavior change.

- **v1.30.1** (2026-09-28) — Fix: v1.30.0's tag jump highlighted nothing on a
  real note (0 hits, ↑/↓ dead). The Tags page listed `#lockOverlay`, but in
  the rendered note every occurrence sat inside an inline-code span, and the
  whole-tag mode skipped code — so it found nothing. The tag index
  (`stripCodeForTags`, run on raw text) and the renderer can disagree about
  what is code, so the mode no longer skips code. It also falls back to a
  plain substring search if the whole-tag search finds nothing. Root cause of
  the index/renderer disagreement on that note is not yet identified (needs
  the raw text).

- **v1.30.0** (2026-09-28) — Jump straight to a tag's position. Palette
  "Jump to #tag" used to always open the Tags page; if only one note has the
  tag it now opens that note scrolled to the tag with every occurrence
  highlighted (find bar's ↑/↓ step between them). With several notes it still
  shows the Tags page to pick one, and tapping a note there now also lands
  on the tag inside it. Built on the find bar (`openNoteAtTag`), with a
  whole-tag mode (`findTagExact`: '#idea' doesn't match '#ideas', code is
  skipped, tag pills — which are buttons — are searchable) that switches off
  as soon as the user types their own query. Tapping a tag pill inside a
  note is unchanged (opens the Tags page — you're already at that spot; the
  useful thing is the other notes). Side effect: jumping scrolls the note,
  which overwrites its saved reading position.

- **v1.29.3** (2026-09-28) — Command palette no longer lists every tag as a
  "Jump to #tag" row when opened; with many tags they pushed the real
  commands off-screen, and "Browse tags" already covers browsing. Tag rows
  now appear only on request: a query starting with `#` shows just tags,
  fuzzy-matched on the tag name (a bare `#` lists them all); any other query
  still mixes tags in with the commands as before.

- **v1.29.2** (2026-09-28) — Two fixes to v1.29.0's find bar, from a
  screenshot. (1) The bar was `position:fixed`, floating over the note and
  hiding its first lines (and any match scrolled beneath it); it's now an
  ordinary flex child between the top bar and `#rcontent`, so opening it
  shrinks the reading area instead. (2) The Undo button stayed disabled
  after a first Replace All: `updateUndoRedoButtons` only looked at
  `undoStack.length`, but a programmatic edit is snapshotted lazily by
  `undoEdit()`, so with no prior typing the stack still had one entry. It
  now also enables Undo when the text differs from the newest snapshot, and
  `pushUndoBeforeEdit` refreshes the buttons again after the edit lands.
  This was a latent bug for every toolbar action (Bold, Divider, …) used as
  the first edit, not just Replace. Note Undo only exists while the editor
  is open — after Save, a replace is committed.

- **v1.29.1** (2026-09-28) — Help-only patch: the ? formatting-help overlay
  gained a "Tips: finding things" section covering find & replace in a note
  (v1.29.0) and the shelf's deep-search toggle (v1.28.0), which had shipped
  without being mentioned there. Static HTML in index.html only; no logic
  changes.

- **v1.29.0** (2026-09-28) — Find & replace inside a note. Two modes on one
  bar, because "what you read" and "what you edit" are different strings in
  markdown. Reading view searches the RENDERED text (a hit never lands on
  hidden syntax like `**` or a URL) and wraps hits in `<mark>`; it's
  read-only, so the bar shows a "Replace…" button that opens the editor
  with the query carried over. Editing view searches the textarea itself,
  selects each match, and Replace/All rewrite it through
  `pushUndoBeforeEdit`, so Replace All is a single Undo step. Replace is
  two-step like most editors (first press selects, second replaces and
  hops on). Matches inside an image's `(img:N)` placeholder are skipped so
  a replace can never break an embedded picture. Ctrl/Cmd+F is intercepted
  only while a note is open. Limits: reading-view hits can't span two
  rendered elements (e.g. across a bold boundary — edit-mode search has no
  such gap); highlights are capped at 2000; on mobile, stepping through
  edit-mode matches focuses the textarea (so the selection scrolls into
  view), which raises the keyboard.

- **v1.28.0** (2026-09-28) — Opt-in deep search. Default search still only
  compares title/category (already decrypted for the shelf listing, so it's
  free per keystroke). The new toggle next to the search box additionally
  decrypts each markdown note via `getOne()` and substring-matches its text
  — same cost class as `buildTagIndex`/`renderBacklinks`, hence opt-in.
  Session-only on purpose (not in prefs): it resets to off on reopen so
  paying the decrypt cost stays a conscious choice. The scan is debounced
  (300 ms) and guarded by a token (`deepSearchToken`, same idea as
  `wikiACToken`) so a stale in-flight scan discards itself when the query
  changes. Title/category hits show instantly; text-only hits join when the
  scan lands, and "No matches" is suppressed while a scan is pending.
  Limits: no match snippets/highlighting; results are cached per query, so
  editing a note mid-search isn't reflected until the next keystroke or
  toggle.

- **v1.27.0** (2026-09-28) — Markdown formatting help: a **?** toolbar
  button in the note editor (plus a command-palette entry, so it's reachable
  even when nothing is being edited) opens an overlay documenting every
  syntax construct the editor renders. Deliberately **not** built by piping
  a stored markdown string through `renderMarkdown()` — a real syntax guide
  needs to show the raw syntax (e.g. the literal text `**bold**`) right next
  to its rendered result, which a renderer that only ever produces the
  rendered side can't do; also, the guide's own code-block example would
  need a fenced block *about* fenced blocks, and the fenced-code regex
  (`` /```(\w*)\n?([\s\S]*?)```/g `` — non-recursive, first-match-wins) has
  no way to nest one inside another. So the overlay's content is hand-
  written static HTML reusing the exact same CSS classes `renderMarkdown`
  itself outputs (`.callout`, `.code-block`, `.md-note-link`, `.task-list`,
  `.md-table-wrap`, etc.), with interactive-looking elements (checkboxes,
  play buttons) left inert (`disabled`) since they're illustrations, not
  real content bound to a real item id. No new static files, no network
  request — consistent with the rest of the app.
- **v1.26.0** (2026-09-28) — Note → PDF links, the last of the three
  `shelf://` target types (v1.5.6 added note→audio, v1.16.0 added
  note→note). A new 📄 toolbar button in the note editor opens the same
  picker/overlay as 🎵 Audio and 🔗 Note, filtered to PDFs, and inserts
  `[Title](shelf://<id>)` exactly the same way. Rendering and click-through
  needed no new plumbing — `openNoteLink()`/`wireNoteLinks()` were already
  type-agnostic (added generically back in v1.16.0), so they open a linked
  PDF via `openReader()` just like a linked note. What did need fixing:
  `renderMarkdown`'s `[label](shelf://id)` branch only special-cased
  `linkTypes[id] === 'markdown'`, so a link to a PDF (or an image) fell
  through to the audio-inline branch and rendered a play button that could
  never play anything — a latent bug since note-to-note linking shipped,
  just never hit because nothing could create a PDF/image shelf-link
  before now. Fixed by branching on `!== 'audio'` instead, so every
  non-audio target gets the generic jump widget. That widget is now colored
  by the target's own type accent (`--md` for a note, `--pdf` for a PDF)
  instead of always the note-green, so a glance at the link tells you which
  kind of item it opens. No page-jump — linking to a PDF opens it at
  wherever its own saved reading-progress last left off (same as opening it
  from the shelf), same as a note-to-note link opens at the top of the note
  rather than a specific paragraph. Backlinks ("Linked from…") are
  unchanged and still note-only in both directions: `renderBacklinks` would
  happily find a note that links to a PDF (it matches `shelf://<id>` in raw
  note text regardless of what the id points at), but it's only ever
  called when opening/saving a *note*, never from the PDF reader — so a
  PDF's own "who links here" list still doesn't exist. Same gap the audio
  reader already has today; out of scope for this change.
- **v1.25.0** (2026-09-28) — Command palette: a 🔍 button in the header, or
  **Ctrl+K**/**⌘K** from anywhere in the app, opens a fuzzy-searchable list
  of app-wide actions — New note, Add item, Import/Export, Browse tags,
  Select mode, Sort toggle, Audio loop toggle, Storage used, and all four
  themes (Auto/Light/Dark/Sepia — previously only reachable from inside a
  note's ⚙ panel). It also lists a "Jump to #tag" entry per tag on the
  shelf, built the same way the Tags page builds its index. This replaces
  the old header icon strip: storage/sort/loop/tags/select/import/export/
  new-note used to be eight separate buttons that wrapped to two rows on a
  narrow phone; they're now reachable only through the palette (the header
  is down to 🔍 and **+ Add**). The old buttons are still in the DOM,
  just hidden with `display:none` on `#legacyHeaderIcons` — several of
  their click handlers touch that specific element directly without a
  null-check, so hiding was safer than deleting them outright. Worth
  revisiting at some point: either null-guard those handlers and remove the
  dead markup, or leave it as-is since it costs nothing at runtime.
- **v1.24.0** (2026-09-28) — Two additions: (1) **Callouts** — a blockquote
  whose first line is `[!note]`, `[!warning]`, or `[!idea]` (optionally
  followed by a title) now renders as a colored card instead of a plain
  quote, reusing the existing --md/--pdf/--audio accent colors; any other
  `[!type]` still gets a card (generic icon, --img accent) rather than
  breaking. (2) **Undo/Redo in the note editor** — every toolbar button
  (Bold, Heading, image insert, etc.) sets the textarea's `.value` directly,
  which silently wipes the browser's native undo history, so Ctrl+Z had
  likely been doing nothing useful for a while. Added a real undo/redo
  stack instead (typing groups into one step per pause, each toolbar action
  is its own step) wired to two new toolbar buttons plus Ctrl+Z/Ctrl+Shift+Z.
- **v1.23.2** (2026-09-28) — The long-press "Edit this paragraph" menu
  (touch tap-to-edit discoverability, added in v1.23.0) now backs off if a
  native text selection is already active when its timer fires, instead of
  popping the menu over top of it.
- **v1.23.1** (2026-09-27) — Fixed a regression from the v1.23.0 tap-to-edit
  feature: a mouse drag that selects text still fires a plain `click` on
  mouseup (since it starts/ends on the same paragraph), so selecting text in
  reading view to copy it was jumping straight into edit mode instead. The
  paragraph click handler now checks `window.getSelection()` and backs off
  when there's an active selection.
- **v1.17.0 – v1.23.0** — not written up here; this changelog sat unmaintained
  through this whole range even though the Features section above was kept
  current for tags, outline, and single-item export. What's known: v1.23.0
  added the tap-a-paragraph-to-edit / long-press "Edit this paragraph" menu
  that v1.23.1/v1.23.2 above fix regressions in. The rest of this range
  (v1.17–v1.22) isn't reconstructable from the code alone with any
  confidence — there's no git history in this project to diff against.
- **v1.16.0** (2026-09-27) — Notes can now link to other notes, not just
  audio, with backlinks shown automatically. A new 🔗 button next to the
  existing 🎵 Audio button in the note editor toolbar opens the same picker
  filtered to your other notes; picking one inserts `[Title](shelf://<id>)`
  exactly as the audio link does, but the note reader renders it as a small
  tappable "jump to note" widget instead of an inline player. Opening any
  note now also shows a "Linked from" list at the bottom whenever one or
  more other notes link to it — tapping an entry jumps straight there.
  Finding backlinks means decrypting every other note's content to search
  it (there's no separate link index), so it only happens once when a note
  is opened or saved, not continuously. As before, if a linked note has
  since been deleted, tapping the widget says so rather than doing nothing.
- **v1.15.0** (2026-09-27) — Two new ways to start a note. (1) The Add sheet's
  "Start a blank note" button is now a 2×2 grid of starting templates —
  **Blank**, **Diary** (auto-titled with today's date, a `##` date heading
  already in place), **Meeting notes** (Attendees / Agenda / Notes / Action
  items skeleton), and **To-do list** (three empty checklist lines) — picking
  one pre-fills the title and drops the matching Markdown skeleton into the
  new note; everything stays freely editable afterwards, so this is just a
  head start, not a locked structure. (2) A new 📝 button next to "+ Add" in
  the header creates a blank untitled note in one tap and jumps straight into
  its editor, skipping the Add sheet entirely (no title/category/template
  step) for the common case of just wanting to jot something down right now.
- **v1.14.0** (2026-09-27) — Three note-editor conveniences: (1) pasting an
  image straight from the clipboard (Ctrl+V on desktop, or the long-press
  "Paste" menu on mobile — e.g. a screenshot that was never saved to a file)
  now inserts it the same way the 📷 button does, instead of doing nothing;
  (2) two new toolbar buttons, **B** (bold) and **H** (heading), wrap the
  current selection in `**...**` or toggle a leading `## ` on the current
  line, so formatting no longer requires typing the Markdown symbols by
  hand; (3) two more toolbar buttons insert a `---` divider or the current
  date/time as plain text at the cursor — handy for splitting up a diary
  entry or timestamping a running meeting log. The divider now also renders
  as an actual horizontal rule in the note reader (previously `---` had no
  special rendering at all).
- **v1.13.0** (2026-09-27) — The note editor no longer shows a giant wall of
  base64 text for an inserted picture. Opening a note for editing now
  collapses every `![alt](data:image/...;base64,...)` down to a short
  `![alt](img:1)` placeholder in the textarea; Save silently expands each
  placeholder back to its real image data before the note is stored — the
  saved content is byte-for-byte the same full markdown as before (still one
  plain string, still exports/imports the same way), only what you actually
  *see and edit* changed. New images inserted via the 📷 button during that
  same edit session get a placeholder too, instead of dumping their data URI
  straight into the textarea. Deleting a placeholder line and saving removes
  that image from the note, same as deleting any other line would.
- **v1.12.0** (2026-09-27) — Fenced code blocks are now a proper Obsidian-
  style widget instead of a plain `<pre>`: write ```` ```js ```` (any language
  tag, or none) and the note reader shows a small bar above the code with
  the language name and a **Copy** button that copies the exact code text to
  the clipboard (falls back to the older `execCommand` copy trick if the
  Clipboard API isn't available). Under the hood, fenced blocks are now
  pulled out into placeholders before the bold/italic/inline-code/link
  passes run and spliced back in afterwards — previously a code sample
  containing `**` or a stray backtick (completely normal in real code)
  could get corrupted by those passes; now it's rendered byte-for-byte.
- **v1.11.0** (2026-09-27) — Notes are now a real notepad, not just an
  import target:
  - **Start a blank note.** The Add sheet now offers "📝 Start a blank
    note" alongside "Choose a file…" — creates an empty note item and
    drops you straight into its editor, no longer requiring an existing
    `.md`/`.txt` file to import first.
  - **Insert a picture.** A new 📷 button in the note editor's toolbar
    picks an image from your device, resizes/compresses it (max 900px,
    same JPEG approach as item cover images), and inserts it as
    `![](data:image/...)` right at the cursor — embedded directly in the
    note's own encrypted text, so it travels with export/import and never
    breaks even if some other shelf item is later deleted. Renders inline
    wherever it appears.
  - **Insert a table.** A new ▦ button drops a ready-to-fill pipe-table
    template (`| Column 1 | ... |` / `| --- | ... |` / rows) at the
    cursor; `renderMarkdown()` now recognizes that syntax and renders a
    real `<table>` (horizontally scrollable on narrow screens) instead of
    falling through to a plain paragraph.
  - The editor toolbar is now two rows (🎵/📷/▦ tools, then Cancel/Save)
    instead of one, since a fourth button in a single row would have been
    too tight on narrow phones (the same issue v1.6.1 fixed for the old
    3-button bar).
- **v1.10.0** (2026-09-27) — PDFs now open in a page-by-page reader
  rendered onto `<canvas>` via a locally-vendored pdf.js, replacing the
  old native `<iframe>` viewer (which offered no reading progress and, on
  some mobile browsers with no built-in PDF viewer, just offered the file
  as a download instead of showing it). Adds Prev/Next controls and a
  "page X / Y" indicator; the current page is saved as reading progress
  (same `progress` field the markdown and audio readers already use) and
  restored the next time you open that item. `lib/pdf.min.mjs` and
  `lib/pdf.worker.min.mjs` are new static files — add them to
  `PRECACHE_URLS` if you're diffing a previous deploy by hand (already done
  in this build's `service-worker.js`).
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
  — via AES-256-GCM with a PBKDF2-derived key (600,000 iterations from v1.51.8, 250,000
  before; the count is stored in the file, random
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
