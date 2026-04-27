# Collections Implementation Plan

This document defines the implementation plan for adding user-visible collections to JotIt. Collections are note groupings. They are separate from the existing editor workspace/pane logic owned by `src/hooks/useNoteWorkspace.js`.

## Goal

Allow a user to organize notes into one or more collections without weakening JotIt's local-first behavior, sync model, or existing pane workflow.

## Product Outcome

JotIt should let users:

- create, rename, and delete collections
- switch the notes pane between collections
- create notes inside the active collection
- move notes between collections
- keep existing notes in a default collection after migration
- search within the active collection, with a later path to search across all collections

## Terminology

- **Collection**: user-visible grouping of notes.
- **Editor workspace**: existing internal pane, active note, and location-history state in `useNoteWorkspace`.
- **Default collection**: automatically created collection that receives existing notes and acts as the safe fallback.

Use `collection` in new domain models, UI copy, database fields, and API payloads. Do not introduce new user-facing "workspace" terminology for this feature.

## Scope

### In scope

- local collection persistence in `src/utils/db.js`
- default collection migration for existing notes
- note-to-collection association
- active collection state
- collection selector in the app shell
- create, rename, delete, and move-note flows
- current-collection search behavior
- sync support for collections and note `collection_id`
- focused tests for local persistence, mutations, filtering, and sync

### Out of scope for first milestone

- nested collections
- collection sharing separate from note sharing
- per-collection permissions
- collection icons/colors
- public collection pages
- cross-collection semantic search UI
- bulk collection management beyond moving one note at a time

## Core Design Rules

### 1. Keep collections separate from editor panes

`useNoteWorkspace.js` should continue to own active note, editor panes, and location history. Collections should live in a separate hook, likely `src/hooks/useCollectionCatalog.js`.

This preserves single responsibility and avoids turning the pane hook into a general app-state bucket.

### 2. Keep persistence centralized

All local SQLite schema and CRUD for collections should live in `src/utils/db.js`. UI components and hooks should call focused DB helpers instead of constructing SQL or duplicating migration behavior.

Expected helpers:

- `ensureDefaultCollection()`
- `getAllCollections()`
- `upsertCollectionSync(collection, dirty = 1)`
- `markCollectionPendingDelete(id)`
- `deleteCollectionSync(id)`
- `getNotesForCollection(collectionId)`
- `moveNoteToCollection(noteId, collectionId)`

### 3. Create domain objects through factories

Collection object creation should live in a helper such as `src/utils/collectionFactories.js`.

This keeps IDs, timestamps, defaults, and validation DRY.

### 4. Make deletion conservative

Deleting a collection should not delete notes in the first milestone. Move notes from the deleted collection into the default collection, then remove or mark-delete the collection.

This avoids accidental data loss and keeps the first implementation simple.

### 5. Keep sync account-scoped

Server-side collection data must remain scoped to `req.user.userId`, matching notes, search, and indexing behavior.

## Data Model

### Local SQLite

Add a `collections` table:

```sql
CREATE TABLE IF NOT EXISTS collections (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  is_default     INTEGER NOT NULL DEFAULT 0,
  dirty          INTEGER NOT NULL DEFAULT 1,
  pending_delete INTEGER NOT NULL DEFAULT 0
);
```

Add collection ownership to notes:

```sql
ALTER TABLE notes ADD COLUMN collection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_collection_id ON notes(collection_id);
```

Migration behavior:

1. Create the default collection if missing.
2. Assign any note with a missing `collection_id` to the default collection.
3. Persist the migrated local DB.

### Frontend Shape

Use camelCase in app code:

```js
{
  id,
  name,
  description,
  createdAt,
  updatedAt,
  isDefault,
  dirty,
  pendingDelete,
}
```

Notes should expose:

```js
{
  collectionId,
}
```

## Frontend Plan

### 1. Add collection persistence

Update `src/utils/db.js`:

- create/migrate the `collections` table
- add `collection_id` to `notes`
- serialize/deserialize `collectionId`
- add collection CRUD helpers
- include `collection_id` in note upsert paths

### 2. Add collection factory

Create `src/utils/collectionFactories.js`:

- `createCollectionDraft({ name, description, isDefault })`
- optionally `createDefaultCollectionDraft()`

Validate that collection names are non-empty after trimming.

### 3. Add collection state hook

Create `src/hooks/useCollectionCatalog.js`.

Responsibilities:

- hold `collections`
- hold `activeCollectionId`
- load collections after DB init
- create collection
- rename collection
- delete collection
- move note to collection
- expose active collection metadata

The hook should coordinate with note mutations through callbacks rather than directly owning all note state.

### 4. Update app lifecycle

Update `src/hooks/useAppLifecycle.js` so boot flow becomes:

1. initialize DB
2. ensure default collection
3. load collections
4. load notes
5. choose active collection
6. open the first note in the active collection

When the active collection changes, the app should:

- display only notes from that collection
- close or replace panes showing notes outside the selected collection
- clear active search results if they no longer match the selected collection

### 5. Update mutations

Update `src/hooks/useNoteMutations.js`:

- new notes receive the active `collectionId`
- imported notes receive the active `collectionId`
- seeded notes receive the active `collectionId`
- moving a note between collections updates persistence and local state
- deleting all notes should apply to the active collection, not every collection

### 6. Update UI

Add a compact collection selector near the notes pane header in `src/App.jsx`.

Initial controls:

- select active collection
- create collection
- rename active collection
- delete active collection
- move current note to another collection

Keep the UI small and operational. Collections should support note flow, not become a separate dashboard in the first milestone.

### 7. Update search

For the first milestone, search should run against the active collection's notes only.

Later enhancement:

- add an explicit "all collections" search mode
- show collection names in search results
- add server-side collection filtering for authenticated search

## Server And Sync Plan

### 1. Postgres schema

Update `server/sync.js`:

```sql
CREATE TABLE IF NOT EXISTS collections (
  id             TEXT NOT NULL,
  user_id        INTEGER NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  is_default     INTEGER NOT NULL DEFAULT 0,
  deleted_at     BIGINT,
  PRIMARY KEY (id, user_id)
);
```

Add note collection ownership:

```sql
ALTER TABLE notes ADD COLUMN IF NOT EXISTS collection_id TEXT;
CREATE INDEX IF NOT EXISTS notes_user_collection_updated ON notes (user_id, collection_id, updated_at);
```

### 2. Sync payloads

Extend `/api/sync/push` and `/api/sync/pull` to include collections:

```json
{
  "collections": [],
  "notes": []
}
```

Notes should include `collection_id`.

Keep conflict behavior consistent with notes: latest `updated_at` wins.

### 3. Search routes

Update authenticated search so results can be filtered by `collectionId`.

First milestone option:

- client passes active collection id
- server restricts SQL candidates to that collection

Avoid client-only filtering for signed-in semantic search because that can rank and return notes outside the active collection before filtering.

## Testing Plan

Add `test/collections.test.js` for local behavior:

- default collection is created
- existing notes are assigned to default collection
- new notes persist `collectionId`
- collection rename updates timestamps
- deleting a collection moves notes to default
- moving a note updates `collectionId`

Extend sync tests:

- sync push persists collections
- sync pull returns collections
- note sync preserves `collection_id`
- deleted collections do not return as active records

Extend search tests where needed:

- active collection search excludes notes from other collections
- server search applies collection filtering

## Implementation Order

1. Add local DB schema, migrations, serializers, and CRUD helpers.
2. Add collection factories.
3. Add `useCollectionCatalog`.
4. Wire boot/loading in `useAppLifecycle`.
5. Update note creation, import, seed, delete-all, and move flows.
6. Add collection selector and actions in the app shell.
7. Scope local search to active collection.
8. Add sync schema and payload support.
9. Add authenticated search collection filtering.
10. Add tests and update docs.

## Open Questions

- Should the active collection be stored locally across reloads?
- Should delete collection be disabled for the default collection?
- Should imported SQLite/OpenAPI notes inherit the active collection automatically?
- Should snippets belong to collections now, or remain global until a later milestone?

## Validation

After implementation:

- `npm test`
- `npm run build`
- `node --check server.js` if server sync/search changed

Manual checks:

- create collection
- rename collection
- delete non-default collection
- create note in collection
- move note between collections
- search current collection
- sign in, sync, reload, and confirm collections survive
