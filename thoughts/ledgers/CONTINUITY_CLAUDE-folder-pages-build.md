# CONTINUITY — folder-pages build (YAZ-813 execution)

## Goal
Execute the entire YAZ-813 tree (issues 1- through 8-, 33 subissues) to Done: the folder-pages model built, the vault migrated, everything polished — **without burning Fable 5 credits where Opus 5 suffices, and without letting quality drop**. Done = YAZ-861's closing evidence comment on YAZ-813 and Yasin's sign-off.

## Constraints
- **Model strategy (Yasin, 2026-08-24):** Opus 5 (high effort) writes the implementation; Fable (main session) oversees — defines the test contract per subissue, reviews every diff for slop/excess, runs suites, fixes or bounces. Use Fable directly only where quality demands it (subtle semantics, architecture-adjacent code, final reviews). Fable is RESPONSIBLE for Opus's output quality.
- **The law:** YAZ-812 (v2.1) + the 🔒 comments on YAZ-814…823 + docs/CONTRACTS.md. Locks are executionary — do not re-decide. Anything that would touch a 🔒 → back to Yasin (problem/options/rec/diff format). Trivial bugs → decide in-flight, log in Linear comments.
- **Elegance ruling:** simpler, combined, minimal. **Anti-slop:** every issue ends with its polish subissue; evidence, not vibes.
- **Linear discipline:** starting a subissue → subissue AND parent to In Progress; done → Done. Comments carry decisions/learnings/gotchas. New tasks → 1B1-style sub-issues.
- **Git:** worktree `folder-pages-813` (branch worktree-folder-pages-813). Commit via /commit skill (no Claude attribution). Yasin pre-authorized: commit, push, merge to main. Merge to main after each parent issue completes; suites green at every merge.
- Terms in code: folder pages · belongs to · the lookup · Uncategorized · loop guard. Nothing named "membership"/"base"-flavored in new code.

## Key Decisions
- Sequential by canonical order (pinned on YAZ-813): 814 → 815 → 816 → 817 → 818(5.1→5.2→5.3) → 821 → 822 → 823. Parallel lanes exist (4-, 6-) but sequential keeps review quality high; revisit if pace demands.
- Per-subissue loop: statuses → Fable writes exact test-case contract into the Opus prompt → Opus implements (tests + code) → Fable reviews diff (tests honest? code minimal? terms right?) → suites → fix/bounce → Linear comment + Done → commit.

## State
- Done:
  - [x] Scoping phase: all 8 issues locked (~46 🔒), 33 subissues created
  - [x] Setup: worktree, Linear helper (scratchpad/lin.mjs), statuses, this ledger
- Done issues:
  - [x] 1- YAZ-814 COMPLETE + MERGED to main (adf0b25). 1A 77e0a7f · 1B ac1efcd · 1C cb923a4 (1.2ms/25ms) · 1D 1df7a67 (CONTRACTS Links entry) · 1E adf0b25 (term sweep; zero drift on six locks). Gotchas: worktrees need own npm ci; scalar folder_pages tolerated like extractLinks.
  - [x] 2- YAZ-815 COMPLETE + MERGED to main (4440933). 2A c9f6247 · 2B 0e092c8 (Fable direct) · 2C 75666c5 · 2D+2E 4440933. Zero corrections across 2A/2C; ripples filed on 835/836. Pre-existing 'membership' prose in engine.test.ts:226 left for 8B.
  - [x] 3- YAZ-816 COMPLETE + MERGED to main (150c780). Order was 3B→3A→3C→3D→3E. 3B c868c4d (−1663) · 3A da4d02e (properties.json) · 3C dac0291 (e2e 85/85) · 3D 057c908 (tombstones) · 3E 150c780 (vaultIndex/registry→live; 'registry' greps ZERO incl. tests). Gotchas: picker e2e gap filed on 819; bible fixture pages still carry inert page_type until 7-.
  - [x] 4- YAZ-817 COMPLETE + MERGED to main (721b69d). 4A c249a99 (toggle + ConfirmTurnBack; indexSource wiring) · 4B 1098d87 (New folder page, 4th EntryKind) · 4C+4D 721b69d (gestures contract; fixed pre-existing 5D atomicity lie). e2e 85/85 twice.
  - [x] 5- YAZ-818 COMPLETE + MERGED to main (5c60901). 5.1 9a798ce · 5.2 f27e2fa · 5.3 41929ad (−2,839) · 5.4 0782377 · 5.5 5c60901 (amputation; rung 2 wired; ViewTabs switch-only for real → CRUD parked 824). e2e 87/87.
  - [x] 6- YAZ-821 COMPLETE + MERGED to main (baa0794). 6A 98f8058 · 6B 3fc8359 · 6C 86c257a · 6D+6E baa0794. THE WHOLE APP SURFACE IS BUILT. e2e 98/98.
  - [x] 7- YAZ-822 COMPLETE. 7A 68aa029 (tools/migrateFolderPages.mjs — dry-run default, clean-tree gate, idempotent, four post-checks, 41 tests in its own `tools` vitest project) · 7C f9e7191 (the e2e fixture vault migrated BY THE SCRIPT ITSELF, so the fixtures and the migration can never disagree) · 7D ff99d9f (catches: templates' CONTENT migrates too; subdir-vault apply).
  - [x] 8A–8D, 8F, 8G. 8B 15ba133 (the dead word leaves the codebase — `bases` → `views`) · 8F 4f95f84 (the `confirmDelete` setting finally gates the sheet) · 8C 5ef0aa0 (crossCutting.spec.ts — six seams proven together; it FOUND the YAZ-859 counts-vs-chevron seam ruling) · 8G 4c62593 (the Topics context menu — the ⚡ amendment on YAZ-821) + 5c5381d (YAZ-864: renames rewrite nested settings links).
- Now: [→] 8E (YAZ-861) — executing the consolidated 8D audit worklist: the trivial-fix class (de-NUL the React keys, delete the unreachable ViewsPane branch + dead CSS, `.view-view` → `.views-pane`, `BASES_HOTKEYS` → `VIEW_HOTKEYS`, `basesFixture` → `viewsFixture`, the report-don't-block notes line) plus the CONTRACTS / README / LAUNCH truth-pass.
- Remaining:
  - [ ] 8E closing evidence comment on YAZ-813 + Yasin's sign-off (the Goal's definition of Done)
  - [ ] **TWO YASIN-GATED items, deliberately excluded from 8E** — do NOT execute without a ruling: (1) `walkFolderPage`'s deletion (the canonical linear walk, currently unused by any surface since every one of them recurses `guardedChildren` itself — but it is named in the D6 lock); (2) the `.obsidian/types.json` orphan chain (`IndexResponse.types`, `columnTyping`'s `types` param, `viewsFixture`'s write of that file).

## Open Questions
- UNCONFIRMED: `walkFolderPage`'s fate — every surface recurses `guardedChildren` directly, so the canonical linear walk has no caller; but D6 names it. Yasin-gated, NOT executed in 8E.
- UNCONFIRMED: the `.obsidian/types.json` orphan chain (`IndexResponse.types` → `columnTyping`'s `types` param → `viewsFixture`'s write). Reading a foreign app's config file is a product question, not a cleanup. Yasin-gated, NOT executed in 8E.
- Consciously LEFT in 8E, noted not asked: the `client/src/views/view/` DIRECTORY keeps its name (a rename is 33 files of churn for no truth gained — the files inside it are already honestly named).

## Working Set
- Worktree: .claude/worktrees/folder-pages-813 (branch worktree-folder-pages-813, from main d38369f)
- Vault for 7-: /Users/yasin/Documents/GitHub/business-wiki-MASTER (Yasin's dupe; canonical-copy confirmation pending at 7B)
- Linear helper: scratchpad lin.mjs (holds API key — NEVER commit)
- Test commands: npx vitest run (client/main projects), desktop e2e per repo scripts; check package.json scripts
- Canon: YAZ-812 · 🔒 comments per issue · docs/CONTRACTS.md · docs/mockups/folder-pages-mockup.html
