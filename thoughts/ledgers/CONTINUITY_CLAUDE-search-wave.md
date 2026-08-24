# Continuity — Search Wave (YAZ-739 ⌘K Search)

## Goal

Ship YAZ-739 end-to-end: sidebar top bar (file + search icons), title-only search pane, ⌘K accelerator — merged to main with full gates green (typecheck, unit incl. perf project, full e2e suite), all Linear issues Done with decisions/learnings recorded as comments, and an anti-slop polish pass (F1/F2) completed. "Done" = Yasin can hit ⌘K in the installed app, type a title or alias, and open the note — and the code reads like the codebase wrote it.

## Constraints

- 🔒 Rulings on YAZ-739 (D1 sidebar-view · D2 file+search icons ONLY, no filter · D3 shared matcher + cap param, basename+aliases · D4 menu accelerator pipeline). Never contradict silently.
- Builders: Opus 5 (model: "opus" via fable-builder agent type = high effort). Fable (me) does: scope pass, specs, code review of every builder diff, decision-making, F1 audit. I am accountable for code quality and slop — reject/redo builder output that is verbose or half-cooked; escalate to Fable-built only if Opus can't hit the bar.
- Linear hygiene: parent YAZ-739 In Progress while working; each subissue In Progress at start, Done at completion; decisions/gotchas as comments; new tasks filed as B1-/C1- style children.
- Commit/push/merge-to-main authorized once complete. Worktree `.claude/worktrees/search`, branch `search`.
- Material NEW design/architecture decisions → Yasin in problem/options/recommendation/diff format. The three questions delegated to 0- (tree mount, index timing, focus mechanism) are mine to decide + record.

## Key Decisions

- 0- decided (recorded on YAZ-800): App owns `sidebarView` + `searchFocusSeq` (Sidebar unmounts when collapsed — Sidebar-local view state has a stale-mount bug); tree = conditional render (lossless, state lives in Sidebar); index = fetch-on-open + watch refresh; ⌘K un-collapse is GLOBAL (D9 semantics, accepted); matcher goes generic `<T extends {name, lower?}>` + cap param (no fabricated `insert` on search candidates); search module home = `client/src/search/`.
- Obsidian confirmed: QS matches filename+aliases, path only for duplicates, ⏎-creates-on-no-match stays OUT of v1.
- e2e: genVault aliases are random (`chance(0.15)`) — E- seeds its own deterministic alias note.

## State

- Done:
  - [x] Scoping: tree YAZ-800–809 created, rulings locked
  - [x] 0- YAZ-800 scope pass (findings comment posted)
  - [x] RE-SCOPE (KM architecture landed): D1→persistent bar, D2 void, D3/D4 survive, results = FLAT list (ruling `#comment-9e53298c`); A/C/D/E descriptions rewritten; Row 1 deferred to 797 wave; focus = pendingSearchFocus handshake; Esc = clear-then-blur; query state in Sidebar
  - [x] B- YAZ-802 engine — Done, commit `b6241c7` (generic matcher + cap; 11 tests + perf smoke; suite 1618 green)
  - [x] YAZ-683 package-lock sync — commit `affe1d4` (close at merge)
  - [x] A- YAZ-801 persistent bar — Done, `b0fdcc7` (suite 1627)
  - [x] C- YAZ-803 flat results — Done, `52967c5` (+19 tests; F1 note: clamp `selected` when results shrink)
  - [x] D- YAZ-804 ⌘K wiring — Done, `7bb08c0` (suite 1650; OPEN human check: real ⌘K in editor/base/collapsed — recorded on 804)
  - [x] E- YAZ-805 e2e — Done, `7c9663c` (85/85 FIRST run, no flakes; filed YAZ-811 latent easyWave closeAllTabs hang)
  - [x] F1 YAZ-808 audit (Fable) — 4 findings, all apply: lazy index feed · clamp selected · reuse SearchIcon · CONTRACTS.md ×3
  - [x] F2 YAZ-809 — Done, `5693192` (all 4 findings; async type() helper; CONTRACTS clauses)
  - [x] MERGED TO MAIN `65b7739`, pushed; worktree/branch `search` deleted
  - [x] Linear closed: 739/683/F/F2 Done; 📦 closeout on 739; project update posted
- **WAVE COMPLETE.** Open after close: human ⌘K check (YAZ-804) · YAZ-811 (easyWave closeAllTabs) · YAZ-807 Future inline search. Final gates on merged tree: typecheck ×3 clean · 1653 unit · 85/85 e2e.

## Working Set

- Worktree: `.claude/worktrees/search` (branch `search`, from `01e95c7`)
- Linear UUIDs: scratchpad `tree_739.json`; helper `lin.py` (env `~/Desktop/growprofit-ai.env`)
- Gates: `npm run typecheck` · `npm test` (unit + perf projects) · e2e suite (see package.json)
- Key files: client/src/sidebar/Sidebar.tsx · client/src/links/completion.ts · desktop/src/main/menu.ts · desktop/src/preload/index.ts · client/src/hooks/useMenuEvents.ts · client/src/App.tsx · HotkeysPanel.tsx

## Open Questions

- UNCONFIRMED: e2e alias fixture — does the e2e vault already have a note with frontmatter aliases, or does E- need to seed one?
