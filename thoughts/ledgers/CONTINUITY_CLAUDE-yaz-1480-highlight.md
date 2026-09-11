# CONTINUITY — YAZ-1480 highlight mark

## Goal
Ship YAZ-1480 to main: `==text==` highlight (Obsidian syntax, vendored micromark tokenizer) with three named colours (`<mark class="highlight-<name>">`), four one-click toolbar swatches after Strikethrough, `Mod-Shift-h` (yellow), the `==x==` typing rule, a translucent wash on every Crepe surface; every 🔒 decision implemented exactly; typecheck + FULL vitest suite + build green; Linear tree (YAZ-1504–1510) fully updated with statuses, rationale, learnings, evidence; Yasin stress-tests the final demo on an isolated profile BEFORE the merge to main.

## Constraints
- Decisions are LOCKED as the 🔒 comment on YAZ-1480 (D1 syntax+tokenizer, D2 formatting group, D3 wash token, D4a colour attr + `<mark class>`, D4b one swatch per colour, defaults incl. the FINAL escaping rule "any `=` touching another `=` → `\=`"). Child descriptions 2A (YAZ-1506) / 2B (YAZ-1507) carry the contract. Anything touching a 🔒 ruling goes back to Yasin first (problem / options / recommendation / diff / after).
- Elegant/minimal: smaller wins, never at the expense of what is right. No new deps beyond the five declared (all already hoisted).
- Tests first. Verification = unit tests + typecheck + pointed real-app checks. NO Playwright.
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-milkdown/.claude/worktrees/yaz-1480-highlight`, branch `yaz-1480-highlight` off main `fb58fef`. Pin `cd $W &&` in every command; suites from the worktree ROOT; npm at `/opt/homebrew/bin/npm`.
- Commits via the /commit skill (no attribution lines); one commit per child; merge to main via PR after Yasin's demo verdict; ASK before `npm version`.
- Linear: parent + child → In Progress together when a child starts, Done when finished; new tasks become `2C-` / `2A1-`; comments carry decisions, learnings, gotchas, evidence. Helper: scratchpad `lin.mjs` (`plan <json>` / `state <key> <State>` / `comment <key> <file>` / `tree YAZ-1480`), ids in scratchpad `ids.json`.
- Demo: `~/Desktop/Highlight feature` (19 notes + `paste-source.html`); profile seeded by scratchpad `seed-profile.ts` via `vite-node`; launch `YASEEN_DOCS_USER_DATA_DIR=<profile> npm run dev` from the worktree.

## Key Decisions
- D1 `==text==` + vendored gfm-strikethrough tokenizer (`=`, run of two) · D2 `getGroup('formatting')` after Strikethrough · D3 `--mark-bg` translucent, `color: inherit`, `.milkdown .ProseMirror mark` · D4a ONE mark, `color` attr, null=`==`, named=`<mark class="highlight-<name>">` via shared `htmlPairs.ts` · D4b four dots, click applies / lit removes / other switches, no state · `Mod-Shift-h` yellow · typing rule yellow, spaced never · escaping: any `=` touching `=` → `\=` (complete beats byte-pure; the flanking-aware version lost marks) · bare `<mark>` → yellow → `==` · nested highlight-in-highlight ends the outer (documented, not fixed) · D5 (Yasin on the 3- demo): a dot is lit when ANY of the selection carries its colour (Bold's rule); lit → `removeMark` of exactly that colour, unlit → `addMark` (replaces any other) — `rangeHasHighlight` replaced `selectionHighlightColor`.

## State
- Done:
  - [x] 1- Scope (YAZ-1504) — findings + 🔒 + agreements on YAZ-1480; prototype green (3533) and approved on the live demo
  - [x] 2A- The mark and its colours (YAZ-1506) — commit b74d4f5; coordinator review + two "smaller" tweaks (classList one-liner, no double cast); 72 focused tests green
  - [x] 2B- Swatches and the wash (YAZ-1507) — commit 4015682; full suite 3533 green; build green; branch pushed
  - [x] 3- Prove it (YAZ-1508) — Yasin's pass: D5 (28c6c30) + lit swatch as pressed button (01d5786), "that's better, keep going"
- Now: [→] 4- Polish (YAZ-1509) — reviewer's 42 findings triaged; accepted fixes committed (caret via stored marks, markApplies guard, edge-whitespace trim, wikilink `\=` un-escape, keymapRef labels, regex from HIGHLIGHT_COLORS, dead lookahead, phantom import, header trim, CONSTRUCTS_WITHOUT_HIGHLIGHT; tests: markTestKit, dedup, 8 new cases); final gates then triage comment
- Next: 4A- PR, Yasin's go (+ bump question), merge, closeout, cleanup
- Remaining:
  - [ ] 4A- Release (YAZ-1510) — push, PR, Yasin's verdict, merge, closeout, cleanup

## Open Questions
- UNCONFIRMED: Yasin's on-screen reactions to dots-vs-marker and the four shades (collected in 3-). DECIDED D5: lit = any of the selection carries the colour.
- UNCONFIRMED: bump `npm version` in this run or batch (ask at 4A).

## Working Set
- Files: client/src/editor/marks/{highlight,htmlPairs,underline}.ts, client/src/editor/createCrepe.ts, client/src/app.css, client/src/sidebar/HotkeysPanel.tsx, docs/CONTRACTS.md (rule 31), client/package.json
- Tests: `npx vitest run client/src/editor/marks/highlight.test.ts client/src/editor/marks/underline.test.ts client/src/editor/headingToolbar.test.ts client/src/editor/roundtrip.test.ts client/src/sidebar/HotkeysPanel.test.ts`; gates `npm test`, `npm run typecheck`, `npm run build`
