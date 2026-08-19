# yaseen-milkdown

A local markdown editor for a folder of notes (e.g. an Obsidian vault): a Vite + React client running [Milkdown Crepe](https://milkdown.dev/) in the browser, and a small Hono server that reads and writes files on this machine over HTTP. Pick a folder, browse its `.md` files in the sidebar, edit WYSIWYG, and changes are saved back to disk (debounced, atomic). Files changed outside the app (another editor, sync) are reloaded live; if you have unsaved edits you get a Reload / Keep mine choice. YAML frontmatter is preserved byte-for-byte.

## Requirements

Node.js 20.19 or newer (22+ recommended), npm. macOS/Linux paths.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173> (or <http://localhost:5173>). The server listens on `127.0.0.1:3737`; the client proxies `/api` to it.

```sh
npm test         # unit + API tests (vitest)
npm run typecheck
npm run build    # client production build into client/dist
```

## Out of scope

Wikilinks / embeds / tags (kept as plain text, not resolved), creating / renaming / deleting files or folders, and an Electron or other desktop shell. The server has no path jail: anything under your user account can be read or written, so keep it on localhost.
