# Refactor Plan — SOLID/DRY

Files over 500 lines targeted for extraction. Each section lists the problem, extractions, and status.

---

## Priority Order

1. `escapeHtml` dedup — 10 min, zero risk
2. `src/utils/highlight.js` — hljs setup extraction
3. `src/utils/codeSymbols.js` — pure code analysis functions
4. `src/utils/db/` — domain split with barrel re-export
5. `src/utils/transforms/` — domain split with barrel re-export
6. NotePanel hooks — one at a time
7. App.jsx hooks + slug move
8. HttpRunner / Settings sub-components

---

## Tasks

- [x] Create `src/utils/escapeHtml.js` — deduplicate from NotePanel + HttpRunner
- [x] Create `src/utils/highlight.js` — extract hljs registration + language detection helpers from NotePanel
- [x] Create `src/utils/codeSymbols.js` — extract classifyCodeSymbol, parseCodeSymbols, buildCollapsedCodeView from NotePanel
- [x] Split `src/utils/db.js` into domain modules under `src/utils/db/`
- [x] Split `src/utils/transforms.js` into `datetime`, `yaml`, `registry` modules
- [x] Extract `useNoteEditorHistory` hook from NotePanel
- [x] Extract `useNoteSelection` hook from NotePanel
- [x] Extract `useNoteMode` hook from NotePanel
- [x] Extract `useSnippetPicker` hook from NotePanel
- [x] Move `normalizeCollectionSlug` from App.jsx to collectionFactories.js
- [x] Extract `useMultiPaneResize` hook from App.jsx
- [x] Extract `useGlobalKeyboardShortcuts` hook from App.jsx
- [x] Extract `HttpRequestPane` component from HttpRunner.jsx
- [x] Split Settings.jsx into section sub-components

---

## File Details

### NotePanel.jsx — 3,590 lines (Critical)

**SRP violations:** God component. 25+ props, 40+ `useState` calls. Mixes rendering,
editor logic, undo/redo, transform state, snippet/template picking, code analysis,
and markdown rendering setup.

**Extractions:**
| Target | What | Lines |
|--------|------|-------|
| `utils/escapeHtml.js` | Shared HTML escaping (also in HttpRunner) | 111–118 |
| `utils/highlight.js` | hljs registration + `normalizeCodeLanguage`, `detectPreferredCodeLanguage`, `shouldAutoIndentForLanguage` | 63–178 |
| `utils/codeSymbols.js` | `classifyCodeSymbol`, `parseCodeSymbols`, `buildCollapsedCodeView` | 185–305 |
| `hooks/useNoteEditorHistory.js` | Undo/redo refs, timer, push/pop | 1115–1210 |
| `hooks/useNoteSelection.js` | Selection tracking + transform/calculator state | 1090–1115 + related state |
| `hooks/useNoteMode.js` | `mode`, `diffCapture`, diff instance + side effects | ~415, 446–450, 1075–1088 |
| `hooks/useSnippetPicker.js` | Snippet/template picker state + tab stop state | ~461–465 + handlers |

---

### App.jsx — 1,424 lines (High)

**SRP violations:** `AppShell` holds all global state, orchestration, keyboard shortcuts,
note/collection management, sync coordination, and pane resize logic.

**Extractions:**
| Target | What |
|--------|------|
| `hooks/useMultiPaneResize.js` | `paneWidths` state + `startPaneResize` (lines 110–132) |
| `hooks/useGlobalKeyboardShortcuts.js` | Global keyboard handler |
| `utils/collectionFactories.js` | Move `normalizeCollectionSlug` (line 47) |

---

### db.js — 712 lines (Medium)

**SRP violation:** One file handles 7 distinct entity domains.

**Split (db.js becomes barrel re-export — zero callsite changes):**
| File | Contents |
|------|----------|
| `db/core.js` | IDB helpers, schema, `initDB`, `schedulePersist`, `persist`, `migrateNote`, deserializers |
| `db/notes.js` | Note CRUD |
| `db/collections.js` | Collection CRUD |
| `db/search.js` | Chunks, entities, search metadata |
| `db/snippets.js` | Snippets + Templates |
| `db/attachments.js` | Attachments + Pins + `exportSQLite` |

---

### transforms.js — 656 lines (Medium)

**SRP violation:** Mixes date/time parsing, YAML prettification, and transform registry.

**Split (transforms.js becomes barrel re-export):**
| File | Contents |
|------|----------|
| `transforms/datetime.js` | All date/time detection and formatting |
| `transforms/yaml.js` | `looksLikeYaml`, `prettifyYamlLike` |
| `transforms/registry.js` | `TRANSFORMS` array, `applyTransform`, path utils |

---

### HttpRunner.jsx — 583 lines (Medium)

**DRY violation:** `escapeHtml` duplicated from NotePanel.
**SRP:** `RequestPane` (lines 140–449) is 309 lines, should be its own file.

**Extractions:**
- Delete local `escapeHtml`, import from `utils/escapeHtml.js`
- `components/HttpRequestPane.jsx` — `RequestPane` + `HeadersTable` + `MethodBadge`

---

### Settings.jsx — 601 lines (Medium)

**SRP violation:** One render function with all settings sections inlined.

**Split into sub-components:**
- `components/settings/ProfileSection.jsx`
- `components/settings/AppearanceSection.jsx`
- `components/settings/SyncSection.jsx`
- `components/settings/EncryptionSection.jsx`
- `components/settings/DangerZoneSection.jsx`
