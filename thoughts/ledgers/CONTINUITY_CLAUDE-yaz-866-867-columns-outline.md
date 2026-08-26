# Continuity: YAZ-866 columns + YAZ-867 free-form outline

## Goal
- All 11 subissues (YAZ-895..905) implemented, unit + e2e suites green, merged and pushed to main, every Linear issue Done with evidence comments. Success = both features work in the real app exactly as the locked scoping comments describe.

## Constraints
- Execution model: Opus 5 (high) implements; Fable oversees, reviews every diff for slop/excess, owns tests and code quality.
- TDD: tests specified/reviewed before implementation is accepted.
- One `folder_page_settings` write per interaction (🔒 D3). Values never migrated on type change (C1). Storage D2 (`views[i].outline` markdown). Editor reuse F3 (bullets-only Crepe instance). Membership sync E1 (auto-tag/untag, children declare).
- Commit via /commit skill (no Claude attribution). Worktree: `.claude/worktrees/yaz-866-867-columns-outline`, branch `worktree-yaz-866-867-columns-outline`.
- Linear kept live: statuses (parent + subissue), decision/learning comments as work lands.

## Key Decisions
- See locked scoping comments on YAZ-866 / YAZ-867 (2026-08-25) — authoritative.
- 867-D flagged boundary: nested folder pages don't auto-expand inline in v1 (glyph + count stay).

## State
- Done:
  - [x] YAZ-895 write door (in c26df20)
  - [x] YAZ-896 add column UI (c26df20)
  - [x] YAZ-897 edit type UI (5f4fc17)
  - [x] YAZ-898 columns e2e (91f9cc8)
  - [x] YAZ-899 columns polish (6b84e72) — YAZ-866 PARENT DONE
  - [x] YAZ-900 outline field/parse (f51001a)
  - [x] YAZ-901 bullets-only editor (ed39155)
  - [x] YAZ-902 membership sync (6fe589e)
  - [x] YAZ-903 view swap + contract + search/documentView fix (7e52048; full unit suite 1821 green)
  - [x] YAZ-904 outline e2e (97e64df; full e2e green, found the Topics-tree ordering seam)
  - [x] YAZ-905 outline polish (b4108bc; seam closed — outlineOrderOf reads the document) — YAZ-867 PARENT DONE
- Now: [→] merge worktree branch to main, push
- Note: cancel-the-sheet keeps membership without re-inserting text (flagged to Yasin, no objection yet); nested auto-expansion dropped per scoping flag; e2e suite has a pre-existing occasional load flake (different spec each time, green in isolation, two complete 119/119 runs post-fix).

## Working Set
- Branch: worktree-yaz-866-867-columns-outline
- Tests: `npm test` (vitest, repo root), `npm run e2e` (Playwright, desktop/)
- Key files: client/src/views/{folderPageSettings,viewSchema,FolderPageContents}.ts(x), client/src/views/view/{PropertiesMenu,OutlineView,TableView}.tsx, client/src/editor/{wikilink,outline}/, docs/CONTRACTS.md
