# Local LLM Integration Plan

This document defines the implementation plan for integrating local LLM providers (starting with Ollama) into JotIt, giving users the ability to query a locally-running model with their note content as context.

---

## Goal

Allow users running a local LLM (e.g. [Ollama](https://ollama.com)) to open a chat panel inside JotIt and ask questions about their current note. The LLM receives the note content as context and streams a response back in real time.

---

## Core Decision

Route all Ollama communication through the **jotit-agent** (port 3210), not the main jotit server.

The main server may be running remotely (cloud-hosted). Ollama runs on the user's local machine. The jotit-agent already runs locally, already has CORS open for browser calls, and is already the established bridge for local machine capabilities (shell execution, HTTP proxying). Local LLM access belongs in the same category.

```
Browser (React) → http://localhost:3210/ollama/* (jotit-agent) → Ollama (11434)
```

The main jotit server is not involved in LLM calls.

---

## Why This Direction

| Concern | Via main server | Via jotit-agent |
|---|---|---|
| Works when jotit is cloud-hosted | No — server can't reach user's localhost | Yes |
| Works when jotit is self-hosted | Yes | Yes |
| Note content leaves user's machine | Yes (sent to cloud server) | No (stays localhost) |
| Consistent with existing local patterns | No | Yes (mirrors ShellRunner, HttpRunner) |
| CORS already handled | Requires proxy setup | Already configured |

---

## Scope (Phase 1)

- Context: current open note only (full content sent as system prompt context)
- Streaming responses from day one
- Floating overlay chat UI
- Model selection persisted in localStorage
- No RAG, no multi-note search, no token counting

---

## Architecture

### jotit-agent changes (`agent/src/server.js`)

Three new endpoints, all behind the existing bearer token guard:

#### `GET /ollama/status`
Pings Ollama at the configured base URL. Returns availability and the URL being used.

```json
{ "available": true, "baseUrl": "http://localhost:11434" }
```

#### `GET /ollama/models`
Proxies Ollama's `GET /api/tags`. Returns the list of locally installed models.

```json
{ "models": [{ "name": "llama3.2", "size": 2000000000 }] }
```

#### `POST /ollama/chat`
Receives `{ model, messages, noteContent }` from the browser.

Assembles a system prompt on the agent (note content never touches the cloud server):

```
You are a helpful assistant. The user is working on a note.

Note:
---
{noteContent}
---

Answer questions about this note concisely. If the note doesn't contain relevant information, say so.
```

Calls Ollama's `POST /api/chat` with `"stream": true`, pipes the NDJSON stream back to the browser as `text/event-stream` (SSE).

Each SSE event:
```
data: {"token": "Hello"}\n\n
```
Terminated with:
```
data: [DONE]\n\n
```

---

### Frontend new files

#### `src/utils/llmClient.js`
Single module for all LLM-related fetch calls (DRY — no component touches raw fetch for LLM).

```js
getLLMStatus()          // GET /ollama/status via jotit-agent
getLLMModels()          // GET /ollama/models via jotit-agent
streamLLMChat(params, onChunk, onDone, onError)  // POST /ollama/chat, reads SSE stream
```

Reads the agent base URL and token from localStorage (same keys already used by ShellRunner / HttpRunner).

#### `src/hooks/useLLMSettings.js`
Thin hook over localStorage. Exposes:

```js
{ ollamaModel, setOllamaModel, llmEnabled, setLLMEnabled }
```

#### `src/hooks/useLLMChat.js`
Chat session state. Exposes:

```js
{
  messages,        // [{ role: 'user'|'assistant', content: string }]
  isStreaming,     // bool
  sendMessage(text, noteContent),
  clear(),
}
```

`sendMessage` appends the user message, calls `streamLLMChat`, and accumulates token chunks into the tail assistant message in state as they arrive.

#### `src/components/LLMChat.jsx`
Floating overlay panel. Behaviour:

- Triggered by an "Ask AI" button added to the NotePanel toolbar
- Positioned bottom-right, draggable (or fixed), dismissible with Escape
- Header shows: model name + note title as active context indicator
- Message thread with user/assistant bubbles
- Streaming assistant response renders tokens as they arrive, with a blinking cursor while streaming
- Input field disabled while streaming
- "Clear" button resets the session

---

### Frontend modified files

#### `src/components/NotePanel.jsx`
Add a small "Ask AI" button to the existing toolbar row. Clicking it toggles the `LLMChat` overlay. Only visible when `llmEnabled` is true and the jotit-agent is reachable.

#### `src/components/Settings.jsx`
Add a **Local LLM** section below the existing Local Agent section:

- Enable/disable toggle (`llmEnabled`)
- Model picker — dropdown populated from `GET /ollama/models` (gracefully empty with a "Ollama not reachable" message if unavailable)
- Status indicator (green/red dot) showing whether Ollama is currently reachable

No free-text Ollama URL field in settings — the agent handles the URL. If users need a non-default Ollama URL they set `OLLAMA_BASE_URL` in their environment.

---

## Data Flow (end to end)

```
1. User opens note, clicks "Ask AI"
2. LLMChat overlay opens
3. useLLMChat.sendMessage(userText, note.content) called
4. llmClient.streamLLMChat posts to http://localhost:3210/ollama/chat
   body: { model, messages, noteContent: note.content }
   Authorization: Bearer <agentToken>
5. jotit-agent assembles system prompt with noteContent
6. jotit-agent POST /api/chat → Ollama (stream: true)
7. Ollama streams NDJSON tokens back to agent
8. Agent converts each token to SSE event, flushes to browser
9. llmClient reads SSE stream, calls onChunk(token) per event
10. useLLMChat appends each token to the tail assistant message
11. LLMChat re-renders with each token — streaming effect
12. onDone() fires, isStreaming → false, input re-enabled
```

---

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `OLLAMA_BASE_URL` | jotit-agent env | `http://localhost:11434` | Ollama endpoint |
| `ollamaModel` | localStorage | first available model | Selected model |
| `llmEnabled` | localStorage | `false` | Feature on/off toggle |

---

## SOLID / DRY Principles Applied

| Principle | How |
|---|---|
| **Single Responsibility** | `llmClient.js` only handles fetch/stream. `useLLMChat` only manages chat state. `LLMChat.jsx` only renders UI. Agent endpoints only proxy. |
| **Open/Closed** | Adding a second provider (e.g. LM Studio) means adding a new agent endpoint — existing code untouched. |
| **Liskov Substitution** | Any SSE-streaming endpoint at `/ollama/chat` shape is interchangeable from the frontend's perspective. |
| **Interface Segregation** | `useLLMSettings` is separate from `useLLMChat` — components that only need settings don't pull in chat state. |
| **Dependency Inversion** | `useLLMChat` depends on `llmClient` (an abstraction), not directly on fetch. |
| **DRY** | All agent token/URL reading happens in one place (`llmClient.js`). All SSE parsing happens in one place. No component constructs prompts. |

---

## Tasks

- [x] **agent** — Add `OLLAMA_BASE_URL` env support with `http://localhost:11434` default
- [x] **agent** — Add `GET /ollama/status` endpoint
- [x] **agent** — Add `GET /ollama/models` endpoint
- [x] **agent** — Add `POST /ollama/chat` endpoint with SSE streaming
- [x] **frontend** — Create `src/utils/llmClient.js`
- [x] **frontend** — Create `src/hooks/useLLMSettings.js`
- [x] **frontend** — Create `src/hooks/useLLMChat.js`
- [x] **frontend** — Create `src/components/LLMChat.jsx` (floating overlay)
- [x] **frontend** — Add "Ask AI" button to `NotePanel.jsx` toolbar
- [x] **frontend** — Add Local LLM section to `Settings.jsx`

---

## Phase 2 additions

- [x] **Context modes** — Note / All notes / Selection switcher in chat overlay
- [x] **All notes context** — concatenates all notes up to 80k chars with truncation notice
- [x] **Ctrl+Shift+A hotkey** — toggles chat overlay from anywhere in the note panel

---

## Out of Scope (Phase 1)

- RAG / semantic search across multiple notes
- OpenAI or other remote LLM providers
- Token counting or context window budgeting
- Conversation persistence across sessions
- Inline AI commands (transform selected text, summarize, etc.)
- Image/attachment context
