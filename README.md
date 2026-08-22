# yaseen-milkdown

Yaseen Docs — a local markdown editor for a folder of notes (e.g. an Obsidian vault), as an Electron macOS desktop app: a React renderer running [Milkdown Crepe](https://milkdown.dev/), and a main process that reads and writes the files on this machine (the renderer only ever talks to the `window.yaseenDocs` bridge — there is no server of any kind). Pick a folder, browse its `.md` files in the sidebar, edit WYSIWYG, and changes are saved back to disk (debounced, atomic). Files changed outside the app (another editor, sync) are reloaded live; if you have unsaved edits you get a Reload / Keep mine choice. YAML frontmatter is preserved byte-for-byte. Lineage in one line: product behaviour follows Obsidian, the transport mechanism follows VS Code (sandboxed renderer + typed preload bridge + main-process fs).

## Requirements

Node.js 20.19 or newer (22+ recommended), npm, macOS (the packaged app targets macOS arm64; the dev build runs wherever Electron does).

## Run

```sh
npm install
npm run dev      # launches the Electron app with HMR
```

See `LAUNCH.md` for the full launch recipe (state file, packaged-app install, agent verification).

```sh
npm test         # unit tests (vitest: client jsdom + desktop node)
npm run typecheck
npm run build    # electron-vite build into desktop/out
```

## Build the app

```sh
npm run desktop:build
```

produces `desktop/dist-app/mac-arm64/Yaseen Docs.app` and `desktop/dist-app/Yaseen Docs-0.1.0-arm64.dmg` (arm64, ad-hoc signed). Drag the `.app` into `/Applications`, or send someone the dmg.

## Sharing it

The app is ad-hoc signed, not notarized, so on someone else's Mac (macOS 15) the first open is blocked with "Apple could not verify…". Once: open **System Settings › Privacy & Security**, scroll to the blocked-app notice, click **Open Anyway**, and confirm. After that it opens normally.

## Editing

Lists behave like an outliner (Obsidian / Logseq), see `docs/CONTRACTS.md` "Editor rules" and "Keyboard" for the exact semantics:

- **Fold**: parent bullets get a chevron; collapsed state is remembered per file in the app state file (`~/Library/Application Support/Yaseen Docs/yaseendocs.json`) only — the markdown on disk (and its mtime) is never touched by folding. `⌘↑` / `⌘↓` fold / unfold the bullet at the caret (Logseq's defaults; a no-op on leaves, native document jump outside lists), `⌘⇧U` folds every parent, `⌘⇧I` unfolds all, and `⌘Z` right after a fold reverts it (folds older than the latest action stay put; `⌘Z` is normal text undo otherwise).
- **Bullet threading** (Roam / Logseq "bullet paths"): the lines from each nested list's top down to the bullet at the caret, and the bullets on that path, take the accent colour and stop at the active bullet. View-only; the settings cog has on/off (default on), width 1/2/3px and a custom colour (Default = the app accent).
- **Keys**: `Tab` indents (no-op on a first sibling), `Shift-Tab` outdents (level 1 → paragraph), `Enter` at the end of a parent creates its first child, `Enter` on an empty item outdents, `Backspace` at the start of an item joins it into the previous line.
- **Tasks**: `⌘Enter` cycles the item(s) under the selection: bullet → `[ ]` → `[x]` → bullet.
- **Marks**: `⌘U` toggles underline (stored as `<u>text</u>`, like obsidian-underline), `⌘⇧X` toggles strikethrough.
- **Zoom**: click a bullet's glyph (or `⌘.` at the caret) to zoom into that subtree, Workflowy-style; breadcrumbs at the top zoom back out (`⌘⇧.` = out one level). View-only — the file is never touched.
- **Zoom history**: every zoom in/out is a history entry, so Back returns to the level you were at before an accidental zoom and Forward re-zooms. `⌘Z` right after a zoom reverts it too — `⌘Z` always reverts the single latest view action, fold or zoom, and is normal text undo otherwise.
- **Bullet markers**: `-`, `*` and `+` are the same bullet — bullets at the same indent are siblings whatever marker each uses (unified on load; saved as `*` like before).
- **Guide lines**: nested lists draw a vertical line under their parent's glyph; clicking a line folds/unfolds the bullets alongside it (every child with children — Roam's "collapse children"), never the parent itself (caret stays put).
- **Drag**: the 6-dot handle moves a block; with several blocks highlighted, grabbing a handle inside the highlight moves them all together (drop position controls nesting depth). Over a guide line or a fold chevron the handle yields, so those clicks always land.
- **Look**: ● ○ ■ bullet glyphs by depth and Obsidian's default typography (system font, 16px, Obsidian heading scale). Line spacing and the gap between blocks are adjustable from the settings cog (bottom-left); stored in the app state file (global: every window follows a change live), never in the files. The keyboard button next to the cog lists every hotkey.
- **Round-trip**: the first real edit rewrites the file in remark's normalised form (bullet markers, 2-space indent, …); empty items are written as a bare `*` / `* [ ]`. Typing without changes never writes.

## Sidebar and windows

- **Create**: right-click a folder, a file, or the blank space under the tree → "New note" / "New base" / "New folder"; name it inline (Enter confirms, Esc cancels). Notes get `.md` automatically and open at once; "New base" creates an Obsidian-compatible `.base` file (seeded with one table view) that opens in the base view; nothing is ever overwritten.
- **Windows**: `⌘⇧N` duplicates the window (same folder, same file), `⌘⇧O` opens a folder, `⌘W` closes the window; File › Open Recent lists the last folders (⌥-click an entry to open it beside the current window). ⌘-click a sidebar file — or right-click → "Open in new window" — to open it in its own window. Open windows are restored on relaunch.
- **Links**: right-click a file row for "Copy link" — a `yaseendocs://` URL that opens that exact note from anywhere (Slack, another app); "Copy path" sits next to it. Finder's Open With also lists Yaseen Docs for `.md`/`.markdown` (as an alternate, never stealing the default handler).
- **Collapse**: the panel icon in the header hides the sidebar (a floating button on the left edge brings it back); the choice survives reload.
- **Paths**: the open file shows in the URL as `#/absolute/path.md`; right-click any row for "Copy path".

## Bases

Obsidian-compatible `.base` files open as live database views over the notes in your folder (frontmatter properties are indexed automatically):

- **Views**: table, board (kanban — our extension; Obsidian ignores it and the file round-trips), cards and list, switched by the tabs across the top (add, rename, duplicate, reorder).
- **Configure**: Filter / Sort / Properties menus and a search box; filters and formulas use Obsidian's Bases syntax, and every config change is saved into the `.base` file itself.
- **Edit in place**: note properties edit right in table cells and card/list rows — text, numbers, checkboxes, dates, lists and `[[links]]` with completion; an edit rewrites just that frontmatter key.
- **Board drag**: drag a card to another column to change its group property; the "No value" column removes it.
- **New**: the toolbar's New button (or a group header's "+") creates a note pre-filled to match the current view's filters, in the right folder.
- **Embeds**: `![[X.base]]` (or `![[X.base#View]]`) inside a note renders the base read-only beneath the line, and a ` ```base ` code block renders its own YAML the same way (with a raw-YAML toggle for editing the config); the markdown on disk stays plain text.

## Out of scope

Wikilinks and tags stay plain text (not resolved into links) — except `![[X.base]]` embeds and ` ```base ` code blocks, which render live base views as above. Renaming / deleting / moving files or folders is not built in. There is no browser mode: the app runs only inside Electron. The file layer has no path jail: anything under your user account can be read or written. Distribution is deliberately minimal (locked decisions): no Developer-ID signing or notarization, no auto-update, no Intel or universal builds, no Windows/Linux — all Future issues.
