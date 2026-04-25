# HTTP Execution Side App Plan

This document defines the implementation plan for running note-authored HTTP requests through a user-installed local side app instead of requiring the main JotIt backend to run locally.

## Goal

Allow users to execute supported HTTP requests written in notes against:

- public APIs
- `localhost`
- private-network targets
- Docker-exposed services
- VPN/corporate internal services

without requiring the main JotIt backend process to be running on the same machine.

## Core Decision

Do not make the central backend a generic remote proxy for arbitrary note-authored HTTP execution.

Instead, build a small local companion app that users can install and run on their machine. JotIt will talk to that local side app for HTTP execution when needed.

## Why This Direction

A central backend can safely support some public outbound HTTP scenarios, but it cannot safely or reliably replace local execution for:

- `localhost`
- Docker service names
- RFC1918/private IP targets
- corp/VPN-only hosts
- machine-local developer environments

A local side app can access those targets because it runs in the user’s own network context.

## Product Model

Recommended execution modes:

1. Browser-direct mode
   Use when the target supports CORS and can be called directly from the browser.

2. Local side app mode
   Use when the request needs local/private/dev-network execution.

Optional future mode:

3. Central backend mode
   Only for tightly controlled public-only scenarios, if ever needed later.

For the current plan, the main focus is browser-direct plus local side app.

## Side App Overview

Suggested package name:

- `jotit-agent`

Suggested installation options:

- `npm install -g jotit-agent`
- `npx jotit-agent`

Suggested runtime:

- bind to `127.0.0.1`
- default port such as `3210`
- expose a tiny local HTTP API

## Proposed Side App API

Suggested routes:

- `GET /health`
- `POST /execute`

Suggested request payload:

```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/test",
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"hello\":\"world\"}",
  "timeoutMs": 15000,
  "followRedirects": true
}
```

Suggested response payload:

```json
{
  "ok": true,
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"result\":\"ok\"}",
  "durationMs": 72
}
```

Suggested error payload:

```json
{
  "error": "Connection refused"
}
```

## Security Requirements

### 1. Loopback-only binding

The side app must bind only to:

- `127.0.0.1`

Do not bind to:

- `0.0.0.0`

unless that is explicitly enabled by an advanced/manual configuration path.

### 2. Local auth token

The side app should require a local token or session secret so that random local webpages cannot freely use it.

Possible model:

- side app generates a token on startup
- token is shown in terminal
- token may also be written to a small local config file
- user pastes the token into JotIt settings

### 3. Request limits

Set limits for:

- max request body size
- max timeout
- max redirect count
- max response size returned to the frontend

### 4. Safe header handling

Reject or strip transport-controlled headers like:

- `host`
- `connection`
- `content-length`
- `transfer-encoding`

### 5. Response shaping

Initial version can allow binary responses because the side app runs on the userâ€™s own machine.

The side app should still enforce:

- timeout limits
- response size caps
- safe response handling

### 6. Logging

The side app should log:

- startup
- port
- request target
- duration
- failures

## Frontend Plan

Primary file:

- `src/components/HttpRunner.jsx`

Supporting areas:

- settings or connection UI
- local detection utilities

Frontend responsibilities:

- parse note-authored request text into structured data
- detect whether the side app is available
- choose between browser-direct and side-app execution
- send structured payloads to the side app when local execution is needed
- show clear connection and execution errors

## Suggested UX

The UI should indicate:

- browser-direct available
- local side app connected
- local side app not running

Example messages:

- `Local agent connected`
- `Local agent not detected on 127.0.0.1:3210`
- `Request executed via local agent`

## Detection Flow

Suggested first-pass detection:

1. Frontend pings `GET http://127.0.0.1:3210/health`
2. If healthy, enable local side app mode
3. If unavailable, fall back to browser-direct or show guidance

Optional future improvement:

- richer handshake with version info

## Suggested Side App Stack

Recommended first version:

- Node.js
- Express
- native `fetch` in Node

This keeps the first version simple and easy to distribute through npm.

## Implementation Phases

### Phase 1. Define the agent contract

Artifacts:

- this plan
- request/response schema

Tasks:

- finalize `/health` contract
- finalize `/execute` contract
- use startup-generated local token shown in terminal and optionally written to a small config file
- require the user to paste that token into JotIt settings

### Phase 2. Scaffold the side app

New project or package:

- `jotit-agent`

Tasks:

- create package entrypoint
- start local HTTP server
- bind to `127.0.0.1`
- add `/health`

### Phase 3. Add request execution

Files:

- side app server code

Tasks:

- validate method and URL
- execute outbound request locally
- shape and return response
- add timeout and size limits

### Phase 4. Add local security

Tasks:

- add local token or handshake secret
- strip unsafe headers
- add request/response caps
- add logs

### Phase 5. Integrate JotIt frontend

Files:

- `src/components/HttpRunner.jsx`

Tasks:

- auto-detect side app when possible
- add side-app execution path
- preserve browser-direct mode
- show connection status/errors

### Phase 6. Update docs and onboarding

Files:

- `README.md`
- `docs/FRONTEND_GUIDE.md`
- `docs/SERVER_GUIDE.md` if needed
- maybe new install docs for the agent

Tasks:

- explain installation
- explain mode selection
- explain localhost/private-network support

### Phase 7. Add tests

Side app tests:

- health route
- execute success
- timeout behavior
- header filtering
- loopback-only config

Frontend tests or manual checks:

- agent detected
- agent unavailable
- request success via agent
- browser-direct fallback

## File-Level Impact

Expected new artifacts:

- new side app package/subproject for `jotit-agent` in this repo

Expected JotIt frontend updates:

- `src/components/HttpRunner.jsx`
- optionally settings/detection helpers

## Locked Decisions

- The side app should live in this repo.
- The side app should generate a local token on startup.
- The token should be shown in terminal and may also be written to a small config file.
- The user should paste the token into JotIt settings.
- The frontend should auto-detect the side app when possible.
- Binary responses are allowed in the first version because they stay on the userâ€™s machine.
- User-configurable ports are out of scope for the first milestone.

## Recommended First Milestone

Ship a minimal local side app with:

- `GET /health`
- `POST /execute`
- loopback-only binding
- fixed default port
- startup-generated local token
- timeout limits
- response size caps
- binary-response support
- frontend detection and execution path in `HttpRunner`

That is enough to make note-authored requests work for localhost/private/dev targets without forcing the full JotIt backend to run locally.

## Success Criteria

- A user can install and run the side app with npm.
- JotIt can detect the side app locally.
- A note-authored request can execute through the side app against `localhost` or a private/dev target.
- The side app is not exposed as a LAN-open proxy by default.
- Browser-direct execution still works for CORS-friendly public APIs.

## Status

- `2026-04-24`: Added in-repo `agent/` package with `/health` and `/execute`.
- `2026-04-24`: Added fixed-port local agent detection and token-based execution flow to `HttpRunner`.
- `2026-04-24`: Updated Settings to support local agent mode and token entry.
