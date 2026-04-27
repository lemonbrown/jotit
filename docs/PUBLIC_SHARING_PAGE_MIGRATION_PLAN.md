# Public Sharing Page Migration Plan

## Goal

Move shared note and bucket pages away from server-generated inline HTML/CSS/JS and into normal Vite-served frontend pages, while keeping the database as a data source only and preserving existing public URLs:

- `/n/:slug`
- `/b/:bucket`
- `/b/:bucket/:collectionSlug`

The end state should keep public sharing modular, testable, and DRY. Server code should expose stable JSON data contracts. Frontend code should own public page presentation through normal components, styles, and built assets.

## Progress

- `done` 2026-04-27: Backwards compatibility requirement removed by user. Implementation can delete server-rendered public HTML routes instead of keeping a staged compatibility layer.
- `done` 2026-04-27: Audited `docs/SERVER_GUIDE.md`, `docs/FRONTEND_GUIDE.md`, `docs/LLM_GUIDE.md`, `server/publicSharing.js`, `src/main.jsx`, `src/App.jsx`, and existing public sharing tests.
- `done` 2026-04-27: Replaced `/n` and `/b` server HTML responses with SPA fallback plus JSON public page APIs.
- `done` 2026-04-27: Added Vite-rendered public note, bucket, and collection pages.
- `done` 2026-04-27: Updated public sharing tests and docs.
- `done` 2026-04-27: Validation passed with `node --check server.js`, `npm test`, and `npm run build`.

## Current State

Public sharing currently concentrates too many responsibilities in `server/publicSharing.js`:

- publishing, listing, and deleting public note links
- file-backed fallback reads/writes for `public-notes.json` and `buckets.json`
- Postgres-backed public note and bucket lookups
- markdown and diagram rendering
- full HTML/CSS/JS string rendering for `/n` and `/b` routes

This violates single responsibility and makes the public pages hard to evolve because data retrieval, serialization, presentation, styling, and browser behavior are coupled in one server module.

## Product Outcome

Users should see the same public sharing capabilities:

- publishing a note still returns a `/n/:slug` link
- public collections still use `/b/:bucket/:collectionSlug`
- public bucket indexes still use `/b/:bucket`
- existing shared links remain valid
- public note pages keep useful reading features such as heading navigation, markdown rendering, diagrams, categories, and timestamps where supported

The implementation should change how pages are served, not the public URL model.

## Design Rules

### 1. Keep Server Responsibilities Narrow

The server should own:

- public data lookup
- authorization for management endpoints
- validation
- stable JSON response shapes
- consistent JSON errors through `sendJsonError`

The server should not own:

- page layout
- inline styles
- browser interaction scripts
- duplicated markdown presentation rules

### 2. Keep Frontend Page Rendering Cohesive

The frontend should own:

- `/n` and `/b` public page routes
- loading states
- not-found states
- public note, bucket, and collection layouts
- heading outline behavior
- markdown/diagram display components

Do not add large public-page behavior blocks directly to `src/App.jsx`. Use dedicated public route components and small utilities/hooks.

### 3. Keep Data Contracts DRY

Use one normalized public data shape per page type and share it across file-backed and Postgres-backed paths.

Avoid having one response shape for Postgres and a subtly different shape for JSON fallback. Both storage paths should feed the same serializer functions.

### 4. Keep Rendering Utilities Shared

Do not duplicate markdown cleanup, heading extraction, note title extraction, preview generation, or diagram rendering logic across public note, public bucket, and public collection pages.

Extract shared utilities where needed, likely under:

- `src/utils/publicContent.js`
- `src/components/public/PublicMarkdown.jsx`
- `src/components/public/PublicNoteCard.jsx`

### 5. Preserve Existing APIs Unless There Is A Clear Migration Need

Keep current management endpoints stable:

- `POST /api/public-note/publish`
- `GET /api/public-note/:slug`
- `GET /api/public-notes`
- `DELETE /api/public-note/:slug`
- `GET /api/bucket/me`
- `PUT /api/bucket/name`
- `PUT /api/collections/:id/visibility`
- `PUT /api/notes/:id/collection-visibility`

New public page APIs should be additive first, then old server-rendered HTML routes can be removed after frontend parity exists.

## Proposed Architecture

### Server Modules

Keep `server.js` as the composition root only.

Introduce or refactor toward these boundaries:

- `server/publicSharing.js`: route registration and request orchestration
- `server/publicSharingStore.js`: file/Postgres data access for public sharing
- `server/publicSharingSerializers.js`: normalized public page response builders
- `server/publicSharingValidation.js`: slug and bucket validation helpers if validation grows

If the implementation stays in one module temporarily, keep the same internal boundaries with small pure helper functions before splitting files. Do not add more inline page templates.

### Frontend Modules

Add a small public page area:

- `src/pages/PublicNotePage.jsx`
- `src/pages/PublicBucketPage.jsx`
- `src/pages/PublicCollectionPage.jsx`
- `src/hooks/usePublicPageData.js`
- `src/components/public/PublicMarkdown.jsx`
- `src/components/public/PublicHeadingOutline.jsx`
- `src/components/public/PublicNoteCard.jsx`
- `src/utils/publicContent.js`

Exact paths can change to match repo conventions, but the boundaries should remain clear:

- pages coordinate data loading and route params
- components render UI
- utilities transform content
- hooks own fetch state

## Public JSON APIs

Add read-only APIs for the public pages:

### `GET /api/public-pages/n/:slug`

Response:

```json
{
  "kind": "note",
  "slug": "abc123",
  "publishedAt": 1710000000000,
  "note": {
    "id": "note-1",
    "content": "# Title\nBody",
    "categories": [],
    "updatedAt": 1710000000000,
    "viewMode": "markdown"
  }
}
```

### `GET /api/public-pages/b/:bucket`

Response:

```json
{
  "kind": "bucket",
  "bucket": {
    "bucketName": "example",
    "ownerLabel": "user@example.com"
  },
  "collections": [],
  "directNotes": []
}
```

### `GET /api/public-pages/b/:bucket/:collectionSlug`

Response:

```json
{
  "kind": "collection",
  "bucket": {
    "bucketName": "example",
    "ownerLabel": "user@example.com"
  },
  "collection": {
    "id": "collection-1",
    "slug": "projects",
    "name": "Projects",
    "description": "",
    "updatedAt": 1710000000000,
    "noteCount": 3
  },
  "notes": []
}
```

These endpoints should return JSON errors, not HTML error pages.

## Routing Strategy

1. Add public JSON APIs while leaving current `/n` and `/b` HTML routes in place.
2. Add frontend route detection for `/n/:slug`, `/b/:bucket`, and `/b/:bucket/:collectionSlug`.
3. Change Express route handling so `/n` and `/b` requests fall through to `dist/index.html`.
4. Keep API routes registered before `express.static` fallback behavior.
5. Remove old inline HTML render functions only after frontend pages pass parity tests.

Because `registerSpaFallback` already serves `dist/index.html` for unknown non-file paths, the final server behavior should not need custom HTML responses for public pages.

## SOLID Application

### Single Responsibility

- Store helpers fetch public data only.
- Serializer helpers normalize response shapes only.
- Route handlers validate input, call store/serializer helpers, and send responses.
- Frontend pages load data and select page states.
- Frontend components render public content only.

### Open/Closed

Adding another public page type should require adding a new route/component, not editing a large server template string. Shared serializers and frontend content components should be reusable without modifying existing page internals.

### Liskov Substitution

File-backed and Postgres-backed stores should satisfy the same public data contract. Callers should not need to branch on storage type after calling the store layer.

### Interface Segregation

Management APIs and public read APIs should stay separate. Public page clients should not receive management-only fields, and authenticated management components should not depend on public page response shapes unless intentionally shared through serializers.

### Dependency Inversion

Route registration should depend on public sharing store functions passed or constructed at module setup time, not on page-rendering helpers. Frontend pages should depend on fetch helpers/hooks, not on server implementation details.

## DRY Standards

Shared logic should have one owner:

- slug validation: server validation helper
- bucket owner lookup: store helper
- collection slug normalization: shared existing utility or server/client equivalents with tests
- note title/preview extraction: shared frontend utility for page rendering and cards
- markdown image marker stripping: shared content utility
- diagram rendering: shared component/utility
- heading extraction: shared frontend utility used by note pages and outline components

Avoid these duplications:

- separate Postgres and file-backed response mapping code with divergent field names
- separate markdown renderers for note page cards and collection cards
- copying public page fetch logic into each page component
- reimplementing public URL construction in many components

## Implementation Steps

### Phase 1: Prepare Server Data Boundaries

1. Add public sharing store helpers that return normalized domain objects for:
   - public note by slug
   - bucket owner by bucket name
   - public collections for bucket
   - public collection notes
   - direct public notes for bucket
2. Keep file-backed fallback support.
3. Add serializers for public page API responses.
4. Add tests around serializers so storage-specific rows cannot leak into API responses.

### Phase 2: Add Public Page APIs

1. Add `GET /api/public-pages/n/:slug`.
2. Add `GET /api/public-pages/b/:bucket`.
3. Add `GET /api/public-pages/b/:bucket/:collectionSlug`.
4. Use `sendJsonError` for missing records and database failures.
5. Test success and not-found cases.

### Phase 3: Build Frontend Public Pages

1. Add a route discriminator near the frontend composition boundary that detects `/n` and `/b` paths.
2. Render public pages outside the authenticated app shell when a public route is active.
3. Add a public page data hook with loading, error, and not-found states.
4. Add public note, bucket, and collection page components.
5. Extract shared markdown/card/heading behavior.

### Phase 4: Switch Page Serving

1. Remove or bypass server HTML handlers for `/n/:slug`, `/b/:bucket`, and `/b/:bucket/:collectionSlug`.
2. Confirm Express serves `dist/index.html` for those routes.
3. Keep old API management endpoints unchanged.
4. Verify existing public links still open.

### Phase 5: Delete Inline Rendering

Remove server-only page rendering helpers once the frontend pages are verified:

- `renderBucketPage`
- `renderPublicBucketIndexPage`
- `renderPublicCollectionPage`
- `renderPublicNotePage`
- inline public page scripts/styles

Keep only small server utilities that are still needed for data extraction or API responses.

### Phase 6: Update Documentation

Update:

- `docs/SERVER_GUIDE.md`: public sharing no longer renders inline HTML
- `docs/FRONTEND_GUIDE.md`: public pages are frontend-owned routes
- `docs/LLM_GUIDE.md`: public sharing requires checking JSON APIs and frontend public routes

## Testing Plan

### Server Tests

Add or extend `test/public-sharing.test.js`:

- publish still returns `/n/:slug`
- listing shared links still works
- deleting shared links still works
- public note page API returns normalized note data
- missing public note page API returns JSON 404
- public bucket page API returns collections and direct notes
- missing bucket returns JSON 404
- public collection page API returns normalized collection notes
- missing collection returns JSON 404

### Frontend/Build Checks

Run:

- `npm test`
- `npm run build`
- `node --check server.js`

Manual smoke checks:

- open an existing `/n/:slug`
- open `/b/:bucket`
- open `/b/:bucket/:collectionSlug`
- publish a note and open the copied link
- make a collection public and open its bucket URL
- verify direct public notes still appear under the bucket page

## Migration Safety

Use an additive migration path:

1. Add APIs.
2. Add frontend pages.
3. switch routes.
4. remove inline renderers.

Do not delete old server renderers before the frontend public pages can load all existing public page data. This keeps rollback simple: the old HTML routes can remain active until parity is confirmed.

## Open Questions

- Should public pages use the exact same markdown renderer as private note previews, or a smaller public-only renderer?
- Should SEO/social metadata be generated server-side later, or is client-rendered public content acceptable for now?
- Should `/api/public-note/:slug` be kept as-is indefinitely, or aliased internally to the new public page note endpoint?
- Should legacy file-backed `buckets.json` continue to support old bucket shape after the migration, or can it be normalized by a startup adapter?
