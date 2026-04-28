# Local LLM Embeddings Plan

Replace OpenAI `text-embedding-3-small` with a locally-running Ollama embedding model.
No schema migration required — embeddings are stored as JSON text, and cosine similarity is computed in JS.

## Configuration

| Env var | Values | Default | Purpose |
|---|---|---|---|
| `EMBEDDING_PROVIDER` | `openai` \| `ollama` | `openai` | Which provider generates embeddings |
| `OLLAMA_EMBED_MODEL` | any Ollama embed model | `nomic-embed-text` | Model used when provider is `ollama` |
| `OLLAMA_BASE_URL` | URL | `http://localhost:11434` | Already used by agent for chat |

When `EMBEDDING_PROVIDER=ollama` the server calls the jotit-agent's `/ollama/embed` endpoint
(authenticated via `JOTIT_AGENT_TOKEN`), which proxies to Ollama's `POST /api/embed`.
The agent must be running; if it is unavailable embeddings are skipped and search gracefully
degrades to lexical-only (existing behaviour for missing embeddings).

## Recommended models

| Model | Dimensions | Notes |
|---|---|---|
| `nomic-embed-text` | 768 | Best balance, most popular — **default** |
| `mxbai-embed-large` | 1024 | Higher quality, slower |
| `snowflake-arctic-embed` | 1024 | Strong retrieval quality |
| `all-minilm` | 384 | Fastest, lowest quality |

## Tasks

- [x] Create this plan document
- [x] Add `POST /ollama/embed` endpoint to `agent/src/server.js`
- [x] Update `server/ai.js` — `createAiService` accepts `embeddingProvider` option; routes embed calls to Ollama when configured
- [x] Update `server/indexing.js` — record correct model name (`nomic-embed-text` etc.) instead of hardcoded `text-embedding-3-small`
- [x] Add `GET /api/ai/config` + `POST /api/ai/config` endpoints — config persisted to `ai-config.json` alongside other server config files
- [x] Add `handleLoadAiConfig` / `handleSaveAiConfig` callbacks in `src/App.jsx`
- [x] Add "Embeddings provider" toggle + model input to Settings UI (`src/components/Settings.jsx`)

## Out of scope (this plan)

- Backfilling existing note embeddings — run `/api/ai/reindex` from Settings after switching provider
