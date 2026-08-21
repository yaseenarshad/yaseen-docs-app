# yaseen-milkdown

A local markdown editor for a folder of notes (e.g. an Obsidian vault): a Vite + React client running [Milkdown Crepe](https://milkdown.dev/) in the browser, and a small Hono server that reads and writes files on this machine over HTTP. Pick a folder, browse its `.md` files in the sidebar, edit WYSIWYG, and changes are saved back to disk (debounced, atomic). Files changed outside the app (another editor, sync) are reloaded live; if you have unsaved edits you get a Reload / Keep mine choice. YAML frontmatter is preserved byte-for-byte.

## Requirements

Node.js 20.19 or newer (22+ recommended), npm. macOS/Linux paths.

## Run

```sh
npm install
npm run dev
```

See `LAUNCH.md` for the full launch recipe.

Open <http://127.0.0.1:5173> (or <http://localhost:5173>). The server listens on `127.0.0.1:3737`; the client proxies `/api` to it.

```sh
npm test         # unit + API tests (vitest)
npm run typecheck
npm run build    # client production build into client/dist
```

## Editing

Lists behave like an outliner (Obsidian / Logseq), see `docs/CONTRACTS.md` "Editor rules" and "Keyboard" for the exact semantics:

- **Fold**: parent bullets get a chevron; collapsed state is remembered per file in `localStorage` only — the markdown on disk (and its mtime) is never touched by folding. `⌘↑` / `⌘↓` fold / unfold the bullet at the caret (Logseq's defaults; a no-op on leaves, native document jump outside lists), — if they do nothing at all, a browser extension owns the key: check `chrome://extensions/shortcuts` (GRO-2092 found "Controls for Instagram Videos" holding ⌘↑/⌘↓), `⌘⇧U` folds every parent, `⌘⇧I` unfolds all, and `⌘Z` right after a fold reverts it (folds older than the latest action stay put; `⌘Z` is normal text undo otherwise).
- **Bullet threading** (Roam / Logseq "bullet paths"): the lines from each nested list's top down to the bullet at the caret, and the bullets on that path, take the accent colour and stop at the active bullet. View-only; the settings cog has on/off (default on), width 1/2/3px and a custom colour (Default = the app accent).
- **Keys**: `Tab` indents (no-op on a first sibling), `Shift-Tab` outdents (level 1 → paragraph), `Enter` at the end of a parent creates its first child, `Enter` on an empty item outdents, `Backspace` at the start of an item joins it into the previous line.
- **Tasks**: `⌘Enter` cycles the item(s) under the selection: bullet → `[ ]` → `[x]` → bullet.
- **Marks**: `⌘U` toggles underline (stored as `<u>text</u>`, like obsidian-underline), `⌘⇧X` toggles strikethrough.
- **Zoom**: click a bullet's glyph (or `⌘.` at the caret) to zoom into that subtree, Workflowy-style; breadcrumbs at the top zoom back out (`⌘⇧.` = out one level). View-only — the file is never touched.
- **Zoom history**: every zoom in/out is a browser history entry (URL unchanged), so Back returns to the level you were at before an accidental zoom and Forward re-zooms. `⌘Z` right after a zoom reverts it too — `⌘Z` always reverts the single latest view action, fold or zoom, and is normal text undo otherwise.
- **Bullet markers**: `-`, `*` and `+` are the same bullet — bullets at the same indent are siblings whatever marker each uses (unified on load; saved as `*` like before).
- **Guide lines**: nested lists draw a vertical line under their parent's glyph; clicking a line folds/unfolds the bullets alongside it (every child with children — Roam's "collapse children"), never the parent itself (caret stays put).
- **Drag**: the 6-dot handle moves a block; with several blocks highlighted, grabbing a handle inside the highlight moves them all together (drop position controls nesting depth). Over a guide line or a fold chevron the handle yields, so those clicks always land.
- **Look**: ● ○ ■ bullet glyphs by depth and Obsidian's default typography (system font, 16px, Obsidian heading scale). Line spacing and the gap between blocks are adjustable from the settings cog (bottom-left); stored locally, never in the files. The keyboard button next to the cog lists every hotkey.
- **Round-trip**: the first real edit rewrites the file in remark's normalised form (bullet markers, 2-space indent, …); empty items are written as a bare `*` / `* [ ]`. Typing without changes never writes.

## Sidebar

- **Create**: right-click a folder, a file, or the blank space under the tree → "New note" / "New folder"; name it inline (Enter confirms, Esc cancels). Notes get `.md` automatically and open at once; nothing is ever overwritten.
- **Collapse**: the panel icon in the header hides the sidebar (a floating button on the left edge brings it back); the choice survives reload.
- **Paths**: the open file shows in the URL as `#/absolute/path.md` — paste that URL to reopen the exact file; right-click any row for "Copy path".

## Out of scope

Wikilinks / embeds / tags (kept as plain text, not resolved), renaming / deleting / moving files or folders, and an Electron or other desktop shell. The server has no path jail: anything under your user account can be read or written, so keep it on localhost.
