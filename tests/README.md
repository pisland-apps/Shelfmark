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
  data-URI image. **Add new hostile strings to the `hostile` array there.**
- `load.js` — loads the real `app.js` + `index.html` into jsdom with
  fake-indexeddb, so tests call the app's own `renderMarkdown`.
- `test_ext_wipe.js` — erasing the shelf also deletes the `shelfmark-ext`
  (linked folder) database and resets the in-memory folder state (v1.51.6).
