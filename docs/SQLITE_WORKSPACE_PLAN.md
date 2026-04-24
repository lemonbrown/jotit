# SQLite Workspace Plan

## Goal

Add the ability to open a local SQLite database file in JotIt, inspect its schema and tables, and grow toward editing support without mixing external database handling into JotIt's own application database in `src/utils/db.js`.

## Current Scope

Initial implementation target:

- import `.sqlite`, `.db`, and `.sqlite3` files via the existing drop/import flow
- persist imported database bytes locally
- create a note linked to the imported database asset
- open a dedicated SQLite viewer mode from the note
- inspect schema and browse table rows in a read-only flow

Deferred for later:

- cell editing
- row insert/delete
- ad hoc SQL query execution beyond the new read-only `SELECT` query tab
- replacing a stored database asset after editing
- sync or public sharing for SQLite assets

## Task Checklist

- [x] Review current import and viewer integration points.
- [x] Add a local SQLite asset store in IndexedDB for imported database files.
- [x] Add a note-link format/helper for SQLite-backed notes.
- [x] Extend dropped-file import to detect SQLite files and create linked notes.
- [x] Add a read-only SQLite inspection utility layer.
- [x] Build a `SQLiteViewer` component for schema/table browsing.
- [x] Integrate SQLite viewer mode into `NotePanel`.
- [x] Update drag/drop copy to mention SQLite imports.
- [x] Validate with `npm run build`.
- [x] Validate with `npm test`.
- [x] Add targeted tests for note markers, read-only inspection helpers, and SQLite import behavior.
- [x] Add query-tab support for ad hoc `SELECT` statements.
- [x] Add explicit save/export support for modified external SQLite assets.
- [x] Add constrained row editing for simple tables.
- [x] Add view browsing beyond schema-only display.

## Implementation Notes

- Keep external SQLite handling separate from `src/utils/db.js`; that module owns JotIt's internal app DB.
- Use local-only persistence, aligned with existing attachment/local DB behavior.
- Use explicit note linkage to an imported asset so the feature can live inside the existing pane/note workflow.
- Start read-only to keep row identity, mutation safety, and binary/blob handling out of the first slice.

## Findings

- JotIt already ships `sql.js` and uses IndexedDB-backed persistence for its own app database, so browser-side SQLite inspection does not require a new runtime.
- The best integration point for importing database files is `src/utils/importNotes.js`, with drag/drop orchestration already owned by `src/hooks/useNoteDropImport.js`.
- `NotePanel.jsx` already supports multiple specialized viewer/editor modes, so a SQLite mode can fit that existing pattern without expanding `App.jsx` significantly.
- External SQLite assets are easiest to model as separate IndexedDB records keyed by asset id; reusing the internal app DB store would blur application persistence with imported-file storage.
- A simple note marker (`[sqlite://asset-id]`) is enough to link a note to a local DB asset and keeps the feature compatible with the existing note/pane workflow.
- The first implementation is intentionally read-only: tables support paged row browsing, while views currently expose schema text only.
- Query mode now supports single-statement `SELECT` execution with guardrails in the SQLite utility layer so the UI stays thin and reusable.
- SQLite assets can now be exported from the viewer and replaced in local storage, which provides the persistence/download path needed before editing support lands.
- Views now share the same paged read-only browsing flow as tables instead of stopping at schema display.
- Simple table rows can now be edited when the table exposes a usable `rowid`, and saves write a fresh SQLite byte snapshot back into the local asset store.
- Validation result: `npm run build` passed on April 24, 2026; `npm test` passed with 40 tests on April 24, 2026.
- Node-based tests could not import the browser wrapper around `sql.js` directly because of the `?url` wasm path, so the SQLite logic was split into a testable core module plus a thin browser runtime wrapper.
- `importNotes.js` also needed a small testability refactor so browser-only DB/OpenAI dependencies are loaded in the runtime path instead of at module import time.
- Validation result updated: `npm test` passed with 44 tests on April 24, 2026.
- Validation result updated: `npm test` passed with 47 tests on April 24, 2026.
- Validation result updated: `npm test` passed with 54 tests on April 24, 2026.
- Validation result updated: `npm test` passed with 56 tests on April 24, 2026.

## Implemented in First Slice

- `src/utils/sqliteAssets.js`: local IndexedDB asset store for imported SQLite files
- `src/utils/sqliteNote.js`: note marker and SQLite-linked note creation helpers
- `src/utils/externalSqlite.js`: read-only schema and table inspection helpers using `sql.js`
- `src/utils/externalSqliteCore.js`: testable core for schema/table inspection logic
- `src/components/SQLiteViewer.jsx`: schema explorer, paged table browser, and read-only query tab
- `src/components/SQLiteViewer.jsx`: schema explorer, paged table/view browser, read-only query tab, and export/replace controls
- `src/components/SQLiteViewer.jsx`: schema explorer, paged table/view browser, read-only query tab, export/replace controls, and constrained row editing for simple tables
- `src/utils/sqliteAssets.js`: local IndexedDB asset store plus asset replacement/export helpers
- `src/utils/externalSqlite.js`: browser runtime for read/write SQLite inspection against external assets
- `src/utils/externalSqliteCore.js`: testable query, browse, and constrained row-update helpers
- `src/utils/importNotes.js`: SQLite file detection and linked-note creation
- `src/components/NotePanel.jsx`: SQLite mode button and viewer integration
- `src/App.jsx`: drag/drop messaging updated for SQLite imports
- `test/sqlite-workspace.test.js`: coverage for SQLite note markers, inspection helpers, and import behavior
