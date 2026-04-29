# Git Integration Plan

## Goal

Add git-aware workflows to JotIt without making browser code execute shell commands directly.

The integration should let users connect local repositories through the local agent, link a repo to a note, and run note-scoped git commands like status, diff, and PR drafting without repeatedly passing a repo path.

## Core Concepts

### Known Repos

Known repos are globally registered repositories the local agent can access.

`/git connect` adds or updates a repo in this registry.

### Default Repo

The default repo is an optional global fallback used when a note does not have its own linked repo.

### Note-Linked Repo

A note-linked repo is a per-note association. It takes precedence over the global default.

When a note is linked:

```txt
Repo: my-repo
Branch: feature/git-panel
Base: main
```

Then commands inside that note default to the linked repo:

```txt
/git status
/git diff
/pr draft
```

### Session Active Repo

A temporary active repo can exist for the current UI/session before the user saves it to a note or global default.

## Repo Resolution Order

When a git command needs a repo, resolve in this order:

```txt
explicit repo argument
-> note-linked repo
-> session active repo
-> global default repo
-> error: choose a repo
```

## Commands

### `/git connect`

Example:

```txt
/git connect "C:\Users\cambr\source\repos\my-repo"
```

Behavior:

- Validate the path exists.
- Validate it is a git repo using `.git` or `git rev-parse --show-toplevel`.
- Read repo name, branch, base branch, and remotes.
- Register the repo with the local agent.
- Add it to JotIt known repos.
- Do not implicitly link it to the current note.

Result:

```txt
Connected repo: my-repo
Branch: feature/git-panel
Path: C:\Users\cambr\source\repos\my-repo

Use this repo for the current note?
[Only this note] [Set as default] [Not now]
```

### `/git repos`

Lists known repos.

Example output:

```txt
Known repos

* my-repo
  Branch: feature/git-panel
  Path: C:\Users\cambr\source\repos\my-repo
  Linked to this note: yes

  Actions: [Use for this note] [Set default] [Forget]
```

### `/git use`

Example:

```txt
/git use my-repo
```

Prompt:

```txt
Use "my-repo" for this note?

[Only this note] [All notes - set default] [Cancel]
```

Result for note-level link:

```txt
Repo linked to this note: my-repo
Branch: feature/git-panel
Base: main
```

## Data Model

### Note Metadata

Store the note link in note metadata, not the note body.

```js
note.git = {
  repoId: 'my-repo',
  baseBranch: 'main',
  linkedAt: 1710000000000,
}
```

### Global Settings

Store known repos globally.

```js
settings.git = {
  defaultRepoId: 'my-repo',
  repos: {
    'my-repo': {
      id: 'my-repo',
      name: 'my-repo',
      path: 'C:\\Users\\cambr\\source\\repos\\my-repo',
      branch: 'feature/git-panel',
      remote: 'origin',
      baseBranch: 'main',
      lastSeenAt: 1710000000000,
    },
  },
}
```

Use a stable `repoId`.

If multiple repos have the same directory name, avoid collisions by appending a suffix or using a path hash internally:

```js
{
  id: 'api:7f3a21',
  displayName: 'api',
}
```

## Local Agent API

Git operations should go through the local agent. The browser should never run git commands directly.

Minimum endpoints:

```txt
POST /git/connect
GET  /git/repos
POST /git/use
GET  /git/status?repoId=
GET  /git/diff?repoId=
```

### `POST /git/connect`

Request:

```json
{
  "path": "C:\\Users\\cambr\\source\\repos\\my-repo"
}
```

Response:

```json
{
  "ok": true,
  "repo": {
    "id": "my-repo",
    "name": "my-repo",
    "path": "C:\\Users\\cambr\\source\\repos\\my-repo",
    "branch": "feature/git-panel",
    "baseBranch": "main"
  }
}
```

## Safety Rules

- Do not accept arbitrary shell commands from the UI.
- Whitelist git operations.
- Require a registered repo before running repo commands.
- Block destructive commands initially:
  - `reset`
  - `clean`
  - force push
  - checkout with pathspecs
  - rebase
- Confirm pull/push if the working tree is dirty.
- Return exact command errors from the agent in a structured form.
- Normalize paths and prevent path traversal outside the registered repo root.

## Initial Implementation Order

1. Add agent-side git command wrapper.
2. Add `POST /git/connect`.
3. Add repo registry persistence.
4. Add frontend `/git connect` command.
5. Add `/git repos`.
6. Add `/git use`.
7. Add note metadata for linked repo.
8. Add `/git status` using repo resolution order.
9. Add `/git diff`.
10. Add PR draft command using the resolved repo context.

## UX Rule

`/git connect` discovers and registers a repo.

`/git use` links a repo to a note or sets it as the global default.

Keep those responsibilities separate so users do not accidentally attach repos to notes.
