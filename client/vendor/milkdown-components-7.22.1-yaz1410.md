# Milkdown components patch (CSS zoom, list-item caret restore, table block)

`milkdown-components-7.22.1-yaz1410.tgz` is a version-pinned build of
`@milkdown/components@7.22.1` with these changes:

- YAZ-1410: table drag preview, drag-over, and boundary indicator geometry are
  correct when the editor is inside a CSS `zoom` context.
- YAZ-2131 4B: the list-item node view restores the caret once per editor view
  per frame instead of once per list item. Opening a note with N bullets used to
  run N whole-plugin transactions in one frame (22.6 s for a 5k-line note). The
  caret still lands where the last of those N restores put it. Drop this hunk
  once upstream Milkdown releases the same fix.
- YAZ-3696 B2 (YAZ-3760): the table node view's `stopEvent` no longer claims a
  mousedown in a cell, and its `#handleClick` is gone. That method put a
  `NodeSelection` on the cell paragraph at the first click, so
  `prosemirror-tables` never started a cell selection drag. Now a drag selects
  cells, and a click puts the caret in the cell. A mousedown on a button stays
  with the table block.
- YAZ-3696 B4 (YAZ-3760): the table node view's `update` returns `true` for an
  unchanged node. A decoration change (fold, line numbers, a cell selection)
  keeps the Vue table. Before, ProseMirror rebuilt the whole table each time.
- YAZ-3696 D2 (YAZ-3761): the table node view draws a `<colgroup>` as the
  first child of the table, before the `tbody`. On each node update it calls
  `updateColumnsOnResize` from `prosemirror-tables`, the function that
  `columnResizing` uses during a drag. So the widths look the same during and
  after a drag. A table with no `colwidth` keeps its old look (no minimum
  width). `columnResizing` itself is not vendored: `client/src/editor/table/tableColumnResize.ts`
  loads it as installed.
- YAZ-3696 D9 (YAZ-3762), YAZ-3820: the column and row handles have no menu
  of their own. Upstream's icon strips (`.button-group`: align and delete) are
  gone, and the labeled menus that D9 put in their place are gone too. A click
  or right-click on a handle selects (see 2E below), then sends the DOM event
  `milkdown-table-handle-menu` from the handle. It bubbles, and its `detail` is
  `{ x, y, pos }`: the pointer, and the position of a cell of the handle's column
  in row 1 (of its row in column A). The app's note menu listens on the editor's
  DOM and opens there, with the same Table part as a right-click in a cell
  (`client/src/editor/noteMenu.tsx`, `client/src/editor/table/tableMenu.ts`). The
  header row's handle sends no event. In a read-only note a handle selects
  nothing and sends nothing. Sort and Duplicate row are app commands now
  (`tableMenu.ts`), so `operation.ts` keeps only the selection. The app's
  listener has its own copy of the event name (`TABLE_HANDLE_MENU` in
  `noteMenu.tsx`); `noteMenu.test.tsx` clicks a real handle, so the two names
  cannot drift apart. Left as upstream has them, and dead now that
  `.button-group` is gone: its null-safe lookups in `view/pointer.ts`,
  `view/utils.ts` and `dnd/create-drag-handler.ts`, and the unused button keys
  of `config.ts` (`add_row`, `delete_*`, `align_col_*`). The
  `TableHandleMenuDetail` type in `view/operation.d.ts` (internal, not
  exported by the package) has no user. Removing them needs a rebuild of the archive.
- YAZ-3696 2D (YAZ-3800): the hover "+" insert lines are gone. A pointer at a cell
  edge shows no line, and the two "+" buttons and their handlers (`onAddRow`,
  `onAddCol`, `lineHoverIndex`) are removed. The two line elements stay, with no
  button, as the drop line of a row or column drag. Insert is in the note's
  table menu, from a right-click or a handle.
- YAZ-3696 2E (YAZ-3801): a right-click on a column or row handle does what a
  click does (`preventDefault` and `stopPropagation`, so the note's own
  right-click does not run on it). Its mousedown does not reach the editor. A
  handle click keeps a selection of whole columns (rows, without the header row)
  that holds the hovered one; Shift + click grows the selection to the hovered
  column (row). The app's menu counts the selection in its labels.

Upstream PR: prepared, awaiting Yasin's go (the patch and PR text are in
`client/vendor/upstream/list-item-restore/`); drop this hunk under
YAZ-2213 once released.

The package name and version remain unchanged so every Milkdown package uses
the same 7.22.1 dependency graph.

When updating an existing checkout, use `npm ci` to install the locked archive.
Because the package version is unchanged, `npm install` can retain an already
installed upstream copy. `client/src/editor/tableZoom.test.ts` checks the actual
installed runtime and catches that stale installation, as does
`client/src/editor/listItemCaretRestore.test.ts`.

The upstream package is MIT licensed and includes its original `LICENSE` file.
Source: <https://registry.npmjs.org/@milkdown/components/-/components-7.22.1.tgz>
Upstream npm integrity:
`sha512-6IA8fcFcBTm/x1X1typz73yUoT1JuN4srmifGAIeWEtCnayEwRjFxpQOoQrfvMgBYx4DSHcPVLhJUlR/xbBtxg==`.

Rebuild from the pinned registry artifact:

```sh
node tools/buildMilkdownPatch.mjs components
```

For an offline rebuild, pass the unmodified upstream npm archive:

```sh
node tools/buildMilkdownPatch.mjs components --source /path/to/components-7.22.1.tgz
```

The build verifies the entire upstream archive against its pinned integrity, then
applies the adjacent readable `.patch` with Git. It fails if the source has drifted.
Use `--output /path/to/rebuilt.tgz` to compare a rebuild without replacing the
vendor archive.
Only these files differ from upstream:

- `src/table-block/dnd/preview.ts`
- `src/table-block/dnd/drag-over-handler.ts`
- `src/table-block/view/pointer.ts`
- `src/table-block/view/view.ts`
- `src/table-block/view/component.tsx`
- `src/table-block/view/operation.ts`
- `src/table-block/view/types.ts`
- `lib/table-block/index.js`
- `lib/table-block/view/operation.d.ts`
- `lib/table-block/view/types.d.ts`
- `src/list-item-block/view.ts`
- `lib/list-item-block/index.js`

The stale table-block and list-item-block source maps and their
`sourceMappingURL` lines are removed because the compiled runtime is patched
directly. The package exports do not change. The declaration changes are the
internal `operation.d.ts` and `types.d.ts` (not exported), so they match the new
runtime.
