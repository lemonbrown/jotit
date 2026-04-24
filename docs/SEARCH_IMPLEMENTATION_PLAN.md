# Search Implementation Plan

This document captures a concrete plan for making global search first-class in JotIt.

It is written with one strong product assumption:

- JotIt is primarily a developer notes and scratchpad tool.

That means search should optimize for developer-shaped data:

- API keys and tokens
- cloud credentials
- commands and scripts
- logs and error traces
- URLs and endpoints
- environment variables
- config fragments
- code snippets
- database connection details
- infra notes
- temporary debugging notes

The retrieval strategy should reflect that. A generic semantic search system is not enough.

## Status tracker

Current milestone:

- Phase 8: small-model reranking (optional, only after retrieval is strong)

Implementation status:

- Completed: wrote the implementation plan and developer-focused matching inventory
- Completed: local chunk extraction, local entity extraction, local SQLite search artifacts, hybrid lexical/entity ranking, structured note-match results, chunk-semantic retrieval, seeded developer benchmark notes
- Completed: tuned query-understanding weights and expansions; expanded provider/tool/DB/debug coverage; added GCP, MySQL, Terraform seed notes and benchmark queries; added credential preview redaction utility; decided preview redaction applies at the UI render layer (not in search core) to preserve test transparency
- Not started: dedicated chunk-result UX, Postgres parity, server search endpoint, small-model reranking

Task checklist:

- [x] Define the search direction and storage model
- [x] Capture developer-oriented keywords, aliases, and entity classes
- [x] Add progress tracking to this document
- [x] Add local chunking utilities
- [x] Add local entity extraction utilities
- [x] Add local SQLite tables for chunk/entity/metadata search artifacts
- [x] Re-index notes locally on mutation and startup backfill
- [x] Upgrade local search to use chunk/entity/metadata signals
- [x] Return structured note matches with chunk previews and match reasons
- [x] Surface search context in note cards without changing the overall note-grid UX
- [x] Persist server-side chunk embeddings for signed-in search
- [x] Use chunk embeddings during search as a semantic retrieval stage
- [x] Add a structured query-understanding module for normalization, alias expansion, intents, and boosts
- [x] Tune query-understanding weights and expansions against the seeded benchmark corpus
- [x] Add chunk-aware result rendering in the UI
- [x] Mirror search artifacts to Postgres
- [x] Add a server-side search endpoint
- [ ] Add small-model reranking

Completed tasks:

- Defined the search architecture around local-first SQLite plus future Postgres parity.
- Documented a developer-focused keyword, alias, and entity inventory for retrieval.
- Added task/progress tracking to this plan.
- Added local note chunking for headings, code blocks, commands, config-like sections, and logs.
- Added local entity extraction for developer-heavy signals such as env vars, URLs, API-key-like strings, JWT-like strings, provider terms, commands, and ports.
- Added browser SQLite persistence for `note_chunks`, `note_entities`, and `search_metadata`.
- Added local search indexing on note mutation and startup backfill.
- Upgraded search to use note text, chunk text, section titles, entity hits, and metadata instead of only raw note substring matching.
- Added structured search results with previews, match reasons, section metadata, and semantic fallback merging.
- Surfaced chunk-derived previews and match reasons in the existing note-card UI.
- Added server-side chunk embedding generation and chunk-semantic retrieval for signed-in search.
- Added a seeded developer-note corpus for benchmarking realistic searches.
- Added a dedicated query-understanding module for developer-oriented query normalization, provider alias expansion, intent detection, facet inference, and entity-type boosts.
- Added benchmark-style retrieval tests against the seeded developer corpus so ranking changes can be tuned with explicit expected top matches.
- Expanded query-understanding coverage for GitHub/CI language, JWT/auth debugging language, and Kubernetes/staging ops commands.
- Expanded PROVIDER_ALIASES to cover mysql, postgresql, mongodb, terraform, and gitlab.
- Expanded TERM_EXPANSIONS to cover secret, vault, connection, deploy, cluster, login, rotate, refused, and crash.
- Added GCP service account, MySQL RDS connection, and Terraform staging state notes to the developer seed corpus.
- Extended benchmark to 11 queries covering all new seed notes; all pass.
- Added `redactCredentialPreview` utility (exported from searchCore) for UI-layer masking of token-like strings; decided redaction belongs at render time, not in the search core, to keep test results transparent.
- Benchmark now runs 18 automated tests; all pass.
- NoteCard now renders chunk kind (code/config/command/log) as an inline badge on the heading line, entity type pills (env var, api key, jwt, cloud, etc.) instead of generic "N entity hits", a "≈ semantic" indicator for semantic and hybrid-semantic matches, and applies redactCredentialPreview to search previews at render time.
- Added Postgres tables for note_chunks, note_entities, and search_metadata (with user_id for multi-tenant isolation) plus indexes on (user_id, note_id).
- Added POST /api/sync/artifacts route that replaced all artifacts for a note in Postgres (delete-then-insert, client-authoritative).
- Cascade-deletes artifacts in Postgres when a note is pushed as deleted via POST /api/sync/push.
- Retired the old client-authoritative `/api/sync/artifacts` path after moving signed-in indexing to the backend sync flow.
- Test count: 18 → 21.
- Added GET /api/search?q=&limit= endpoint in server/search.js. Uses understandQuery for term expansion, broad ILIKE ANY recall across notes + artifacts in Postgres, then runs the same searchNotesWithArtifacts scoring used locally. Shares query understanding and scoring logic with the client via direct ES module imports (no duplication). Returns structured results: noteId, score, matchType, matchedSectionTitle, matchedChunkKind, preview, reasons, entityHits, note. Registered in server.js alongside sync routes. Test count: 21 → 26.

Current tasks:

- Add small-model reranking (Phase 8).

Upcoming tasks:

- Add a dedicated chunk-aware search result UX instead of only note cards with match context.
- Implement explicit query normalization, alias expansion, and intent/facet boosting.
- Postgres search-index parity and server-side regeneration are now in place for signed-in flows.
- Add a server-side `/api/search` endpoint.
- Add optional small-model reranking after retrieval is strong.

## Findings and changes

- The current local search UI still expects a plain ordered array of notes, not chunk-aware result objects.
- Because of that, the first implementation slice upgrades ranking quality without changing the result contract yet.
- The browser SQLite schema previously only stored `notes` and `snippets`, so search artifacts need to be explicitly persisted or the app falls back to scanning raw note bodies.
- A local-first index is the right first implementation boundary because it improves offline behavior and does not require sync protocol changes yet.
- Developer-note search needs exact-ish matching help in addition to embeddings. Tokens, env vars, hostnames, provider names, commands, and connection strings are too important to leave to vector search alone.

Implementation notes from the current slice:

- Added local note chunking utilities for developer-shaped note content such as headings, fenced code blocks, config-like sections, commands, and logs.
- Added local entity extraction for URLs, env vars, API-key-like strings, JWT-like strings, cloud-provider terms, commands, ports, file paths, and other developer-heavy signals.
- Added browser SQLite tables for `note_chunks`, `note_entities`, and `search_metadata`.
- Note mutations and startup lifecycle now keep the local search index refreshed.
- Local search ranking now considers note content, chunk content, section titles, entities, and metadata instead of only note body/category substring matches.
- Search now returns structured note-match objects internally, including preview text, matched section title, match type, entity hits, and short reasons.
- The current UI still renders note cards, but those cards now show chunk-derived preview text and match reasons so ranking is less opaque.
- Chunk embeddings are now generated on the server for signed-in users and used as a semantic retrieval stage before note-level semantic fallback.
- Query understanding now runs before retrieval so vague developer queries can expand aliases, infer intent, and boost facets/entity classes before scoring.
- Ranking weights now distinguish original query terms from expanded terms so provider-specific queries like `postgres password staging` do not get overtaken by more generic credential matches.
- Benchmark queries now cover Azure auth, Postgres staging, Docker local env, AWS role lookup, Redis prod host, GitHub/npm publish tokens, JWT debugging, and Kubernetes restart commands.
- Validation currently passes with `npm test` and `npm run build`.

## Questions and decisions to consider

- Chunk result UX: when the search UI is upgraded, should the primary result row be the note or the matching chunk?
- Search preview safety: for credential-heavy notes, should previews redact token-like strings before rendering result cards?
- Sensitive-data handling: do we want to mask or partially redact credential-like previews in future search results?
- Embedding freshness: is it acceptable that server-side chunk embeddings are regenerated asynchronously after synced note edits, with a short window where only lexical/entity search is current?
- Sync strategy: should Postgres trust client-generated search artifacts, or should the server regenerate them after sync for consistency?
- Embedding scope: server-side generation now owns synced user embeddings; guest and offline flows stay lexical/local.
- Remote search contract: should `/api/search` return note-grouped results, chunk results, or both?

## Search goal

Users should be able to enter vague queries like:

- `api token for azure`
- `postgres password for staging`
- `jwt middleware bug`
- `docker env for local api`
- `s3 bucket write role`

And get strong results from hundreds or thousands of notes without needing exact text matches.

## Current architecture constraints

JotIt currently uses:

- browser SQLite for local-first storage
- Postgres as remote/cloud sync storage
- local note/snippet persistence
- optional embedding and semantic search functionality

Search should therefore be designed as a dual-storage system:

- local SQLite is the immediate search/index store
- Postgres is the mirrored remote search/index store
- both should share one logical search model

## Product direction

Global search should become its own indexed subsystem, not just a text filter.

Target system:

1. Query understanding
2. Hybrid retrieval
3. Re-ranking
4. Explainable results

Results should be based on:

- lexical matching
- chunk-level embeddings
- note-level embeddings
- extracted entities
- inferred categories/facets
- optional small-model reranking

## Why note-level embeddings are not enough

Whole-note embeddings are too coarse once notes become long or mixed-topic.

Example:

- one note may contain an Azure token
- a curl example
- a troubleshooting log
- unrelated TODO text

Searching the entire note as one vector loses precision.

The system should index:

- note-level embeddings for broad recall
- chunk-level embeddings for precision

## Proposed indexed entities

These logical entities should exist in both local SQLite and remote Postgres.

### `notes`

Already exists. Remains the canonical note object.

### `note_chunks`

Suggested fields:

- `id`
- `note_id`
- `content`
- `kind`
- `section_title`
- `start_offset`
- `end_offset`
- `created_at`
- `updated_at`

`kind` should distinguish things like:

- prose
- code
- command
- config
- log
- table
- credential

### `note_chunk_embeddings`

Suggested fields:

- `chunk_id`
- `note_id`
- `user_id`
- `embedding`
- `model`
- `updated_at`

### `note_entities`

Suggested fields:

- `id`
- `note_id`
- `chunk_id`
- `entity_type`
- `entity_value`
- `normalized_value`

### `search_metadata`

Suggested fields:

- `note_id`
- `keywords`
- `facets`
- `last_indexed_at`

## Chunking strategy

Chunking should be developer-aware.

Preferred boundaries:

- markdown headings
- blank-line section boundaries
- fenced code blocks
- tables / CSV-like blocks
- bullet groups
- capped token windows for large sections

Chunking rules:

- preserve code blocks as units when possible
- preserve config blocks as units when possible
- preserve commands with surrounding labels when possible
- keep offsets so UI can restore/highlight later

## Entity extraction

Entity extraction is critical because developer notes often contain high-value exact identifiers that embedding-only systems miss.

Initial entity types:

- `url`
- `hostname`
- `ip`
- `port`
- `email`
- `env_var`
- `file_path`
- `api_key_like`
- `jwt_like`
- `uuid`
- `cloud_resource`
- `docker_image`
- `k8s_resource`
- `sql_identifier`
- `http_method`
- `status_code`
- `command`

Developer-specific examples worth detecting:

- `AZURE_TENANT_ID`
- `DATABASE_URL`
- `Bearer eyJ...`
- `ghp_...`
- `sk-proj-...`
- `postgres://...`
- `docker compose up`
- `kubectl get pods`
- `terraform apply`

## Query understanding layer

Before retrieval, a query should be normalized and enriched.

Output shape should include:

- `normalizedQuery`
- `expandedTerms`
- `intent`
- `facets`
- `entityTypesToBoost`
- `providerHints`

Initial implementation should be rules-first.

Later:

- add a small model for rewrite/classification/rerank

## Hybrid retrieval pipeline

Search should use a cascade.

### Stage 1: broad recall

Retrieve candidates from:

- lexical note search
- lexical chunk search
- note vector search
- chunk vector search
- entity match search
- category/facet matches

### Stage 2: merge and dedupe

Merge candidates by:

- `noteId`
- `chunkId`

### Stage 3: ranking

Combine signals:

- lexical exactness
- fuzzy lexical relevance
- note vector score
- chunk vector score
- entity boosts
- category/facet alignment
- recency and update time
- optional future access-frequency boost

### Stage 4: rerank

Optional small-model reranking on top 20-50 candidates only.

Use the small model for:

- query rewrite
- intent classification
- reranking
- short match explanations

Do not use it for first-pass retrieval across the full corpus.

## Result model

Results should not just return notes. They should return reasons.

Suggested result shape:

- `noteId`
- `chunkId`
- `score`
- `title`
- `preview`
- `reasons`
- `matchType`
- `entityHits`
- `categories`

Possible reasons:

- contains exact term
- semantic chunk match
- matched cloud provider alias
- contains token-like string
- categorized as credentials
- matching section heading

## Local vs remote search strategy

### Browser SQLite

Should provide:

- offline indexing
- immediate chunk updates
- immediate entity updates
- immediate hybrid search

### Postgres

Should provide:

- mirrored search artifacts
- cross-device continuity
- centralized search endpoint
- future server-side ranking

### Recommendation

Keep local search fully useful on its own.

Do not make remote/cloud search mandatory for quality.

Postgres should extend consistency and scale, not replace local search.

## Implementation phases

## Phase 0: define the schema

Create a shared logical search model for:

- note chunks
- note chunk embeddings
- note entities
- search metadata

## Phase 1: local chunk/entity indexing

Files likely involved:

- `src/utils/db.js`
- `src/hooks/useAppLifecycle.js`
- `src/hooks/useNoteMutations.js`
- new `src/utils/chunking.js`
- new `src/utils/entities.js`
- new `src/utils/searchIndex.js`

Tasks:

- add chunk tables/structures in browser SQLite
- add chunk extraction
- add entity extraction
- re-index when note content changes
- backfill old notes on lifecycle startup

## Phase 2: server-backed chunk embeddings

Tasks:

- embed chunks, not only notes
- persist server-side chunk embeddings
- re-embed changed chunks on mutation
- keep note embeddings as broad-recall signals

## Phase 3: unified hybrid local search

New module:

- `src/utils/globalSearch.js`

Tasks:

- lexical chunk retrieval
- lexical note retrieval
- note vector retrieval
- chunk vector retrieval
- entity boost retrieval
- merge and rank
- return chunk-aware results

## Phase 4: query understanding

New module:

- `src/utils/queryUnderstanding.js`

Tasks:

- normalize query
- expand provider aliases
- infer developer-oriented intent
- assign boosts/facets

## Phase 5: search UI becomes first-class

Likely files:

- `src/App.jsx`
- `src/hooks/useNoteSearch.js`
- `src/components/SearchBar.jsx`
- new `src/components/GlobalSearchPanel.jsx`

Tasks:

- dedicated result schema
- chunk previews
- result reasons
- grouped results
- optional filters/facets

## Phase 6: Postgres parity

Server side likely files:

- `server/sync.js`
- new `server/searchIndex.js`

Tasks:

- add Postgres chunk/entity/index tables
- decide whether server regenerates or trusts client-generated artifacts
- mirror search artifacts into cloud DB

Recommendation:

- client generates local artifacts immediately
- server can later regenerate/verify for consistency

## Phase 7: server search endpoint

Possible route:

- `/api/search`

Tasks:

- query Postgres index
- retrieve note/chunk/entity candidates
- rank and return explainable results

## Phase 8: small-model reranking

Only after retrieval is strong.

Use for:

- vague query expansion
- intent classification
- top-k reranking
- concise result explanations

## Scoring model

Initial weighted score should combine:

- exact keyword hit
- fuzzy lexical hit
- chunk vector similarity
- note vector similarity
- entity-type boost
- provider alias boost
- category/facet boost
- recency/update-time boost

Later optional boosts:

- click/open feedback
- copy/use feedback
- per-user alias learning

## Developer-specific keyword and alias inventory

This system should be intentionally biased toward developer notes.

The following terms should be considered for rule-based expansion, categorization, and boosting.

### Credentials and secrets

- api key
- key
- token
- bearer
- auth token
- access token
- refresh token
- secret
- client secret
- password
- passphrase
- credential
- credentials
- private key
- ssh key
- cert
- certificate
- jwt
- pat
- session token

### Cloud providers

#### Azure

- azure
- entra
- aad
- azure ad
- microsoft
- tenant
- client id
- subscription
- resource group
- key vault
- app registration
- managed identity
- storage account
- service principal

#### AWS

- aws
- iam
- sts
- access key
- secret access key
- session token
- s3
- lambda
- ecs
- ecr
- ec2
- rds
- cloudwatch
- route53
- secrets manager
- parameter store
- role arn

#### GCP

- gcp
- google cloud
- service account
- gke
- gcr
- artifact registry
- pubsub
- cloud run
- bigquery
- project id

### Databases

- postgres
- postgresql
- pg
- mysql
- mariadb
- sqlite
- mssql
- sql server
- redis
- mongodb
- elasticsearch
- opensearch
- connection string
- database url
- db host
- db user
- db password

### Containers and infra

- docker
- docker compose
- compose
- image
- container
- kubernetes
- k8s
- kubectl
- helm
- ingress
- deployment
- pod
- service
- namespace
- terraform
- tf
- ansible

### APIs and HTTP

- api
- endpoint
- rest
- graphql
- webhook
- callback
- postman
- curl
- fetch
- request
- response
- header
- authorization
- content-type
- bearer
- oauth
- oidc
- openid
- status code
- 401
- 403
- 404
- 500

### Dev tools and source control

- git
- github
- gitlab
- bitbucket
- gh
- branch
- commit
- workflow
- ci
- cd
- pipeline
- action
- runner

### Languages and runtime

- javascript
- typescript
- node
- react
- vite
- python
- dotnet
- csharp
- java
- go
- rust
- bash
- powershell
- shell

### Config and runtime env

- env
- environment
- config
- settings
- secret
- local
- dev
- test
- qa
- stage
- staging
- prod
- production
- sandbox
- connection
- host
- port
- base url

### Logging and debugging

- log
- logs
- stacktrace
- trace
- exception
- error
- warning
- debug
- repro
- incident
- timeout
- refused
- unauthorized
- forbidden
- crash

### Commands and ops

- command
- cli
- script
- alias
- npm
- yarn
- pnpm
- pip
- dotnet
- cargo
- make
- task
- kubectl
- docker compose
- ssh
- scp
- rsync

## Entity and pattern classes worth detecting

These should be treated as searchable signals, not only raw text:

- `ghp_...`
- `sk-...`
- `sk-proj-...`
- JWT-like `eyJ...`
- UUIDs
- connection strings
- URLs
- IP addresses
- port references
- env var names
- hostnames
- tenant IDs
- client IDs
- subscription IDs
- ARNs
- docker image names
- k8s resource names
- file paths
- stacktrace signatures

## Recommended first implementation slice

If building incrementally, do this first:

1. Add chunk extraction utilities.
2. Add entity extraction utilities.
3. Add chunk/entity persistence in browser SQLite.
4. Add server-backed chunk embeddings.
5. Replace current note search with hybrid local retrieval.
6. Add query expansion for developer/cloud/auth terms.

That should already improve vague queries substantially.

Status:

- Completed in the current codebase except for dedicated chunk-result UX, explicit query-understanding rules, and remote/cloud parity.

## Success criteria

The first meaningful milestone should make these queries work well:

- `api token for azure`
- `postgres password staging`
- `docker env local api`
- `jwt auth middleware`
- `aws s3 write role`
- `redis host for prod`

Strong results should:

- return the right note even when wording differs
- return the matching chunk/section, not only the note
- surface explanation metadata
- work offline from local browser SQLite

## Validation plan

When building this system:

- add tests around chunking
- add tests around entity extraction
- add tests around scoring/ranking merges
- add tests around query expansion
- smoke-test with a seeded corpus of real developer-note patterns

## Final recommendation

Do not start with the small model.

Start with:

- chunking
- entities
- hybrid retrieval
- developer-specific query expansion

Then add a small-model reranker once the retrieval base is strong.
