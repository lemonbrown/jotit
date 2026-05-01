# Kanban Board — Implementation Plan

## Summary
Add a board view mode to jotit where notes are cards arranged in swimlane columns. Toggle between list and board view per collection. Dragging a card between columns updates the note's `kanban_status` field.

## Architecture
- **`kanban_status` field** on notes (nullable TEXT, stored in SQLite)
- **`kanban_columns` field** on collections (JSON array of column names, e.g. `["Backlog","In Progress","Review","Done"]`)
- **Board view toggle** in NoteGrid toolbar — switches between existing list view and board view
- **`KanbanBoard` component** — horizontal lanes, each lane a vertical drop target
- **Drag-and-drop** via HTML5 drag API (no extra deps, notes already have `draggable`)
- Clicking a card still calls `onSelectNote` → opens NotePanel as usual

## Tasks

- [x] DB migration: add `kanban_status` column to `notes` table in `core.js`
- [x] DB migration: add `kanban_columns` column to `collections` table in `core.js`
- [x] Update `deserialize` in `notes.js` to include `kanbanStatus`
- [x] Update `upsertNoteSync` in `notes.js` to persist `kanbanStatus`
- [x] Update `deserializeCollection` in `collections.js` to include `kanbanColumns`
- [x] Update `upsertCollectionSync` in `collections.js` to persist `kanbanColumns`
- [x] Add `setNoteKanbanStatus` helper in `notes.js`
- [x] Add `setCollectionKanbanColumns` helper in `collections.js`
- [x] Create `KanbanBoard.jsx` component with column lanes and drag-and-drop
- [x] Add board view state + toggle button to `NoteGrid.jsx`
- [x] Wire `onKanbanStatusChange` and `kanbanColumns` props through `NoteGrid` → `KanbanBoard`
- [x] Pass `updateNote`, `kanbanColumns`, `setCollectionKanbanColumns` from `App.jsx` to `NoteGrid`
- [x] Style the board: horizontal scroll, column lanes, card styling, drag-over highlight
- [x] Add column management UI in board header (add/rename/delete columns)
