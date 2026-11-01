# Outside edits in an open note

An AI agent, another app, a sync pull or a copy of the note in another tab writes the `.md` file. The file watcher tells the open editor (`Editor.tsx` `onDiskChange`). The code in this folder brings that new file into the live editor without a rebuild, and shows what changed. Decisions: YAZ-1347 (the diff apply) and YAZ-3704 (the merge and the change list, working log YAZ-3824).

## The three parts

1. **`diffDocs.ts`: two versions of a note → a list of changes.** It walks the two ProseMirror documents structurally. Each change is a small replace range, or an attr range for a node whose only change is its attrs (a task ticked, a heading's level; a heading's id or a list number, which the editor works out itself, are "derived" and show nothing). Everything else here stands on it, so making it finer (word-level changes inside a line, a moved bullet seen as a move) improves the whole feature.
2. **The merge: `applyExternalMarkdown.ts` and `mergeExternal.ts`.**
   - With no unsaved typing, `applyExternalMarkdown` lands `diffDocs(live, new file)` as ONE transaction (`addToHistory: false`, `EXTERNAL_EDIT_META`), so folds, caret and scroll ride ProseMirror's mapping. A rewrite (one range ≥ `REWRITE_SHARE` of the note) rebuilds instead.
   - With unsaved typing, `mergeExternalMarkdown` takes the body as last saved as the base, diffs it against the live doc (your typing) and against the new file (the outside edit), maps the outside edit over your typing and lands it the same way. It refuses (the caller shows the conflict bar) on a rewrite, on both sides in one textblock, or when the two orders give different docs.
   - Both say where the outside text landed: `OUTSIDE_RANGES_META` on the transaction (`replaceTracked`). A quiet apply (the user's own typing from a copy of the tab) says nothing.
3. **The change list: `outsideChanges.ts`, `outsideChangesChannel.ts`, `OutsideChangesBar.tsx`.** A ProseMirror plugin keeps the landed ranges in memory for the open tab, one change per textblock, and draws the glow (the mouse on it shows at once the line word by word: the removed words struck, the new ones lit), the removed marks and the **Checked** buttons. The bar ("N outside changes in this note", **Next change**, **Mark all checked**) and the numbered list (`OutsideChangesList.tsx`, YAZ-3998: each change in the order it happened; a click goes to it and flashes its line; pinned left of the note, or a dropdown from the count, `settings.outsideListPinned`) talk to it through the channel. The Glow setting (`settings.outsideChangeGlow`) reaches it through the channel, never by rebuilding the editor. Nothing is saved to disk: `outsideChangesMemory.ts` keeps each page's list for its tab while the tab shows another page, and the plugin gets it back (through `diffDocs` when the note changed meanwhile) when the tab shows the page again.

The contracts are rules 44 and the "⚡ AMENDED by YAZ-3704" notes in `docs/CONTRACTS.md`.

## Why there is no `prosemirror-collab`

`prosemirror-collab` is built for edits that arrive as steps from a server, with a version number and a client id. Here every outside edit arrives as a whole file, so the edit is a diff of two files either way, and the file's mtime is the only version. ProseMirror's history already maps your undo steps through an `addToHistory: false` transaction, so ⌘Z keeps undoing only your typing. If edits ever arrive as steps (an edit tool that talks to the app, a live cursor), port `prosemirror-collab` then and replace `mergeExternal.ts`: the other two parts stay.
