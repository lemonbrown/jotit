# OpenAPI Implementation Plan

This document defines the implementation plan for adding `swagger.json` / OpenAPI support to JotIt so users can inspect API contracts, generate runnable requests, and validate live responses against the spec.

## Goal

Allow a user to:

- import an OpenAPI spec from file or URL
- inspect operations, parameters, request bodies, responses, and auth schemes
- generate runnable HTTP request blocks from an operation
- execute those requests through the existing browser-direct or local-agent paths
- validate live responses against the declared contract

## Product Outcome

JotIt should behave like an API notebook:

- notes can contain raw HTTP requests
- specs can describe and generate those requests
- the HTTP runner can execute them
- the app can compare actual responses to the declared schema

## Scope

### In scope

- OpenAPI JSON import
- OpenAPI 3.x support
- normalized internal operation model
- operation explorer UI
- request-block generation
- basic example generation from schemas
- basic response validation

### Out of scope for first milestone

- full JSON Schema compatibility edge cases
- external `$ref` resolution across remote documents
- code generation for SDKs
- server-side OpenAPI storage/indexing
- snippet-specific OpenAPI behavior

## Core Design Rules

### 1. Parse once, normalize once

Do not make UI and runner code depend on raw OpenAPI documents directly.

Create a normalized internal model and reuse it across:

- viewer UI
- request generation
- search/filtering
- validation

### 2. Keep spec tooling separate from execution

OpenAPI answers:

- what requests should look like
- what auth is required
- what responses are expected

The HTTP runner answers:

- how a request is executed
- whether it runs in browser-direct mode or through the local agent

### 3. Keep v1 local-first

The initial implementation should live in the frontend and work with the current local workspace model.

No backend dependency is required for initial OpenAPI support.

## User Flows

### Flow 1. Import spec

1. User imports a local `swagger.json` or OpenAPI JSON file.
2. JotIt parses and normalizes the spec.
3. JotIt stores it as note-linked structured content or a dedicated API document type.

### Flow 2. Browse operations

1. User opens the imported spec.
2. JotIt shows operations grouped by tag or path.
3. User can inspect:
   - method
   - path
   - summary
   - parameters
   - request body schema
   - response schemas
   - security requirements

### Flow 3. Generate request from operation

1. User selects an operation.
2. JotIt generates a runnable HTTP request block.
3. User edits placeholders and executes it through the existing HTTP runner.

### Flow 4. Validate response

1. User runs a generated or manual request.
2. JotIt looks up the matching operation.
3. JotIt compares the actual response to the declared response schema.
4. JotIt shows basic validation results.

## Supported Spec Versions

### First milestone

- `done in design`: OpenAPI 3.x

### Deferred

- Swagger 2.0 import compatibility
- OpenAPI YAML import
- external `$ref` documents

## Internal Architecture

Recommended module layout:

- `src/utils/openapi/parse.js`
- `src/utils/openapi/normalize.js`
- `src/utils/openapi/examples.js`
- `src/utils/openapi/validate.js`
- `src/utils/openapi/matchOperation.js`

Recommended UI:

- `src/components/OpenApiViewer.jsx`
- `src/components/OpenApiOperationList.jsx`
- `src/components/OpenApiOperationDetails.jsx`
- `src/components/OpenApiValidationPanel.jsx`

Optional integration points:

- `src/components/HttpRunner.jsx`
- `src/utils/importNotes.js`
- `src/utils/searchIndex.js`

## Normalized Model

The normalized model should flatten the spec into a structure like:

```json
{
  "title": "User API",
  "version": "1.0.0",
  "servers": ["https://localhost:7026"],
  "securitySchemes": {
    "bearerAuth": {
      "type": "http",
      "scheme": "bearer"
    }
  },
  "operations": [
    {
      "id": "getUsers",
      "method": "GET",
      "path": "/users",
      "summary": "List users",
      "tags": ["Users"],
      "parameters": [],
      "requestBody": null,
      "responses": {
        "200": {
          "contentType": "application/json",
          "schema": {}
        }
      },
      "security": ["bearerAuth"]
    }
  ]
}
```

The app should depend on this normalized form instead of raw nested spec objects.

## Phase Plan

### Phase 1. Parsing and normalization

Tasks:

- add OpenAPI parser utilities
- validate minimum required fields
- resolve internal `$ref` values
- normalize operations, parameters, request bodies, and responses
- normalize server URLs and security schemes

Success criteria:

- a valid OpenAPI JSON file can be parsed into a stable internal model

### Phase 2. Import and storage

Tasks:

- add import support for OpenAPI JSON files
- detect likely OpenAPI documents during file import
- decide storage format:
  - raw spec retained
  - normalized model derived on import or lazily on read
- link imported specs to notes or dedicated API entries

Success criteria:

- a user can import a spec and reopen it later without reparsing raw text manually

### Phase 3. Operation explorer UI

Tasks:

- add a viewer for title, version, servers, and tags
- show operations grouped by tag or path
- show operation detail panes
- expose params, body schema, responses, and security info

Success criteria:

- a user can inspect a spec without reading raw JSON

### Phase 4. Request generation

Tasks:

- generate request blocks from operations
- choose a base URL from `servers`
- render path placeholders
- prefill query/header/body scaffolds
- generate starter JSON bodies from request schemas

Success criteria:

- a selected operation can become a runnable note-style HTTP request

### Phase 5. HTTP runner integration

Tasks:

- allow generated requests to open directly in `HttpRunner`
- preserve browser-direct mode
- preserve local-agent mode for localhost/private targets
- optionally attach operation metadata to generated request blocks

Success criteria:

- a generated operation can be run without manual reformatting

### Phase 6. Response validation

Tasks:

- match a response to the expected operation and status code
- validate required properties
- validate simple type mismatches
- validate missing top-level fields
- show a compact validation summary in the UI

Success criteria:

- the user can see whether the response broadly matches the contract

### Phase 7. Search and note integration

Tasks:

- make imported specs searchable by:
  - operation id
  - path
  - method
  - tag
  - summary
- support note links from API notes to operations
- optionally add “insert operation request” actions from search results

Success criteria:

- OpenAPI content is discoverable inside the workspace

### Phase 8. Docs and tests

Tasks:

- document supported OpenAPI features
- document unsupported schema/ref cases
- add parser unit tests
- add example generation tests
- add response validation tests
- add manual UI verification notes

Success criteria:

- the feature is documented and regression-tested

## File-Level Impact

Expected new files:

- `src/utils/openapi/parse.js`
- `src/utils/openapi/normalize.js`
- `src/utils/openapi/examples.js`
- `src/utils/openapi/validate.js`
- `src/utils/openapi/matchOperation.js`
- `src/components/OpenApiViewer.jsx`
- `src/components/OpenApiOperationList.jsx`
- `src/components/OpenApiOperationDetails.jsx`
- `src/components/OpenApiValidationPanel.jsx`
- `test/openapi.test.js`

Expected touched files:

- `src/components/HttpRunner.jsx`
- `src/utils/importNotes.js`
- `src/utils/searchIndex.js`
- `src/components/NotePanel.jsx`
- `README.md`
- `docs/FRONTEND_GUIDE.md`

## Validation Strategy

### Parser tests

- parses minimal OpenAPI 3 spec
- resolves internal `$ref`
- rejects invalid spec shapes
- normalizes operations consistently

### Example generation tests

- builds request example from path/query/header params
- builds JSON body examples from simple object schemas

### Response validation tests

- accepts matching simple object response
- flags missing required fields
- flags obvious type mismatches
- handles missing schema gracefully

### Manual verification

- import real local `swagger.json`
- browse operations
- generate `GET /users`
- run through local agent against `https://localhost:7026`
- inspect validation results

## Recommended First Milestone

Ship:

- OpenAPI JSON import
- normalized operation model
- operation explorer
- request generation into HTTP runner format
- basic response validation for JSON object responses

That is enough to turn `swagger.json` into something operationally useful inside JotIt without overcommitting to full schema tooling.

## Decisions To Lock

- Imported specs should become a dedicated document type.
- v1 supports JSON only.
- Swagger 2.0 is deferred.
- Imported specs should be indexed for workspace search immediately.
- Generated requests should open in a temporary runner view, with an option to copy to a new note.

## Status

- `2026-04-24`: Created initial OpenAPI implementation plan.
- `2026-04-24`: Added OpenAPI 3.x JSON import, normalization utilities, and dedicated OpenAPI note storage.
- `2026-04-24`: Added `OpenApiViewer`, temporary HTTP runner execution, copy-to-new-note flow, and basic JSON response validation.
- `2026-04-24`: Indexed imported operations into workspace search and added parser/request/validation coverage in `test/openapi.test.js`.
