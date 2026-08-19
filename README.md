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

Lists behave like an outliner (Obsidian / Logseq), see `docs/CONTRACTS.md` "Editor rules" for the exact semantics:

- **Fold**: parent bullets get a chevron; collapsed state is remembered per file in `localStorage` only — the markdown on disk (and its mtime) is never touched by folding.
- **Keys**: `Tab` indents (no-op on a first sibling), `Shift-Tab` outdents (level 1 → paragraph), `Enter` at the end of a parent creates its first child, `Enter` on an empty item outdents, `Backspace` at the start of an item joins it into the previous line.
- **Look**: ● ○ ■ bullet glyphs by depth and Obsidian's default typography (system font, 16px, Obsidian heading scale).
- **Round-trip**: the first real edit rewrites the file in remark's normalised form (bullet markers, 2-space indent, …); empty items are written as a bare `*` / `* [ ]`. Typing without changes never writes.

## Out of scope

Wikilinks / embeds / tags (kept as plain text, not resolved), creating / renaming / deleting files or folders, and an Electron or other desktop shell. The server has no path jail: anything under your user account can be read or written, so keep it on localhost.
