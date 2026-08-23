# Continuity — Easy wave (YAZ-672/721/738/741/743/744)

## Goal
All six umbrellas Done and merged to `main`, each with: locked contract implemented, unit tests written by the orchestrator passing, e2e where specified, polish audit+execute closed, Linear statuses/comments current. Gates at close: typecheck clean, unit ≥ 1531 green, e2e green.

## Constraints
- Worktree `.claude/worktrees/easy`, branch `easy`. Builders = Opus 5 (`general-purpose`, model opus); Fable orchestrates, reviews every diff, writes/approves tests, commits. Builders do NOT commit.
- Never re-open 🔒 rulings on 721/741/744. New decisions → Yasin in problem/options/rec/diff/after format.
- Linear: parent + child In Progress when starting a unit; Done when gates pass; learnings as comments. UUIDs in scratchpad tree_*.json.

## Key Decisions
- D1 721 path-keyed history (Obsidian identity rejected). D2 arrows only. D3 Notion grid. D4 one toggle after Sort.

## State
- Done: EVERYTHING — wave complete, merged to main `9a1fc7f`, pushed. Units: 741 `034effc` · 672 `7e5cff2` · 743 `ad8a0f7` · 721A `1947608` · 744 `c84983d` · 738 `9017629` · 721B `13c24fb` · e2e `673c144` · polish `bf805cc`.
- Gates on merged main (after the parallel numbered wave `c1a705c` interleaved): typecheck clean · unit 1607/1607 · e2e 79/79.
- Open: YAZ-795 filed (Milkdown Timer teardown flake, guideLines.test.ts, pre-existing). 672's native popup deserves one human right-click.

## Open Questions
- none

## Working Set
- `npm run typecheck` · `npx vitest run` · `npm run e2e`
