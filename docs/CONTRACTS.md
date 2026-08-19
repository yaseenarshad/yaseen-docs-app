# Contracts (locked in GRO-1961)

Source of truth for types: [`shared/types.ts`](../shared/types.ts). This file is the prose companion.

## Repo layout / scripts / ports

```
package.json          npm workspaces: client, server. Root scripts:
                        dev        concurrently: server (tsx watch) + client (vite)
                        build      vite build + server tsc --noEmit
                        typecheck  tsc -p client && tsc -p server && tsc -p shared
                        test       vitest run  (projects: client=jsdom, server=node)
client/               Vite 7 + React 19 + TS, @milkdown/crepe 7.22.x  (port 5173, strict)
                        vite proxy: /api -> http://127.0.0.1:3737
  src/editor/createCrepe.ts   locked Crepe factory (see "Editor rules")
  src/editor/frontmatter.ts   split/join YAML frontmatter
  src/test-setup.ts           jsdom stubs (IntersectionObserver, ResizeObserver, Range rects)
server/               Hono 4 + @hono/node-server, chokidar 4, run with tsx (port 3737, binds 127.0.0.1)
shared/types.ts       shared TS types (alias @shared/* in both tsconfigs + vite)
docs/CONTRACTS.md     this file
```

Import from shared: `import type { TreeResponse } from '@shared/types'`.

## HTTP API (server, base `http://127.0.0.1:3737`)

All paths are absolute POSIX paths. No jail — any absolute path is allowed.
All errors: `{ error: { code, message, path? } }` with `ApiErrorCode` (see types) and HTTP status:
`BAD_REQUEST`/`NOT_ABSOLUTE`/`NOT_A_DIRECTORY`/`NOT_A_FILE`/`NOT_MARKDOWN` → 400,
`FORBIDDEN` → 403, `NOT_FOUND` → 404, `CONFLICT` → 409, `TOO_LARGE` → 413, `IO_ERROR` → 500.

| Method | Path | Query / body | 200 response |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| GET | `/api/dirs` | `?path=<abs>` (omitted → `$HOME`) | `DirsResponse` — child dirs only, no dotdirs, sorted case-insensitive; `parent` null at `/` |
| GET | `/api/tree` | `?root=<abs>` | `TreeResponse` — recursive; only `.md`/`.markdown` files; dirs without markdown below are pruned; dot-entries and `node_modules` skipped; dirs before files, each sorted case-insensitive |
| GET | `/api/file` | `?path=<abs>` | `FileResponse` — raw UTF-8 content incl. frontmatter; 413 if > 10 MiB |
| PUT | `/api/file` | JSON `FileWriteRequest { path, content, expectedMtime? }` | `FileWriteResponse { path, mtime, size }` — atomic write (`<name>.tmp-<rand>` + `rename`); parent dir must exist; if `expectedMtime` given and disk mtime is newer → 409 `FileWriteConflict` and nothing written |
| GET | `/api/watch` | `?root=<abs>` | SSE stream of `WatchEvent`: `event: <type>\ndata: <json>\n\n`; first event `ready`; `: ping` comment every 25 s; chokidar with `ignoreInitial: true`, `awaitWriteFinish: { stabilityThreshold: 200 }`, ignores dot-entries and `node_modules`, only `.md`/`.markdown` file events (+ dir add/unlink) |

Notes
- Server writes trigger `change` events on the watcher; client must ignore events for a path whose mtime equals the mtime it just received from its own PUT (echo suppression).
- Auto-save: client debounces 500 ms after last `markdownUpdated`, also flushes on file switch / window `beforeunload`.

## Editor rules (client)

1. **Frontmatter**: on load, `splitFrontmatter(content)` → `{ frontmatter, body }`; only `body` goes into Crepe. On save, write `frontmatter + getMarkdownForSave(crepe)`. Frontmatter is re-prepended byte-identically (Crepe would otherwise turn `---` YAML into `***` + paragraph + setext heading underline).
2. **Crepe construction**: always via `createCrepe()` — ImageBlock feature OFF, list_item content `block+` (extended from GFM task item schema), `markdownUpdated` listener wired.
3. **Save post-processing**: `postProcessMarkdown()` un-escapes `\[\[` → `[[` (wikilinks/embeds).
4. **Replacing content in a live instance** (external change, file switch without remount): `setMarkdown(crepe, md)` → `replaceAll(md, true)` from `@milkdown/kit/utils`. Simpler alternative for file switch: `destroy()` + `createCrepe()` again.
5. **Accepted lossy normalisation** (standard remark-stringify behaviour; content preserved, formatting normalised): `-`/`+` bullets → `*` (alternating `-` for adjacent sibling lists), tabs → 2-space indent, `1)` ↔ `1.` ordered markers swap/renumber, setext → ATX headings, two-space hard breaks → `\`, trailing whitespace stripped, `___` → `***`, indented code → fenced, tables re-padded, lazy blockquote continuation gets `> `, `_`/`*`/`[`/`=`/`&` escaped in text where ambiguous, bare URLs/emails → `<autolink>`, file always ends with a single `\n`. First save of an untouched file WILL rewrite the file in this normalised form.

## localStorage (client)

| Key | Type | Shape |
|---|---|---|
| `mdapp.root` | string | `"/Users/yasin/notes"` |
| `mdapp.recentRoots` | `RecentRoots` | `[{ "path": "/Users/yasin/notes", "lastOpened": 1755600000000 }]` — most recent first, max 10, de-duped |
| `mdapp.expanded` | `ExpandedState` | `{ "/Users/yasin/notes": ["/Users/yasin/notes/sub", ...] }` |
| `mdapp.lastFile` | `LastFileState` | `{ "/Users/yasin/notes": "/Users/yasin/notes/a.md" }` |

All JSON values parsed defensively (invalid → treated as absent).
