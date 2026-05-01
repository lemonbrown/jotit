# Plan: Clickable Secret Alert → Note List Filter

## Overview

When one or more notes contain potential secrets, a global alert should appear in the UI. Clicking it filters the note list to show only those flagged notes. This requires a note-ID-based filter path that bypasses the text search engine.

---

## Current State

- `SecretAlert` (`src/components/SecretAlert.jsx`) renders per-note inside `NotePanel`. It only scans the currently open note's content.
- `useNoteSearch` (`src/hooks/useNoteSearch.js`) drives all filtering. `searchResults` is an array of `{ note, noteId, ... }` objects; when null, all sorted notes are shown.
- `displayedNotes` in `App.jsx:850` is `searchResults?.map(r => r.note) ?? sortedCollectionNotes`.
- `handleSearch(query)` is the only entry point to change the filter today.

---

## What Needs to Be Built

### 1. Global Secret Scan (new hook or util)

**File:** `src/hooks/useSecretScan.js` (new)

Scan all notes for secrets on mount and whenever the notes array changes (debounced). Return a map of `noteId → matches[]` for notes that have at least one match and haven't been marked safe.

```js
// shape returned
{
  flaggedNoteIds: Set<string>,      // IDs of notes with uncleared secrets
  flaggedCount: number,
}
```

Use `scanForSecrets(note.content)` from `secretScanner.js`. Respect the existing `clearedHash` mechanism — skip notes whose content hash matches their stored cleared hash (pull cleared hashes from storage/settings the same way NotePanel does).

Only run if `secretScanEnabled` is true (already a setting).

**Wire up in:** `App.jsx` — call the hook alongside the existing NotePanel per-note scan.

---

### 2. ID-Based Filter in `useNoteSearch`

**File:** `src/hooks/useNoteSearch.js`

Add a parallel filter path for note IDs that does not go through the text search pipeline:

```js
const [idFilter, setIdFilter] = useState(null)   // null | Set<string>

const filterByIds = useCallback((ids) => {
  setIdFilter(new Set(ids))
}, [])

const clearIdFilter = useCallback(() => {
  setIdFilter(null)
}, [])
```

When `idFilter` is set, override `searchResults` to be the matching notes (formatted as `{ note, noteId }` objects to match the existing shape), and skip all text search logic for that render.

Return `filterByIds`, `clearIdFilter`, and `idFilter` from the hook.

Also make `clearSearch` clear the ID filter too.

---

### 3. Global Alert UI

**File:** `src/components/GlobalSecretAlert.jsx` (new)

A small banner or badge that appears in the toolbar/sidebar when `flaggedCount > 0`. Clickable — calls `filterByIds(flaggedNoteIds)` passed down as a prop.

Suggested placement: near the search bar in `App.jsx`, only visible when not already filtering by IDs (so it collapses once clicked and the filter is active). Show a dismiss/clear button so the user can exit the filtered view.

Rough markup shape:
```jsx
<button onClick={() => filterByIds([...flaggedNoteIds])}>
  ⚠ {flaggedCount} note{flaggedCount !== 1 ? 's' : ''} with potential secrets
</button>
```

When the ID filter is active, optionally change the button label to "Showing {n} flagged notes · Clear filter".

---

### 4. Wire Everything Together in `App.jsx`

- Call `useSecretScan(notes, { secretScanEnabled, clearedHashes })`.
- Destructure `filterByIds`, `clearIdFilter`, `idFilter` from `useNoteSearch`.
- Pass `filterByIds` and `flaggedNoteIds` into `GlobalSecretAlert`.
- Place `<GlobalSecretAlert>` near the search bar.

---

## Data Flow

```
notes[]
  └─ useSecretScan → flaggedNoteIds (Set), flaggedCount
                          │
                     GlobalSecretAlert (click)
                          │
                     filterByIds(flaggedNoteIds)
                          │
                     useNoteSearch: idFilter overrides searchResults
                          │
                     displayedNotes = only flagged notes
                          │
                     NoteGrid renders filtered list
```

---

## Non-Goals / Out of Scope

- Scanning note content on the server side.
- Persisting the "flagged" state between sessions (the scan reruns on load).
- Integrating Nib/LLM scanning into the global scan (keep it regex-only for now — Nib scan stays per-note in NotePanel).
- Changing the per-note `SecretAlert` banner inside NotePanel (it stays as-is).

---

## Files Touched

| File | Change |
|------|--------|
| `src/hooks/useSecretScan.js` | New — global scan hook |
| `src/hooks/useNoteSearch.js` | Add `idFilter`, `filterByIds`, `clearIdFilter` |
| `src/components/GlobalSecretAlert.jsx` | New — clickable alert banner |
| `src/App.jsx` | Wire hook, render GlobalSecretAlert |

---

## Open Questions

1. Where exactly in the toolbar should `GlobalSecretAlert` live? (Next to search bar, or in the sidebar header?)
2. Should clicking the alert also open/focus the first flagged note automatically?
3. Should the per-note `SecretAlert` in `NotePanel` also become clickable to set the same ID filter? (Could be a v2.)
