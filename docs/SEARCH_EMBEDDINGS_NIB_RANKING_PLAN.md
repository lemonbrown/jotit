# Search Embeddings and Nib Ranking Plan

This document defines a staged plan for improving JotIt search rankings with deterministic ranking, server-side embeddings, and optional local Nib assistance.

## Goal

Improve search result quality while keeping search fast, explainable, and resilient when local LLMs are unavailable.

The key separation is:

- **Embeddings** improve retrieval and ranking.
- **Nib** helps interpret query intent and optionally rerank a small candidate set.
- **Nib should not scan all notes directly** or sit in the hot path for every keystroke.

## Current Direction

Use a three-stage search pipeline:

1. Fast lexical search
2. Embedding retrieval
3. Optional Nib-assisted query planning or reranking

Normal search should continue to work without Nib.

## Stage 1: Deterministic Ranking Improvements

Start by improving the existing lexical and semantic merge logic before adding heavier LLM behavior.

Create or extend a dedicated ranking module, for example:

```text
src/utils/searchRanker.js
```

The ranker should own final score calculation and ranking reasons.

Example scoring shape:

```text
final_score =
  lexical_score * 0.45
+ semantic_score * 0.35
+ title_match_boost
+ exact_phrase_boost
+ proximity_boost
+ recency_boost
+ collection_boost
+ entity_facet_boost
```

Useful boosts:

- Exact title match
- Exact phrase in title or content
- Query terms appearing near each other
- Matches in headings or the first paragraph
- Semantic chunk hit inside the same note
- Note type relevance, such as SQL, OpenAPI, HTTP, regex, SQLite, or diagram notes
- Collection match when search is scoped to a collection
- Recent edit boost, capped so old highly relevant notes can still win

Expected outcome:

- Better ranking even when local LLM is disabled
- Easier unit testing
- Clear ranking reasons that can be surfaced in UI

## Stage 2: Richer Query Understanding

Extend `src/utils/queryUnderstanding.js` before introducing Nib into ranking.

For a query like:

```text
oauth token refresh postgres bug
```

The query understanding layer should produce structured metadata:

```js
{
  intent: 'debug-issue',
  terms: ['oauth', 'token', 'refresh', 'postgres', 'bug'],
  synonyms: ['oidc', 'jwt', 'access token', 'database'],
  facets: ['auth', 'database', 'debug'],
  mustHave: [],
  shouldHave: ['error', 'exception', '401', 'connection']
}
```

Use this metadata to:

- Expand lexical search terms
- Weight facets and entities
- Choose better embedding query text
- Produce ranking explanations

Expected outcome:

- More relevant results for developer shorthand and related terminology
- A testable bridge between raw query text and ranking behavior

## Stage 3: Nib Query Planning

Add optional Nib query planning after deterministic query understanding is in place.

Implementation options:

- Add `contextMode: 'search'` to the existing `/ollama/chat` agent flow.
- Or create a small search-specific helper module that calls `streamLLMChat`.

Nib input should stay compact:

```text
User search query:
"find the note where I fixed the ollama cors issue"

Available facets:
auth, database, infra, api, debug, llm, regex, sqlite, openapi

Return JSON:
{
  "rewrittenQuery": "...",
  "synonyms": [],
  "facets": [],
  "intent": "...",
  "mustHave": [],
  "shouldHave": []
}
```

Validation requirements:

- Parse and validate JSON.
- Ignore unknown facets unless explicitly supported.
- Cap array sizes.
- Fall back to deterministic search if Nib fails, times out, or returns invalid JSON.

Triggering behavior:

- Normal search runs while typing.
- Nib query planning runs only after debounce or explicit user action.
- Prefer an explicit control at first, such as `Improve with Nib`.

Expected outcome:

- Nib improves ambiguous queries without making baseline search slow or fragile.

## Stage 4: Nib Reranking

Only add Nib reranking after lexical and embedding search have narrowed the result set.

Flow:

1. Lexical and semantic search return top candidates.
2. Deterministic ranker produces top 25.
3. Send compact candidate summaries to Nib.
4. Nib returns reordered IDs and short reasons.
5. UI applies the reorder if valid.

Candidate payload shape:

```js
[
  {
    id,
    title,
    collection,
    preview,
    matchedChunks,
    currentScore,
    reasons
  }
]
```

Guardrails:

- Nib cannot introduce new result IDs.
- Nib can only reorder the top candidate set.
- Cap candidate count and preview size.
- Cache by query plus candidate IDs.
- Fall back silently if Nib fails.

Expected outcome:

- Better ordering for ambiguous or natural-language queries.
- Still bounded, auditable, and fast enough for interactive use.

## UI Plan

Initial UI should stay restrained:

- Keep normal search as the default.
- Add an optional `Improve with Nib` action when local LLM is enabled.
- Show `AI-ranked` or similar only when Nib reranking was actually applied.
- Surface concise ranking reasons where useful.

Avoid making search feel like chat. Search should remain a search workflow.

## Architecture Boundaries

Keep responsibilities separated:

- `src/utils/queryUnderstanding.js`: intent, facets, synonyms, expanded query terms
- `src/utils/search.js` and `src/utils/searchCore.js`: lexical search and candidate discovery
- `server/search.js`: authenticated server-backed semantic search
- `src/utils/searchRanker.js`: final scoring, merge behavior, and ranking reasons
- `src/utils/llmClient.js`: frontend calls to local agent LLM endpoints
- `agent/src/server.js`: local Ollama bridge and Nib search prompts
- UI components: display search results, loading state, ranking mode, and reasons

## Testing Plan

Add focused ranking tests with seeded note corpora.

Test cases:

- Exact title match beats loose semantic match.
- Exact phrase beats scattered term matches.
- Semantic chunk hit can lift a note with weak lexical overlap.
- Recency boost does not beat a clearly more relevant old note.
- Collection-scoped search does not leak unrelated collection results.
- Query understanding expands developer aliases correctly.
- Nib query planning invalid JSON falls back safely.
- Nib reranking cannot add unknown result IDs.
- Nib reranking timeout preserves deterministic order.

## Recommended Implementation Order

1. `done` Add `searchRanker.js` and move final scoring into it.
2. `done` Add ranking tests with a seeded corpus.
3. `done` Extend `queryUnderstanding.js` with richer structured metadata.
4. `done` Improve semantic plus lexical merge using the structured query.
5. `done` Add optional Nib query planning.
6. `done` Add optional Nib reranking for top results.
7. `done` Add UI affordances for `Improve with Nib` and ranking reasons.

## Implementation Progress

- `done` Created `src/utils/searchRanker.js` as the single deterministic scoring module.
- `done` Added title, exact phrase, proximity, recency, should-have, and must-have ranking signals.
- `done` Kept search explanations attached to ranked results through `reasons`.
- `done` Extended `src/utils/queryUnderstanding.js` with `phrases`, `synonyms`, `mustHave`, and `shouldHave`.
- `done` Preserved server-owned embedding search and carried semantic note similarity into merged result scores.
- `done` Added `src/utils/searchNib.js` for validated Nib query planning and bounded top-result reranking.
- `done` Added `contextMode: search` and `contextMode: search-rerank` prompts in `agent/src/server.js`.
- `done` Added an explicit `Nib` search-bar action that reranks existing top results without slowing normal search.
- `done` Added tests for structured query metadata, exact title ranking, must-have terms, and Nib plan validation.

## Remaining Follow-Ups

- `todo` Add server-side support for accepting a validated Nib search plan as an optional `/api/search` parameter.
- `todo` Add cache keys for Nib reranking by query plus candidate IDs.
- `todo` Add UI copy or tooltip that distinguishes deterministic smart search from Nib-reranked search.
- `todo` Add timeout-specific tests for Nib reranking fallback behavior.

## Non-Goals

- Do not use Nib to scan every note directly.
- Do not require Nib for normal search.
- Do not send full note content for all notes to Nib.
- Do not make every keystroke wait on a local LLM call.
- Do not let Nib introduce results that were not retrieved by search.
