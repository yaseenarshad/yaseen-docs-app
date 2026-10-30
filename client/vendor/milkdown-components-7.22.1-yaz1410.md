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
  width). `columnResizing` itself is not vendored: `client/src/editor/tableColumnResize.ts`
  loads it as installed.
- YAZ-3696 D9 (YAZ-3762): the column and row handles open labeled menus in
  place of the icon strips. Column: Insert column left, Insert column right,
  Align left, Align center, Align right, Sort A to Z, Sort Z to A, Clear column,
  Delete column. Row: Insert row above, Insert row below, Duplicate row, Clear
  row, Delete row. A separator splits the groups. The header row has no row
  menu, as before. Sort and Duplicate row are new commands in `operation.ts`
  (`sortRows`, `duplicateRows`); the other items call the GFM preset and
  `prosemirror-tables` commands. The labels are fixed text, so
  `renderButton` no longer draws the align and delete icons. An item acts on
  `pointerdown` and stops its `click`, so the click does not reach the handle
  and open the menu again. In a read-only note a handle click opens no menu.
  The menu CSS is in `client/src/app.css`.

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
- `lib/table-block/index.js`
- `lib/table-block/view/operation.d.ts`
- `src/list-item-block/view.ts`
- `lib/list-item-block/index.js`

The stale table-block and list-item-block source maps and their
`sourceMappingURL` lines are removed because the compiled runtime is patched
directly. The package exports do not change. The one declaration change is
the internal `operation.d.ts` (not exported), so it matches the new runtime.
