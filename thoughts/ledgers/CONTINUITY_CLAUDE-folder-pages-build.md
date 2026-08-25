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
- Now: [→] 1- YAZ-814: 1A (YAZ-825) folderPages.ts — Opus implementing, Fable reviewing
- Next: 1B (YAZ-826) walker → 1C (YAZ-827) perf test → 1D (YAZ-828) contracts → 1E (YAZ-829) polish → merge 814 → start 815
- Remaining:
  - [ ] 2- YAZ-815 (2A–2E)
  - [ ] 3- YAZ-816 (3A–3E)
  - [ ] 4- YAZ-817 (4A–4D)
  - [ ] 5- YAZ-818 (5.1–5.5)
  - [ ] 6- YAZ-821 (6A–6E)
  - [ ] 7- YAZ-822 (7A–7D) — 7B needs Yasin (canonical-copy + dry-run approval)
  - [ ] 8- YAZ-823 (8A–8E) — 8D needs Yasin (dogfooding)

## Open Questions
- UNCONFIRMED: none right now — locks cover the build. Yasin checkpoints ahead: 7B gates, 8D dogfooding.

## Working Set
- Worktree: .claude/worktrees/folder-pages-813 (branch worktree-folder-pages-813, from main d38369f)
- Vault for 7-: /Users/yasin/Documents/GitHub/business-wiki-MASTER (Yasin's dupe; canonical-copy confirmation pending at 7B)
- Linear helper: scratchpad lin.mjs (holds API key — NEVER commit)
- Test commands: npx vitest run (client/main projects), desktop e2e per repo scripts; check package.json scripts
- Canon: YAZ-812 · 🔒 comments per issue · docs/CONTRACTS.md · docs/mockups/folder-pages-mockup.html
