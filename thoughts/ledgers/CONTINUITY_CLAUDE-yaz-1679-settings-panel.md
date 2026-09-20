# CONTINUITY — YAZ-1679 Settings Panel

## Goal
- Replace the 220px settings popover with an Obsidian-style centered dialog: left nav of pages + search, right pane. Same 11 settings, no new ones, persistence untouched. Hotkeys reference folded in as a page. `⌘,` + app-menu item open it. Done = Yasin says "approved, lock it in" on the demo → decisions posted to YAZ-1679 → sub-issues created from Yasin's next prompt → implemented → merged.

## Constraints
- Scoped via `_code-wiki/Linear-Simpler` (few plain parents, concrete children, phase 1 = scope-only comment issue, last phase = polish/anti-slop).
- Architecture decisions go to Yasin as problem / options / recommendation / line-numbered diff. Bugs and small calls are mine.
- Prototype lives ONLY in the worktree; main is never touched. No commits until approval, then `/commit` (no Claude attribution). Never `npm run e2e` while Yasin is at the computer.
- Dev app: `YASEEN_DOCS_USER_DATA_DIR=<profile> npx electron-vite dev` from `desktop/`, NO `--watch`.
- Nothing posted to Linear until Yasin says "approved, lock it in".

## Key Decisions (LOCKED — comments on YAZ-1679)
- D1 hand-rolled modal (DrawingModal pattern + focus-restore), no Radix.
- D2 one registry `client/src/settings/registry.tsx` (sections → groups → rows, metadata + `render(ctx)`), drives nav, page and search.
- D3 ONE scrolling page (H1 sections, H2 groups); nav = scroll anchors + scrollspy; Hotkeys is a `standalone` page below a divider.
- D4 dialog mounted in App; sidebar cog is a dumb button; `⌘,` + app menu via the `menuSettings` pipeline.
- D5 HotkeysButton deleted; Hotkeys page is searchable.
- D6 search: nav-top input, hits under `Section › Group` breadcrumbs, `matchLinkCandidates` reuse, two-stage Escape.
- D7 `data-setting="<id>"` on every row; tests/e2e anchor on it.
- D8 visuals: groups are cards, hairlines only between rows, no toggles; segmented for short options, `<select>` for sentence-length ones; DL6 size.
- Testing: NO Playwright on Yasin's machine, ever; e2e specs updated but not run; manual runs in the demo vault.

## State
- Done:
  - [x] Main current at `9812cd1`; worktree on branch `yaz-1679-settings-panel`, deps installed
  - [x] D1–D8 decided; prototype built in 5 live rounds (pages → one page → hotkeys page → cards → select → bigger); Yasin: "approved, lock it in"
  - [x] Decisions D1–D8 + DL1–DL8 posted on YAZ-1679; tree YAZ-1681…1693 created with descriptions + per-issue comments
  - [x] 1- YAZ-1681 · 2- YAZ-1682 + 2A–2D · 3- YAZ-1687 + 3A/3B/3C (Yasin: "it worked… i trust you") · 4A YAZ-1692 audit posted
  - [x] 4B YAZ-1693 applied (every `do` item; 4069/4069; typecheck + desktop tsc clean); demo folder deleted, generator kept
- Now: [→] CLOSEOUT — commit via /commit, merge origin/main into the branch, push, open PR; master handoff on YAZ-1679 + pointer comments on every child; YAZ-1679 → In Review
- Next: Yasin says "merge it" → merge PR → 4B/4-/YAZ-1679 Done → remove worktree + branch. NO release unless asked.
- Remaining:
  - [ ] merge to main (held for Yasin's explicit go — his closeout note said not to merge) · [ ] worktree/branch removal after merge

## Open Questions
- Resolved: Appearance holds Spacing (Line spacing + Space between blocks); size locked at DL6.
- UNCONFIRMED: 3C sign-off after the × fix and instant scroll (asked in the YAZ-1690 comment).

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1679-settings-panel`
- Demo: `/Users/yasin/Desktop/yaz-1679-demo/` (`run-demo.sh`, `seed-profile.mjs`, `app-profile/`, three `Settings Panel YAZ-1679*` vaults); dev log `/tmp/yaz1679-dev.log`
- Linear helpers: scratchpad `linear_ops.py` (`comment`, `comments`, `issue`), `state.py <id> <todo|progress|review|done>`, `tree_ids.json`; issue id `df04af3e-86c8-449f-b446-fa3b5c7a2cef`, project `Yaseen Docs App`, team `YAZ`
- Verify: `/opt/homebrew/bin/npm run typecheck` · `npx vitest run`
- Key files: `client/src/settings/{SettingsDialog,SettingsButton,SettingRow,controls,registry}.tsx`, `searchSettings.ts`, `settings.css`; `client/src/App.tsx`, `client/src/sidebar/Sidebar.tsx`; `desktop/src/{channels.ts,main/menu.ts,preload/index.ts}`; `shared/types.ts` (MenuApi); `client/src/hooks/useMenuEvents.ts`; `docs/CONTRACTS.md`
