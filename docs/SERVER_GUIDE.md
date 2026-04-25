# Server Guide

## Mental model

The server is now modular by responsibility.

`server.js` should mostly wire modules together. If a server change starts adding large logic blocks there, it is probably going in the wrong place.

## Main files

- `server.js`: bootstrap and module registration
- `server/ai.js`: server-owned AI configuration and AI status routes
- `server/auth.js`: user DB, JWT middleware, auth endpoints
- `server/search.js`: authenticated search routes and ranking
- `server/sync.js`: Postgres setup plus sync push/pull endpoints
- `server/publicSharing.js`: bucket/public-note APIs and public HTML pages
- `server/proxy.js`: generic outbound HTTP proxy route
- `server/infra.js`: env route and SPA fallback
- `server/http.js`: shared response/logging helpers

## Boot flow

1. `server.js` resolves paths and reads env-driven config.
2. `createSyncPool` may initialize Postgres if `DATABASE_URL` is present.
3. `createUserStore` opens the SQLite user DB.
4. `createAiService` reads the server-owned OpenAI key if configured.
5. A single `requireAuth` middleware is created.
6. Route modules are registered.
7. Static assets and SPA fallback are enabled.

## Request flow by area

Auth:

- routes live in `server/auth.js`
- JWT verification is handled by `requireAuth`
- user records live in `users.db`

Sync:

- routes live in `server/sync.js`
- requires Postgres and auth
- push writes note state into Postgres
- push also triggers server-side indexing for notes, artifacts, and embeddings
- pull returns changed rows since a client timestamp

Public sharing:

- routes live in `server/publicSharing.js`
- file-backed fallback uses `buckets.json` and `public-notes.json`
- Postgres-backed shared notes are used when `pgPool` exists
- HTML page rendering also lives here

Proxy:

- `/proxy` forwards arbitrary HTTP requests
- currently very thin, no advanced policy layer

AI:

- routes live in `server/ai.js`
- the server-owned OpenAI key is the only AI credential
- authenticated AI/search behavior is enforced server-side
- all AI-backed search and embedding operations must remain scoped to `req.user.userId`
- `/api/ai/reindex` rebuilds the current user's server-side artifacts and embeddings from stored notes

Search:

- routes live in `server/search.js`
- `/api/search` is authenticated and user-scoped
- deterministic ranking always runs server-side for signed-in users
- semantic ranking is additive when server AI is configured and stored note/chunk embeddings exist

Infra:

- `/env.mjs` returns a tiny JS module
- SPA fallback serves `dist/index.html` for unknown app routes

## Important design choices

- Auth uses SQLite, sync uses Postgres.
- Public sharing supports both file-backed and Postgres-backed behavior.
- HTML rendering for public pages is server-generated inline, not template-engine based.
- Shared error response shape is normalized through `server/http.js`.
- AI ownership is moving to the server so users do not bring their own provider key.

## How to reason about server changes

If the change is about:

- login/token/user identity: `server/auth.js`
- AI provider configuration or availability routes: `server/ai.js`
- authenticated search behavior: `server/search.js`
- note replication or conflict behavior: `server/sync.js`
- AI provider access or semantic search policy: dedicated AI/search modules
- public URLs or rendered shared pages: `server/publicSharing.js`
- generic HTTP forwarding: `server/proxy.js`
- boot/static/fallback mechanics: `server.js` or `server/infra.js`

## Key invariants

- Keep `server.js` small and compositional.
- Reuse one `requireAuth` instance.
- Prefer `sendJsonError` for consistent JSON error responses.
- Do not mix sync logic into sharing logic or vice versa.
- Do not let AI access policy drift into unauthenticated frontend-only checks.
- If changing public note storage, preserve both API behavior and rendered-page behavior.

## Common mistakes to avoid

- reintroducing route logic directly into `server.js`
- adding per-module one-off error response styles
- changing JWT payload shape without checking frontend auth assumptions
- changing sync schema assumptions without checking local client sync code
- updating public-note API behavior but forgetting the `/n/:slug` HTML route

## Validation

- `node --check server.js`
- `npm test`
- `npm run build`

If changing auth/sync/sharing behavior, manual API smoke tests are still useful.
