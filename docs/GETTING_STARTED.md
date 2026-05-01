# Getting Started with Jotit

Jotit is a note app designed for the messy reality of developer workflows. It focuses on finding "eventually very important information" that usually gets lost in transient scratchpads.

## Core Philosophy

- **Local First:** Your data is stored in a local database in your browser. You don't need an account or an internet connection to start writing.
- **Search as a First-Class Citizen:** Built for when you "almost remember" something.
- **Tooling in the Flow:** Run HTTP requests, query SQL, or fetch web pages directly from your notes.

## The Workspace

### 1. Creating and Managing Notes
- **New Note:** Click **+ New** or press `Alt + N`.
- **Collections:** Organize notes into collections. Use the dropdown in the header to switch or create new ones.
- **Pinned Notes:** Pin important notes within a collection to keep them at the top.

### 2. Multi-Pane Editing
Jotit supports a powerful split-pane interface:
- **Open in New Pane:** `Shift + Click` a note in the list to open it side-by-side.
- **Resize:** Drag the dividers between panes to adjust your workspace.
- **Close Pane:** Click the `x` in the pane header.
- **Toggle Note List:** Press `Ctrl + \` to hide the note list and focus entirely on your active panes.

### 3. Smart Search
The search bar at the top supports two modes:
- **Plain:** Standard text matching.
- **Smart:** Intelligent ranking based on headings, keywords, and entities.
- **Improve with Nib:** If you have an AI provider connected, click the **Nib** button after searching to have AI rerank the results for better relevance.

## Note Commands (Slash Commands)

Type `/` at the start of a line to see available commands:

- `/now`: Inserts the current date and time.
- `/url <url>`: Fetches the content of a web page and converts it to readable text.
  - `/url --markdown <url>`: Converts the page to clean Markdown.
  - `/url --note <url>`: Creates a new note with the page content.
- `/nib`: Your AI assistant.
  - `/nib summarize`: Summarizes the current note.
  - `/nib actions`: Extracts action items.
  - `/nib !template`: Drafts content based on a saved template (e.g., `!bug`).
- `/sql`: Run a SQL query against an attached SQLite database.
- `/git`: Check status or run commands in your local git workspace.

## Working with Data

- **Drag & Drop:** Drop files directly into Jotit.
  - **CSVs:** Can be rendered as interactive tables.
  - **SQLite:** Opens an explorer to query the database.
  - **OpenAPI:** Imports specifications as navigable API documentation.
- **Images:** Paste images directly into your notes. They are stored locally.

## Accounts and Syncing (Optional)

Signing in allows you to:
- **Sync:** Keep your notes in sync across multiple devices.
- **Public Sharing:** Create public links for notes or entire collections.
- **Server AI:** Access more powerful semantic search if your server is configured with an AI provider.

## Helpful Shortcuts

- `?`: Open the Help modal (Commands & Hotkeys).
- `Alt + N`: New note.
- `Ctrl + \`: Toggle the notes list.
- `Alt + Left / Right`: Navigate back/forward through your note history.
- `Esc`: Clear search and return to the main list.

---

*Jotit - Helping you find the thing you almost remember.*
