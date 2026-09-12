# CONTINUITY — YAZ-1514 done tasks strikethrough

## Goal
A checked task (`[x]`) reads as done: its own first line is struck through and dimmed. Visual only (CSS), the file never changes. Covers `Mod-Enter`, the ☑ click, and files already `[x]` from Obsidian. Ship via the project's normal tree (1- Scope · 2- Build · 3- Prove it · 4- Polish → 4A- Release) AFTER Yasin says "approved, lock it in" on the live demo.

## Constraints
- D1 (recommended, NOT yet locked): CSS only, no `~~` marks written. Defaults: strike + dim (55% of text colour), first line only, children untouched.
- Nothing posted to Linear until Yasin says "approved, lock it in". Then: 🔒 decisions comment on YAZ-1514, then subissues per the prompt Yasin gives next.
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs/.claude/worktrees/yaz-1514-done-strike`, branch `yaz-1514-done-strike` off main `369460d`. Electron binary was installed by `node node_modules/electron/install.js` (npm ci skips it).
- npm at `/opt/homebrew/bin/npm`; suites from the worktree ROOT. Commits only via /commit, none yet (prototype is uncommitted, like YAZ-1480's).
- Demo: vault `~/Desktop/Todo markoff should also strikethrough` (18 notes, `00 START HERE.md` is the index); profile `<scratchpad>/profile-yaz-1514` seeded by `<scratchpad>/seed-profile.ts` via `npx vite-node`; launch `YASEEN_DOCS_USER_DATA_DIR=<profile> npm run dev` from the worktree root (HMR: CSS edits land live). Delete the vault when moving to subissues.

## Key Decisions
- Test proves the rule's OWN selector (read from bullets.css) matches the live DOM; query from `document`, not the root — jsdom's engine drops `:has()` chains scoped to the root. Wait 50ms after mount (node views reset the caret once on mount) and one tick after a press (Vue repaints the label class async).

## State
- Done:
  - [x] Scope findings (chat) · proposed tree · D1 presented
  - [x] Prototype: `bullets.css` rule + `doneStrike.test.ts`; typecheck clean; outline suites green
  - [x] Demo vault + isolated profile + dev app running
  - [x] Yasin: "approved, lock it in" (defaults stood: 55% dim, first line only)
  - [x] Linear tree: YAZ-1517 1- Scope · YAZ-1518 2- Build · YAZ-1519 3- Prove it · YAZ-1520 4- Polish → YAZ-1521 4A- Release; 🔍 + 🔒 comments on YAZ-1514
  - [x] 2- Build — db2260b (bullets.css rule + doneStrike.test.ts + CONTRACTS rule 9/Mod-Enter row); full suite 3695 green, typecheck clean
  - [x] 3- Prove it — evidence = the live demo approval (CSS byte-identical to what was approved)
  - [x] 4- Polish and anti-slop — reviewer's 10 findings triaged (9 accepted, 1 declined with reason) → 542b215; suite 3696 green, typecheck + build clean
  - [x] 4A- Release — PR merged to main, NO version bump (batched into the next release); demo vault, profile, worktree removed
- Now: COMPLETE — all of YAZ-1514 Done in Linear; handoff comment on the parent
- Next: nothing
- Remaining: none

## Open Questions
- DECIDED: dim 55%, second paragraph unstruck — Yasin approved the demo as-is.

## Working Set
- Files: client/src/editor/outline/bullets.css, client/src/editor/outline/doneStrike.test.ts
- Tests: `npx vitest run client/src/editor/outline/doneStrike.test.ts client/src/editor/outline/hotkeys.test.ts`; gates `npm test`, `npm run typecheck`
