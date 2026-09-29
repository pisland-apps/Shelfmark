# Shelfmark tests (dev only)

Not deployed — `service-worker.js` precaches an explicit file list, so nothing
in this folder ships to users. Run from this folder:

    npm install
    npm test

- `test_dispatcher.js` / `test_dispatcher_containment.js` — the v1.51.4 event
  dispatcher (`data-on-click` etc.) against the real `index.html` markup.
- `test_links.js` — `renderMarkdown` link/image URL parsing (nested parentheses,
  legacy fallbacks, apostrophes) plus hostile-input cases: unsafe schemes,
  attribute breakout, inline `on*` attributes, and performance on a 6 MB
  data-URI image. **Add new hostile strings to the `hostile` array there.** It also covers forged
  code-block placeholders and `$&`-style patterns in code samples (v1.51.10).
- `load.js` — loads the real `app.js` + `index.html` into jsdom with
  fake-indexeddb, so tests call the app's own `renderMarkdown`.
- `test_ext_wipe.js` — erasing the shelf also deletes the `shelfmark-ext`
  (linked folder) database and resets the in-memory folder state (v1.51.6).
- `test_ext_sync.js` — folder sync (v1.51.7): rename, move, delete, restore,
  adopting an existing note, unlink → relink, and the safety cases (permission
  error, unreadable folder), using an in-memory fake folder.
- `test_kdf.js` — key derivation (v1.51.8): 600k for new passcodes, old records and
  backups still open, crafted iteration counts refused, minimum length still 4,
  advisory strength hint.
- `test_import_merge.js` — import summary wording (v1.51.9): newer-on-shelf vs unreadable.
- `test_write_queue.js` — put/del/undo go through the write queue (v1.51.10); forces the
  stale-write interleavings by delaying `getOneRaw`.
- `test_autolock.js` — idle / background auto-lock and Lock now (v1.51.11): timing rules,
  activity resets, sound and export/import holds, queued writes finish first, draft kept,
  settings panel, no-passcode mode never locks. Replaces the page reload with a stub.
- `test_export_stream.js` — chunked/streamed backup format v2 (v1.52.0): round trips at tiny chunk sizes, tamper/truncate/reorder
  refusals, wrong passphrase vs damaged file, save-dialog path, cancel, plain export, and old-format fixtures
  (`fixtures/`, made with `make_legacy_fixtures.js` against a v1.51.14 project).
- `test_fences.js` — code fences must start a line (v1.51.14): mid-line backticks never open a block,
  indented / CRLF / legacy-closer fences still work, unclosed fence stays text, Tags page and editor use the
  same rule, plus a 400-input fuzz that must keep `<pre>` / `<code>` balanced.
- `test_undo_rekey.js` — Undo slot dropped on a passcode change (v1.51.14), including a delete that is
  mid-flight when the key changes.
- `test_item_binding.js` — AES-GCM item-id binding (v1.51.13): a copied/swapped blob is refused,
  old-format records still open and are upgraded a blob at a time, drafts, passcode change,
  export/import round trip, backups and the verifier unchanged. Old-format records are built
  with raw WebCrypto, not the app's helpers.
- `test_inline_code.js` — inline code spans (v1.51.12): double-backtick spans, unmatched backticks,
  nothing after a bad span turning into code, tag extraction. Cases are in `inline_code_cases.js`
  so the same checks can be run in a real browser.
