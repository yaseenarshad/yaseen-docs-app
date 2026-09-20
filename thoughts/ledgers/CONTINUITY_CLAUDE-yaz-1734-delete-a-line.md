# CONTINUITY — YAZ-1734 Delete a line (⇧↑ / ⇧↓ select whole lines)

## Goal
- Yasin's habit `⌘←` then `⇧↓` (or `⌘→` then `⇧↑`) must select exactly ONE whole line every time, one more line per repeat, so `⌫` removes exactly that line. Today the browser moves by pixel column and sometimes grabs part of the neighbour. Linear: YAZ-1734 (parent). Phase now: EXECUTION. Goal for this run: turn the approved prototype into merged main — every locked rule tested, the scenario matrix pinned as tests, docs true, polish pass done, PR merged, no release, rig removed — with Linear statuses/comments kept live and every new decision brought to Yasin in the agreed format.

## Constraints
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1734`, branch `yaz-1734-delete-a-line`, rebased onto main `6d98369` (2026-09-20, took YAZ-1709 + YAZ-1710). Yasin approved commit + push + merge to main; NO release. Commits via the `/commit` skill.
- No Playwright runs on Yasin's machine. Unit tests + typecheck + hand walkthrough in the isolated dev app (HMR, `YASEEN_DOCS_USER_DATA_DIR=<scratchpad>/profile-YAZ-1734`, vault `<scratchpad>/YAZ-1734 Delete a Line`; scripts `make-demo.mjs` / `run-demo.sh` in the session scratchpad — throwaway).
- House style: `$shortcut` keymap at priority 100 like `outline/hotkeys.ts`, JSDoc citing YAZ-1734 + D-n, docs (`docs/CONTRACTS.md` Keyboard row, `settings/hotkeys.ts` + its pin test, README) updated with the code.

## Key Decisions (recommended 2026-09-20, Yasin: "i like ur recommendations"; D4 dropped by Yasin; LOCK on Linear after demo approval)
- **Root cause.** No editor binding on `⇧↑`/`⇧↓`; the browser moves the head by PIXEL column, so from a block edge it lands mid-text on a neighbour that is less indented, a heading, or wrapped. ProseMirror's `handleKeyDown` runs before its own arrow logic, so a keymap fixes it.
- **D1 A "line" = the textblock** the caret is in (paragraph, heading, a list item's OWN text), never the visual row. A wrapped paragraph is one line.
- **D2 Override only on a block edge.** When the selection HEAD is at the start or end of its textblock, `⇧↓`/`⇧↑` move the head to the SAME edge of the next/previous textblock; anchor never moves; each press = one more whole line. Empty block: `⇧↓` takes start, `⇧↑` takes end. Falls through to native when the head is mid-line, the selection is a node selection, there is no neighbour (document edge), or a leaf block (image, rule) sits in between. One file `client/src/editor/lineSelection.ts` (`lineKeymap`), registered last in `createCrepe()` so all three editors get it. Deletion is the ordinary `⌫`/`Delete` (`deleteRange`): the line goes, the neighbour keeps its type.
- **D3 A deleted parent bullet's children survive**, joining up one level (the `deleteRange` join). Subtree delete = a different explicit gesture, out of scope, no Future issue.
- **D2 amended (Yasin, live demo 2026-09-20): head MID-LINE no longer falls through.** `⇧↓` first selects to the END of its own line, `⇧↑` to the START; the head is then on an edge and the next press continues one whole line per press. Native pixel-column move now only for node selections, document edges, and an `hr` in the gap.
- **D5 The way back retraces the way out (Yasin agreed to test, 2026-09-20).** A press towards the anchor never crosses it and always reaches it — even on the first/last line where no neighbour exists. `⇧↑` undoes exactly one `⇧↓`.
- **D6 The head only lands on a VISIBLE line** (proposed, pending Yasin's demo verdict). **D6 amended (Yasin, demo 2026-09-20): delete never touches hidden text.** `⌫`/`Delete`/typing over a range that spans folded lines removes only the visible pieces (explicit construction in `deleteVisible`: last block's tail joins the first block, whole visible blocks in between go via `deleteBlockAndEmptyWrappers`, hidden nodes untouched); a parent that lost all its text lifts its kids (D3). Folded-parent delete with kids = unfold first (or a future block gesture). Not covered yet: `⌘X` cut and Enter over such a range (ordinary path) — flagged on demo page 07. Hidden = inside a folded bullet's subtree (`collapsedItemsHiding`), a folded heading section (`collapsedHeadingsHiding`), or outside the zoom (`getZoomedItemPos`) — plugin STATE, the same values the `display:none` decorations come from, no DOM. Document/zoom edge with nothing visible beyond = consumed no-op (never hand native a step into hidden DOM); an `hr` in the gap still falls through to native.
- **D7 (Yasin: "go with your recommendation", 2026-09-20): Enter over a fold-spanning range is covered; ⌘X is not, on purpose.** `enterVisible` = `deleteVisible()` then RE-PRESS Enter on the view (`view.someProp('handleKeyDown')`) so the ordinary Enter splits at the fresh caret. Gotcha: Milkdown's keymap hands every handler of one key the SAME pre-dispatch state — "dispatch then decline" silently fails (the outliner saw the old non-empty selection; Crepe's list split then moved the kids under the new item). `lineKeymap` registered BEFORE `outlinerKeymap`. ⌘X MOVES the whole range incl. hidden kids; paste restores them — documented.
- **D4 No new hotkey.** `⌘⇧K` delete-line was recommended and dropped (Yasin): `⌫` after D2 already does it.
- Power-user answer: `Home`/`⌘←` + `⇧↓` is a code-editor trick (column 0 always same x); unreliable in rich text. Elsewhere: `⌘⇧K` (VS Code/Sublime), `⌘D` (Obsidian), `Esc` `⌫` (Notion/Logseq).

## Linear tree (created 2026-09-20, Linear-Simpler)
- YAZ-1734 parent (In Progress) · 🔒 LOCKED D1–D6 comment `3437f11e` · scenario-matrix comment `da377a40`.
- YAZ-1744 1- Scope (Done, findings comment) · YAZ-1745 2- Build → YAZ-1746 2A selection rules · YAZ-1747 2B delete rules → YAZ-1748 2B1 Enter/⌘X (D7 pending) · YAZ-1749 2C docs · YAZ-1750 3- Verify → YAZ-1751 3A scenario-matrix test · YAZ-1752 3B Yasin's hand pass · YAZ-1753 4- Polish → YAZ-1754 4A audit · YAZ-1755 4B apply · YAZ-1756 Future: block selection mode.
- Linear ids: team `bd7cb72d-9e31-468e-912b-d4c58a2e20b1`, project `a2cc392a-27d1-4949-a27c-3429586db7df`, In Progress `e5076f98-5404-4320-8119-4fc28e0967ce`, Done `ab9ae558…` (query team states).

## State
- Done:
  - [x] Scope pass in chat (2026-09-20): code read, D1–D4 recommended, tree proposed; Yasin approved, dropped D4.
  - [x] Linear comment on YAZ-1734 (id `3437f11e-…`) holds D1–D4 marked PENDING DEMO.
  - [x] Worktree + `npm install`; demo vault + profile built.
  - [x] Prototype built (agent): `lineSelection.ts` = `lineKeymap` (D2) + `liftHeadlessItems` `$prose` appendTransaction (D3: a `list_item` whose first child is a list is never a resting state — its children lift one level; path-agnostic, also fixes the same state from any other delete). 20 tests + hotkeys pin; `client/src/editor` 827/827; typecheck clean. Electron binary had to be copied from the main repo's `node_modules/electron/dist` (worktree install skips the postinstall).
  - [x] Demo running: `run-demo.sh` (HMR) on profile-YAZ-1734, vault "YAZ-1734 Delete a Line"; scenario list S1–S23 posted in chat.
  - [x] Yasin's walkthrough done; D2 amended (mid-line), D5, D6 (visible lines + delete never touches hidden text) — "approved, lock it in" 2026-09-20. Locked on Linear; tree created.
  - [x] Execution: rebased on `6d98369`; quality pass on `lineSelection.ts` (one `deleteVisible(text)` door, lift arithmetic, unused import). 40 tests green, typecheck clean.
  - [x] 2A, 2B, 2B1 (D7), 2C Done; 3A Done (44 scenario tests; S17 code block = a line, S18 table = head never enters, `prosemirror-tables` normalises back to the paragraph above selected whole, S-Z3 zoomed title = visible line, S23 empty bullet keeps kids). 66 files / 989 tests green, typecheck clean.
- Now: [→] 4A audit (agent reads every changed file; I add verdicts) → 4B apply.
- Next: 3B Yasin's hand pass on the final build (relaunch `run-demo.sh`, "go do this") → /commit, push, PR, merge (no release) → ledger closeout, HANDOFF comment on YAZ-1734 + children, rig + worktree removed.
- Next: on "approved, lock it in" → update the Linear comment to LOCKED (+ any demo amendments) → sub-issues per Yasin's prompt.
- Remaining:
  - [ ] Delete demo vault/profile when moving to subissues.

## Open Questions
- NOTE (agent probe): in the folder-page outline (bullets-only schema `paragraph bullet_list?`) a start-of-parent delete leaves an EMPTY bullet keeping its kids (no lift possible there); doc stays valid. Decide in the demo (S23) whether that matters — rows there are pages, not free text.
- RESOLVED (3A S23): `⇧↓` on a member row behaves like a line; deleting a parent row leaves an empty bullet keeping its kids (bullets-only schema cannot drop the row); doc stays valid.
- RESOLVED (3A S17/S18): a code block is a line (head lands at the start of its text); above a table the head never enters it (`prosemirror-tables` rewrites the selection to the paragraph above, whole). Neither harmful; pinned in the matrix and the CONTRACTS row. Images are INLINE atoms (ImageBlock off): an image line is an ordinary line; only `hr` is a leaf block.

## Working Set
- `client/src/editor/lineSelection.ts` (new) · `client/src/editor/lineSelection.test.ts` (new) · `client/src/editor/createCrepe.ts` (registration) · `client/src/settings/hotkeys.ts` + `hotkeys.test.ts` · `docs/CONTRACTS.md` Keyboard table · `README.md`.
- Tests: `npx vitest run client/src/editor/lineSelection.test.ts` · `npm run typecheck`.
