# Refactor - Remaining Work

## What Was Completed

| # | Task | Notes |
|---|------|-------|
| Done | `src/utils/escapeHtml.js` | Extracted from NotePanel + HttpRunner (was duplicated) |
| Done | `src/utils/highlight.js` | hljs registration + normalizeCodeLanguage, detectPreferredCodeLanguage, shouldAutoIndentForLanguage |
| Done | `src/utils/codeSymbols.js` | classifyCodeSymbol, parseCodeSymbols, buildCollapsedCodeView |
| Done | `src/utils/db/` domain split | `_instance`, core, notes, collections, search, snippets, attachments; `db.js` is a barrel |
| Done | `src/utils/transforms/` split | datetime, yaml, registry; `transforms.js` is a barrel |
| Done | `normalizeCollectionSlug` move | Exported from `collectionFactories.js` and covered by collection tests |
| Done | `useMultiPaneResize` hook | Extracted editor pane resize state, drag handling, and stale pane cleanup |
| Done | `useNoteEditorHistory` hook | Extracted undo/redo history refs, debounced history push, immediate push, and note reset |
| Done | `useNoteSelection` hook | Extracted selection, transform, calculator, inline copy state, and selection handlers |
| Done | `useNoteMode` hook | Extracted mode, diff capture/loader state, code slice state, and diff loader registration effect |
| Done | `useSnippetPicker` hook | Extracted picker state, active index, tab stop state, close behavior, and tab stop navigation |
| Done | `useGlobalKeyboardShortcuts` hook | Consolidated App-level keydown shortcuts into a side-effect hook |
| Done | `HttpRequestPane` extraction | Moved request execution pane and subcomponents to `HttpRequestPane.jsx`; `HttpRunner.jsx` now imports it |
| Done | `Settings.jsx` section split | Settings is now a shell rendering Appearance, Profile, Sync, Encryption, and Danger Zone sections |

---

## What's Left

No refactor tasks remain from the current checklist.

---

## Risk Notes

- **NotePanel hooks**: These are the highest-risk extractions because NotePanel has complex interdependencies between state. Extract one hook at a time and verify the component still renders before moving to the next.
- **useGlobalKeyboardShortcuts**: App.jsx's keyboard handler likely touches many state setters. Map all dependencies before extracting.
- **HttpRequestPane**: Keep behavior unchanged while moving the local sub-components.
