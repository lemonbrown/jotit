# JotIt

JotIt is a local-first note app with a React/Vite frontend and a small Express server.

## Start here

For future LLMs, code agents, or maintainers, the most useful docs are:

- [LLM Guide](./docs/LLM_GUIDE.md)
- [Frontend Guide](./docs/FRONTEND_GUIDE.md)
- [Server Guide](./docs/SERVER_GUIDE.md)
- [Search Implementation Plan](./docs/SEARCH_IMPLEMENTATION_PLAN.md)
- [Server-Owned AI Migration Plan](./docs/SERVER_OWNED_AI_MIGRATION_PLAN.md)
- [OpenAPI Implementation Plan](./docs/OPENAPI_IMPLEMENTATION_PLAN.md)

## Project shape

- `src/`: frontend app, hooks, utilities, components
- `server/`: server modules split by responsibility
- `server.js`: server bootstrap/composition
- `test/`: lightweight in-repo tests
- `docs/`: architecture and reasoning guides

## Main entry points

- Frontend root: [`src/App.jsx`](./src/App.jsx)
- Server root: [`server.js`](./server.js)
- Frontend lifecycle hook: [`src/hooks/useAppLifecycle.js`](./src/hooks/useAppLifecycle.js)
- Frontend workspace hook: [`src/hooks/useNoteWorkspace.js`](./src/hooks/useNoteWorkspace.js)

## Commands

- `npm run dev`: start frontend dev server
- `npm run server`: start server only
- `npm run agent`: start the local `jotit-agent` side app for HTTP execution
- `npm run dev:full`: start frontend and server together
- `npm test`: run current automated tests
- `npm run build`: build frontend

## How to navigate changes

- If the change is mostly UI composition, start in `src/App.jsx`.
- If the change is frontend behavior, find the owning hook in `src/hooks/`.
- If the change is server behavior, find the matching module in `server/`.
- If you are unsure where logic belongs, read `docs/LLM_GUIDE.md` first.

## Current notable features

- Signed-in server-owned AI search with local guest fallback
- Local `jotit-agent` support for note-authored HTTP execution against localhost/private targets
- OpenAPI 3.x JSON import as a dedicated document type with operation browsing, temporary runner execution, and basic response validation
