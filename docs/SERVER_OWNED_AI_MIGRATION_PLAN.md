# Server-Owned AI Migration Plan

This document is the canonical task tracker for moving JotIt's AI and embedding functionality from browser-owned API keys to a single server-owned key with account-gated access.

## Goals

- The server owns the only OpenAI API key.
- Users cannot provide or override their own AI key.
- AI-backed functionality is available only to authenticated users.
- Search remains user-scoped.
- "Global search" means all notes for the authenticated user, never all users.

## Status Legend

- `todo`: not started
- `in_progress`: currently being implemented
- `done`: completed
- `blocked`: waiting on a dependency or decision

## Task List

### 1. Server AI ownership

- `done` Add a dedicated server AI module for provider configuration and AI operations.
- `done` Read the OpenAI API key from server environment only.
- `done` Remove browser-side API key initialization as the source of truth.
- `done` Ensure AI requests cannot run without authenticated server mediation.

### 2. Auth-gated AI access

- `done` Make authenticated user state the single frontend gate for AI features.
- `done` Disable guest access to embeddings and semantic search.
- `done` Update auth prompts/copy so AI access clearly requires an account.
- `done` Remove guest-facing UX that implies users can enable AI on their own with a key.

### 3. Search redesign

- `done` Make the backend the single entry point for signed-in semantic search.
- `done` Preserve local keyword search for guests.
- `done` Keep signed-in search scoped by `user_id` at every server query boundary.
- `done` Define merged ranking behavior for keyword plus semantic results.

### 4. Embedding and indexing flow

- `done` Remove client-side query embedding generation.
- `done` Remove client-side note/snippet embedding generation.
- `done` Decide whether indexing runs during sync or via a dedicated indexing endpoint.
- `done` Move note/chunk embedding generation to the backend.
- `done` Keep search artifacts consistent across devices for the same account.

### 5. Frontend cleanup

- `done` Remove OpenAI key settings from the Settings modal.
- `done` Replace client OpenAI helpers with thin server API clients where needed.
- `done` Update search UI to reflect guest keyword search vs signed-in semantic search.
- `done` Update help text and onboarding copy to match the new model.

### 6. Server and data model

- `done` Keep search and sync responsibilities separate.
- `done` Extend or refactor search routes to support server-side semantic search.
- `done` Verify embeddings/search artifacts remain user-scoped in persistence.
- `done` Decide whether snippet semantic search is server-backed, local-only, or deferred.

### 7. Testing

- `done` Add coverage for authenticated AI/search access.
- `done` Add coverage for guest restrictions.
- `done` Add coverage for cross-user search isolation.
- `done` Add coverage for server-backed semantic search behavior.
- `done` Run `npm test`.
- `done` Run `npm run build`.
- `done` Run `node --check server.js`.

### 8. Documentation

- `in_progress` Create and maintain this migration tracker.
- `done` Update `README.md` to reference this migration plan.
- `done` Update `docs/LLM_GUIDE.md` with the new AI ownership direction.
- `done` Update `docs/FRONTEND_GUIDE.md` with the new auth-gated AI/search behavior.
- `done` Update `docs/SERVER_GUIDE.md` with the new server AI responsibility split.

## Current Decisions

- Use a single server-owned OpenAI key.
- Do not allow bring-your-own-key in the client.
- Guests keep local note editing and local keyword search.
- Signed-in users get account-scoped AI features.
- Global search stays per-user, not cross-user.

## Progress Log

- `2026-04-24`: Created initial migration tracker and task breakdown.
- `2026-04-24`: Added cross-links from `README.md` and `docs/LLM_GUIDE.md`.
- `2026-04-24`: Updated frontend and server guides to reflect the server-owned AI direction.
- `2026-04-24`: Added `server/ai.js`, authenticated AI status reporting, and server-backed signed-in search integration.
- `2026-04-24`: Removed browser-owned AI settings and disabled client-side query/note/snippet embedding generation.
- `2026-04-24`: Updated search/help/settings UI copy and revalidated with `node --check server.js`, `npm test`, and `npm run build`.
- `2026-04-24`: Moved signed-in note indexing into the backend sync path, added Postgres chunk-embedding storage, and removed client artifact push scheduling.
- `2026-04-24`: Removed obsolete browser AI modules, kept snippet search local-only, retired `/api/sync/artifacts`, and added authenticated `/api/ai/reindex`.
- `2026-04-24`: Added guest auth, user-scope, semantic fallback, and reindex coverage; revalidated with `node --check server.js`, `npm test`, and `npm run build`.
- `2026-04-24`: Removed dead local chunk-embedding storage/helpers/tests and cleared inert client AI-processing UI state.
