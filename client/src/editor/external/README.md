# Outside edits in an open page

An AI agent, another app, a sync pull or a copy of the page in another tab writes the `.md` file. The file watcher tells the open editor (`Editor.tsx` `onDiskChange`). The code in this folder brings that new file into the live editor without a rebuild, and shows what changed. Decisions: YAZ-1347 (the diff apply) and YAZ-3704 (the merge and the change list, working log YAZ-3824).

## The three parts

1. **`diffDocs.ts`: two versions of a page → a list of changes.** It walks the two ProseMirror documents structurally. Each change is a small replace range, or an attr range for a node whose only change is its attrs (a task ticked, a heading's level; a heading's id or a list number, which the editor works out itself, are "derived" and show nothing). Everything else here stands on it, so making it finer (word-level changes inside a line, a moved bullet seen as a move) improves the whole feature.
2. **The merge: `applyExternalMarkdown.ts` and `mergeExternal.ts`.**
   - With no unsaved typing, `applyExternalMarkdown` lands `diffDocs(live, new file)` as ONE transaction (`addToHistory: false`, `EXTERNAL_EDIT_META`), so folds, caret and scroll ride ProseMirror's mapping. A rewrite (one range ≥ `REWRITE_SHARE` of the page) rebuilds instead.
   - With unsaved typing, `mergeExternalMarkdown` takes the body as last saved as the base, diffs it against the live doc (your typing) and against the new file (the outside edit), maps the outside edit over your typing and lands it the same way. It refuses (the caller shows the conflict bar) on a rewrite, on both sides in one textblock, or when the two orders give different docs.
   - Both say where the outside text landed: `OUTSIDE_RANGES_META` on the transaction (`replaceTracked`). A quiet apply (the user's own typing from a copy of the tab) says nothing.
3. **The change list: `outsideChanges.ts`, `outsideChangesChannel.ts`, `OutsideChangesBar.tsx`.** A ProseMirror plugin keeps the landed ranges in memory for the open tab, one change per textblock, and draws the glow (the mouse on it shows at once the line word by word: the removed words struck, the new ones lit), the removed marks and the **Checked** buttons. The bar ("N outside changes in this page", **Next change**, **Mark all checked**) and the numbered list (`OutsideChangesList.tsx`, YAZ-3998: each change in the order it happened; a click goes to it and flashes its line; pinned left of the page, or a dropdown from the count, `settings.outsideListPinned`) talk to it through the channel. The Glow setting (`settings.outsideChangeGlow`) reaches it through the channel, never by rebuilding the editor. Nothing is saved to disk: `outsideChangesMemory.ts` keeps each page's list for its tab while the tab shows another page, and the plugin gets it back (through `diffDocs` when the page changed meanwhile) when the tab shows the page again.

The contracts are rules 44 and the "⚡ AMENDED by YAZ-3704" pages in `docs/CONTRACTS.md`.

## Cards (YAZ-5925)

A card is drawn (`renderCard`), not edited, so the decorations above cannot reach its words. `card/cardGlow.ts` draws the old text off screen, compares the VISIBLE words of both drawings with `wordDiff` (exported here), and puts the same looks (`outside-change`, `outside-removed`) on the new drawing's text nodes. When 80% (`REWRITE_SHARE`) or more of the old visible words went, the frame glows instead ("Rewritten", `CARD_REWRITE_FRAME`). The box under the mouse reads a card glow's parts from `outsideTipParts`; `mountOutsideTip` puts the same box on a card file's tab, which is no editor.

- **A card in a page** is one textblock, so the plugin already keeps one change for it, with its Before (`outsideChangeAt`). The card's node view lights its drawing from that change and shows **Checked** in its head (`checkOutsideChange`); the bar, Next change and Mark all checked work as for any line. Next's ring is a lit word of the card.
- **A card file's tab and an embed** keep their last drawn text (`CardGlowTracker`). A read with new text glows unless its mtime is the app's own write (`isOwnWrite` in `lib/twinEditors.ts`: an `announcedWrite`, or an editor's save). The tab gives the bar a channel of its own (`card/useCardFileGlow.ts`); an embed has Checked in its head and the Glow of its page (`outsideGlowAt`).

## Why there is no `prosemirror-collab`

`prosemirror-collab` is built for edits that arrive as steps from a server, with a version number and a client id. Here every outside edit arrives as a whole file, so the edit is a diff of two files either way, and the file's mtime is the only version. ProseMirror's history already maps your undo steps through an `addToHistory: false` transaction, so ⌘Z keeps undoing only your typing. If edits ever arrive as steps (an edit tool that talks to the app, a live cursor), port `prosemirror-collab` then and replace `mergeExternal.ts`: the other two parts stay.

## Boards (YAZ-4279)

Drawings (`.excalidraw`) and diagrams (`.drawio`) follow the same idea: a base, the user's edits and the outside edit, merged three ways, and the conflict bar only for a real clash. The parts are their own, because a board is shapes, not text: `shared/boardMerge.ts` `mergeElements` (one property at a time) with `client/src/drawings/mergeScene.ts` for a drawing, draw.io's own `mergeFile` behind our overlay's `yaseenMerge` for a diagram, and `useDocumentHost`'s `merge` option as the one door. The outlines (`client/src/drawings/outsideMarks.ts`, the overlay's `markCells`) are timed by the same Glow setting. See rules 36, 37 and 44 in `docs/CONTRACTS.md`.
