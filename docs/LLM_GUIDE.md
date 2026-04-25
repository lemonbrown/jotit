# JotIt LLM Guide

This document is for future LLMs and code agents working in this repository.

## What JotIt is

JotIt is a local-first note app with:

- a React/Vite frontend in `src/`
- a small Express server in `server.js` plus `server/*.js`
- local persistence for notes/snippets
- optional auth and sync when the server is running with `DATABASE_URL`
- optional OpenAI-powered embeddings, categorization, and semantic search
- public sharing for note buckets and individual notes

The most important design decision is this:

- the frontend is organized around hooks that own behavior clusters
- the server is organized around route-registration modules by responsibility

If you keep those boundaries intact, changes are usually straightforward.

## Current architecture shape

Frontend:

- `src/App.jsx`: composition/root UI shell
- `src/hooks/useAppLifecycle.js`: startup, sync refresh, background embedding/categorization
- `src/hooks/useNoteWorkspace.js`: active note, panes, location history
- `src/hooks/useNoteSearch.js`: note search state/results
- `src/hooks/useNoteDropImport.js`: drag/drop import behavior
- `src/hooks/useNoteMutations.js`: note/snippet writes, deletes, AI follow-up updates

Server:

- `server.js`: assembly/bootstrap only
- `server/auth.js`: user DB, JWT auth, auth routes
- `server/sync.js`: Postgres sync setup and sync routes
- `server/publicSharing.js`: bucket/public-note APIs plus public HTML rendering
- `server/proxy.js`: `/proxy` route
- `server/infra.js`: env route and SPA fallback
- `server/http.js`: shared server helpers for JSON errors/logging

Tests:

- `test/run.js`: simple in-repo test runner
- `test/auth.test.js`: auth coverage
- `test/sync.test.js`: sync coverage

## How to reason about the codebase

When changing behavior, ask:

1. Is this a UI composition problem, or a behavior-cluster problem?
2. Is this local-only state, persisted state, sync state, or derived AI state?
3. Is this a frontend concern, a server concern, or both?

In this repo, the right answer is usually:

- put orchestration in `App.jsx`
- put durable behavior in hooks/utilities
- keep server route logic inside the relevant `server/*.js` module
- avoid re-inlining logic that was already extracted

## Safe modification rules

- Do not re-grow `App.jsx` into a monolith. Add or extend hooks instead.
- Do not put multiple unrelated server responsibilities back into `server.js`.
- Prefer changing one hook/module boundary at a time.
- If a change affects persistence, look at both local DB behavior and sync behavior.
- If a change affects note content, consider embeddings/categories/search side effects.
- If a change affects public sharing, check both JSON APIs and HTML rendering paths.

## Common workflows

Add a new frontend behavior:

- Decide which hook owns it.
- Keep `App.jsx` as the integration layer.
- Only add a new hook if the behavior is cohesive enough to stand on its own.

Change note persistence:

- Start in `src/hooks/useNoteMutations.js`
- Then inspect `src/hooks/useAppLifecycle.js`
- Then inspect `src/utils/db.js` and `src/utils/sync.js`

Change image attachments:

- Attachment logic lives in `src/utils/attachments.js` (validation, resize, markers)
- DB CRUD lives in `src/utils/db.js` (`insertAttachment`, `getAttachmentsForNote`, `deleteAttachment`, `deleteAttachmentsForNote`)
- UI lives in `src/components/NotePanel.jsx` (`handlePaste`, `handleDeleteAttachment`, attachment strip)
- Markers use the format `[img://id]` — search indexing strips them before entity extraction
- Images are stored as base64 data URLs in the local SQLite `attachments` table; they are NOT synced to Postgres yet
- Max size is 5 MB (enforced in `ATTACHMENT_MAX_BYTES`); images larger than 2400 px are resized before storage

Change search:

- Local ranking lives in `src/utils/search.js`
- Note search state lives in `src/hooks/useNoteSearch.js`
- Snippet semantic merge currently happens from `App.jsx`

Change server auth/sync/sharing:

- Find the matching module in `server/`
- Prefer adding helpers inside that module before creating a new top-level module

## Validation expectations

At minimum, after meaningful changes:

- run `npm test`
- run `npm run build`
- if server code changed, also run `node --check server.js`

## Where future documentation lives

- `docs/LLM_GUIDE.md`: this file
- `docs/FRONTEND_GUIDE.md`: frontend flows and mental model
- `docs/SERVER_GUIDE.md`: server responsibilities and request flows
- `docs/SERVER_OWNED_AI_MIGRATION_PLAN.md`: canonical checklist for the server-owned AI migration
