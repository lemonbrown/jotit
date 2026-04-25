# Frontend Guide

## Mental model

The frontend is local-first and hook-driven.

`src/App.jsx` should be read as a composition root, not as the place where core business rules live.

The repo is also moving toward account-gated AI. Frontend AI behavior should be treated as an authenticated capability, not as a browser-owned API key feature.

The main state buckets are:

- notes/snippets data
- workspace state
- search state
- modal/UI toggles
- local agent / API tooling state

## Main files

- `src/App.jsx`: assembles hooks and renders the shell
- `src/contexts/AuthContext.jsx`: auth state for frontend/server auth
- `src/hooks/useAppLifecycle.js`: app boot and background effects
- `src/hooks/useNoteWorkspace.js`: pane/layout/history logic
- `src/hooks/useNoteSearch.js`: search query/results state
- `src/hooks/useNoteDropImport.js`: file drag/drop flow
- `src/hooks/useNoteMutations.js`: write/delete/update paths
- `src/hooks/useServerAiStatus.js`: signed-in account check for server AI availability
- `src/hooks/useLocalAgentStatus.js`: local `jotit-agent` health detection for HTTP execution

Supporting utilities:

- `src/utils/db.js`: local note/snippet/attachment persistence layer
- `src/utils/sync.js`: sync push/pull scheduling
- `src/utils/noteFactories.js`: note/snippet creation shapes
- `src/utils/noteTypes.js`: note-type/document helpers
- `src/utils/search.js`: deterministic local ranking
- `src/utils/importNotes.js`: dropped-file import rules
- `src/utils/attachments.js`: image validation, resize pipeline, marker helpers
- `src/utils/openapi/*`: OpenAPI parsing, normalization, request generation, and validation helpers

## App flow

Startup:

1. `App` waits for auth context loading.
2. `AppShell` mounts.
3. `useAppLifecycle` initializes local DB and loads notes/snippets.
4. The first available note is opened into a single pane.
5. Search artifacts are refreshed locally and synced when applicable.

Editing:

1. `NotePanel` emits updates.
2. `App` delegates updates to `useNoteMutations`.
3. Local persistence is updated immediately.
4. Search artifacts are updated for local/server search.
5. Sync scheduling may occur after local writes.
6. For signed-in users, server indexing now happens during sync push rather than from client artifact uploads.

Searching:

1. Query state lives in `useNoteSearch`.
2. Local note ranking is computed first.
3. Guests stay on local keyword search only.
4. Signed-in users query `/api/search` for account-scoped global search, with semantic ranking when server AI is enabled.
5. Snippet search is local-only for now.

Workspace navigation:

1. `useNoteWorkspace` owns active note/pane/history.
2. Pane selection and note navigation should go through workspace functions.
3. Location history captures cursor and scroll context for restoration.

Import:

1. Drag/drop events are handled by `useNoteDropImport`.
2. File parsing/import rules live in `src/utils/importNotes.js`.
3. OpenAPI 3.x JSON files are imported as dedicated OpenAPI notes with structured `noteData`.
4. Imported notes are persisted and indexed like any other note, without browser-owned AI work.

HTTP execution:

1. `HttpRunner` parses one or more requests from note text.
2. If local agent mode is enabled, the frontend probes `http://127.0.0.1:3210/health`.
3. When available, structured execution requests are sent to `jotit-agent`.
4. Browser-direct execution remains available for CORS-friendly requests.
5. Binary responses from the local agent can be downloaded locally.

OpenAPI:

1. OpenAPI 3.x JSON imports are normalized on import.
2. OpenAPI notes open in `OpenApiViewer` by default.
3. Operations can be turned into temporary structured HTTP runner requests.
4. Users can copy a generated request into a new plain-text note if they want to keep it.
5. Imported operations are indexed for workspace search through the normal note artifact pipeline.

Image attachments:

1. User pastes an image (Ctrl+V / Cmd+V) while the note editor is focused.
2. `handlePaste` in `NotePanel` intercepts any `image/*` clipboard item.
3. `processImageFile` validates (type + 5 MB limit), reads via `FileReader`, and resizes if > 2400 px.
4. The processed data URL is written to the local `attachments` SQLite table.
5. A `[img://id]` marker is inserted at the cursor in the note content.
6. A thumbnail strip renders below the editor; each thumbnail has a delete button.
7. Deleting a thumbnail removes the DB row and scrubs the marker from content.
8. A content-change effect also removes orphaned DB rows if a marker was deleted by hand.
9. Attachments are local-only for now — they are not synced to Postgres.

## Key invariants

- `App.jsx` composes; it should not become the new home for deep behavior.
- Notes and snippets are updated optimistically in local state.
- Persistence happens close to mutation logic.
- Search uses a local-first strategy for guests and a server-backed account search path for signed-in users.
- OpenAPI documents are dedicated note types, not plain text notes with ad hoc parsing scattered through the UI.
- AI behavior is additive, not required for the app to function.
- Guest users should only get local, non-AI search behavior.
- Signed-in AI access should be mediated by the server, not by a user-provided client key.

## How to change frontend code safely

If changing panes/history:

- start with `src/hooks/useNoteWorkspace.js`

If changing note create/update/delete behavior:

- start with `src/hooks/useNoteMutations.js`

If changing startup/sync/background effects:

- start with `src/hooks/useAppLifecycle.js`

If changing search:

- start with `src/hooks/useNoteSearch.js` and `src/utils/search.js`

If changing OpenAPI behavior:

- start with `src/utils/openapi/`
- then `src/components/OpenApiViewer.jsx`
- then `src/components/HttpRunner.jsx` if execution behavior changes

If changing imports:

- start with `src/hooks/useNoteDropImport.js` and `src/utils/importNotes.js`

If changing image attachment behavior:

- start with `src/utils/attachments.js` (validation/processing rules)
- then `src/utils/db.js` (storage schema)
- then `src/components/NotePanel.jsx` (`handlePaste`, `handleDeleteAttachment`, attachment strip JSX)

## Common mistakes to avoid

- duplicating persistence logic in UI components
- adding new cross-cutting behavior directly to `App.jsx`
- forgetting search/indexing side effects after document-shape changes
- changing note shape creation in multiple places instead of `noteFactories`
- bypassing workspace helpers when opening/closing panes

## Validation

- `npm test`
- `npm run build`

If a change affects user-visible flows, also manually check:

- note creation
- note editing
- pane switching
- search
- snippet creation/search
- drag/drop import
- auth sign-in state
