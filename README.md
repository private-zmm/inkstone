<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone project logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  A self-hosted Markdown notebook for writing, organizing, syncing, and backing up personal knowledge.
</p>

<p align="center">
  <a href="./README_ZH.md">中文</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a> ·
  <a href="https://inkstone-demo.pages.dev/">Demo</a>
</p>

## About

Inkstone is a browser-based notebook for self-hosted Node.js and Docker Compose deployments. Notes always remain plain Markdown text; on top of that foundation, the application provides focused writing, live preview, lexical and optional semantic search, bidirectional links, offline editing, multi-device synchronization, private AI access, public sharing, and backups.

It is a complete self-hosted application. The deployer retains control of the database, attachments, and runtime environment.

Every new account automatically receives two standard starter notes, one in Chinese and one in English. The browser-only demo reuses the same note content; refreshing the page restores these two starter notes instead of loading a separate set of demo data.

## Features

| Area | Included |
| --- | --- |
| Writing | CodeMirror 6 editor, independently editable note titles, **two-note editor groups**, per-group editor/split/preview layouts, synchronized scrolling, outline, **focus mode**, **typewriter mode**, **autosave**, and **version history** |
| Markdown | GFM tables and task lists, footnotes, Obsidian-style comments, WikiLinks, embeds, block IDs, callouts, details blocks, tabs, **math**, **Mermaid diagrams**, **PrismJS syntax highlighting**, and **Front Matter** |
| Organization | Nested folders with drag-and-drop ordering, inline tags, favorites, pinning, archive, trash, **wiki links**, backlinks, block references, note embeds, and a relationship graph |
| Search | PostgreSQL full-text search with Chinese indexing, filters, recent notes, command-palette navigation, and optional private **semantic/hybrid search** powered by an external embedding API |
| **MCP** | Private remote MCP with revocable `ink_...` API keys, standard `search`/`fetch`, bounded reads, revision-safe writes, and separate trash permission |
| Reliability | Installable PWA, offline app launch, browser-side cache, **offline write queue and optimistic concurrency control**, immediate local mutations with rollback, stale-sync protection, conflict copies, realtime notifications, and elected-tab polling fallback |
| Sharing | Public note links with optional access passwords and expiration dates |
| Portability | JSON and ZIP exports, directly readable **Markdown**, attachment export, and **manual or scheduled WebDAV/S3 backups** |
| Interface | **Desktop and mobile layouts**, **dark/light themes**, accent colors, Simplified Chinese, English, and owner-only update notifications |

## Data storage

| Component | Purpose |
| --- | --- |
| PostgreSQL | Accounts, notes, folders, tags, settings, versions, shares, lexical indexes, per-account AI embeddings, and background indexing queues |
| MinIO | Attachment, avatar, and backup object storage through the S3-compatible API |
| Redis | Scheduler lock, realtime Pub/Sub notifications, and short-lived coordination |
| External embedding API | Optional embedding generation for semantic search; unavailable deployments continue to use lexical search |
| Browser IndexedDB | Local cache and pending offline writes |
| Node WebSocket + Redis | Realtime change notifications between active clients |
| PostgreSQL encryption | Encrypted backup credentials protected by `ENCRYPTION_KEY` |
| WebDAV or S3 storage | User-configured off-site backups |

## Deployment

1. Copy `.env.example` to `.env` and set strong local secrets.
2. Start the stack with `docker compose up -d --build`.
3. Open the NAS address shown by your reverse proxy or `http://localhost:3000`.

Existing databases are upgraded automatically through versioned, idempotent migrations. Keep a current backup before updating any self-hosted deployment. When a newer stable Inkstone release is available, the owner receives a focused reminder without interrupting regular members.

## Exports and backups

- JSON export preserves legacy structured notebook data for re-import.
- ZIP export and remote backups use the same verified Markdown snapshot format, including readable notes, archived and trashed notes, attachments, and a completion marker.
- Remote backup targets support WebDAV and S3-compatible storage, with duplicate attachment content stored only once inside each snapshot.
- Large backups can be restored by selecting the backup folder, without loading one complete archive into memory.
- Multiple targets can be configured and run manually or on a schedule.
- Login passwords, active sessions, share passwords, and backup-service credentials are not included in exports.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm run dev:node` | Start the local Node server |
| `npm run dev:scheduler` | Start the local background scheduler |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run test:unit` | Run the Vitest unit test suite |
| `npm run i18n:check` | Verify parity between the English and Chinese locale resources |
| `npm run comments:check` | Enforce the source-comment policy |
| `npm run build` | Type-check and create a production build |
| `docker compose up -d --build` | Build and deploy the complete NAS stack |
| `npm run test:e2e` | Exercise the API against a running disposable local instance |

The end-to-end script creates, changes, and deletes data at `http://localhost:7712`. Run it only against a fresh local state dedicated to testing.

## Repository layout

```text
src/
├── client/   React interface, editor, preview, and local state
├── shared/   Shared types, limits, locale resources, and Markdown utilities
└── worker/   Hono API, authentication, PostgreSQL access, sync, sharing, and backups
public/       Static assets
scripts/      Repository checks and end-to-end verification scripts
tests/        Cross-module regression tests
```

## Security and contributions

Read [`SECURITY.md`](./SECURITY.md) before reporting a vulnerability. Development setup and contribution requirements are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Inkstone is distributed under the [GNU Lesser General Public License v3.0 only](./LICENSE), using the SPDX identifier `LGPL-3.0-only`.
