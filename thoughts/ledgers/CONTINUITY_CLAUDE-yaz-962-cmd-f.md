# Continuity: YAZ-962 CMD+F in-page find

## Goal
Ship Chrome-style CMD+F on both editor surfaces (normal pages + folder-page outline view): light-yellow all-match highlights, darker active match, "N of M" counter, Enter/Shift+Enter cycling, Esc close, and folds containing matches auto-expand (restore on close, landing path stays open). Done = all five subissues (YAZ-967..971) Done in Linear with evidence, full suite green, merged and pushed to main.

## Constraints
- Locked decisions live in the YAZ-962 comment (D1 surfaces, D2 hand-rolled decoration plugin — no new deps, D3 fold/Esc rules).
- Find + fold-reveal transactions must be metadata-only: a search session never dirties the markdown on disk.
- Model split: Opus 5 implements from tight briefs; Fable owns scope, tests (written first), diff review, and quality. Fable escalates real architecture decisions to Yasin instead of deciding on the fly.
- Use the /commit skill for commits (no Claude attribution). Merge + push to main at the end (permission granted).
- Keep Linear live: statuses (parent + child In Progress/Done), comments for decisions, learnings, gotchas.

## Key Decisions
- Hand-roll the find plugin modeled on prosemirror-search's design; do NOT install it (duplicate-ProseMirror risk with Milkdown's bundled internals).
- Fold-reveal drives outlineFolding's existing FoldSetMeta door; restore-on-close except the active-match fold path.
- One shared React FindBar mounted in both hosts; plugin owns all logic.

## State
- Done:
  - [x] Setup: worktree `worktree-yaz-962-cmd-f`, Linear helper, subissues created
  - [x] YAZ-967 A- Deep scope pass (findings + confirmed contract locked as Linear comments; zoom.ts needs NO edit — getZoomedItemPos already exported)
- Done (cont.):
  - [x] YAZ-968 B- Find engine (Opus built; Fable verified 11/11 + 129 outline tests, NUL-scan clean, diff reviewed; 2 deviations approved: jsdom MacIntel platform, markdownUpdated compares post-processed forms)
- Now: [→] YAZ-969 C- FindBar + host wiring (Opus building in background against FindBar.test.tsx)
- Remaining:
  - [ ] YAZ-970 D- Verify end to end (spec ALREADY AUTHORED at desktop/e2e/findInPage.spec.ts, desktop tsc clean; run after C)
  - [ ] YAZ-971 E- Polish and anti-slop pass (evidence, not vibes)
  - [ ] /commit, push, merge to main; Linear all Done

## Open Questions
- UNCONFIRMED: exact e2e harness entry point (find during scope; same harness as YAZ-954).

## Working Set
- Worktree: /Users/yasin/Documents/GitHub/yaseen-milkdown/.claude/worktrees/yaz-962-cmd-f (branch worktree-yaz-962-cmd-f)
- Linear helper: scratchpad/linear.py (state | comment | create | get)
- Key files: client/src/editor/createCrepe.ts, client/src/editor/outline/outlineFolding.ts, client/src/editor/Editor.tsx, client/src/views/view/OutlineEditor.tsx
- Tests: npx vitest run (root vitest.config.ts); e2e per scope findings
