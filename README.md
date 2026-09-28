# Shelfmark

Your own shelf, added by hand — a private, offline-first personal library
for PDFs, notes (Markdown), pictures, and audio recordings. Fully
client-side: no backend, no account, no analytics. Everything is encrypted
and stored only in your browser's IndexedDB, on your own device.

## Features in this build

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
  reachable from anywhere) opens an overlay covering every syntax the
  editor supports — bold/italic/~~strikethrough~~/==highlight==/headings, lists and `- [ ]` checklists,
  `> [!note]`-style callouts, fenced code blocks, tables, images/dividers,
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
  for them yet — type the delimiters by hand.
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
  their onclick handlers touch that specific element directly without a
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
