# Continuity — numbered bullets wave (YAZ-719)

## Goal
Right-click on the 6-dot block handle opens a `.ctx-menu` popup whose first row "Number children" turns the hovered bullet's DIRECT child list into a numbered list (and back). Grandchildren stay bullets. Copy of that list yields literal `1. …` markdown. Done = YAZ-723..735 Done, all gates green (`npm test`, `npm run typecheck`, `npm run e2e`), merged to main, close-out comment on YAZ-719.

## Constraints
- LOCKED rulings: https://linear.app/growprofit/issue/YAZ-719/numbered-bullets#comment-21464566
  - A1 DOM popup in `$prose` plugin, `.ctx-menu` classes, mounted in `view.dom.parentElement`
  - B1 shared `blockHandleTarget.ts` probe from multiBlockDrag + `e.button !== 0` guard
  - C1 menu opens everywhere, row disabled when no direct child list; flip every direct child list; one transaction
  - **D2 NEVER strip / never auto-number. Text byte-identical.**
- Decisions beyond these → Yasin in problem/options/recommendation/diff/after format. Bugs → mine.
- Linear: move parent + child to In Progress on start, Done on finish; comments for decisions/learnings/gotchas; new tasks as A1b-style issues.
- Workflow: worktree `.claude/worktrees/numbered` branch `numbered`; commit via /commit skill; push + merge to main authorised.

## Key Decisions
- (see LOCKED)
- 0- findings: A2 must capture right-button mousedown+mouseup (Crepe's handle mousedown fires before contextmenu); `spread` copied from source list; `inside` not `pos` resolves the list_item; e2e clipboard via `app.evaluate(({clipboard}) => clipboard.readText())`.

## State
- Done: ALL — wave shipped to main `c1a705c` (8 commits), pushed, worktree + branch `numbered` deleted. YAZ-719 Done; closeout comment on it. Backlog: YAZ-747 A3 bug, YAZ-736 Future.
- Now: nothing
- Remaining: nothing

## Open Questions
- (none)

## Gotchas
- Raw `* 1) x` = nested ordered list in CommonMark; typed `1)` saves as `1\)`. Use escaped form in fixtures (C2).
- /commit skill not installed here → plain `git commit`, no attribution lines.

## Working Set
- Linear UUIDs: scratchpad `tree.json`; helper `lin.py`. Umbrella `680aab8e-2f83-4870-ac99-61c685cebb33`.
- States: Backlog 0d10f286-745c-4c7d-9d9f-62a0dd768327 · Todo 95e306d0-ff2a-45c2-a69a-dc20180d54ec · In Progress e5076f98-5404-4320-8119-4fc28e0967ce · Done ab9ae558-c408-45a9-98ea-397bd4abdd4a
- Tests: `npx vitest run client/src/editor/<file>.test.ts` in the worktree; e2e `npm run e2e`.
