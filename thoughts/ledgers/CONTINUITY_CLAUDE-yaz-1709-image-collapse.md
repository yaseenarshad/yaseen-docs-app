# CONTINUITY — yaz-1709-image-collapse

## Goal
- Ship "image collapse" (YAZ-1709) to main: a bullet holding an image folds like a parent (⌘↑ / chevron / corner button) to a fixed one-line thumbnail chip that is exactly a text row tall; thumbnail click / ⌘↓ / chevron expand; fold state view-only; lightbox pages through every image on the page (← → + `n / m` pill). Merged PR, Linear tree YAZ-1718…1728 Done, demo scaffolding gone. No release.

## Constraints
- Decisions D1–D5 + demo learnings DL1–DL8 are LOCKED (comments on YAZ-1709). Architecture changes go to Yasin in problem/options/recommendation/diff/after format.
- NEVER run Playwright / `npm run e2e` (Yasin is at the computer). Verification = unit tests, screen measurements, Yasin's pointed tests in the dev app on the isolated profile. Specs may be written, not run.
- House rules: header comments say WHY; decorations-first; the image node view never touches the serializer; `roundtrip.test.ts` byte-identical; fold never writes markdown.
- Commit with `/commit` (no Claude attribution). Push + PR + merge to main approved. No release unless Yasin says so.
- Linear: parent + phase + child → In Progress when starting; Done when complete; new work → `2B1-`-style children; decisions/learnings/gotchas → comments.
- Demo dev app: `~/Desktop/yaz-1709-demo/run-demo.sh` (isolated profile, HMR, no `--watch`).

## Key Decisions
- See YAZ-1709 comments. Summary: foldable = owns nested list OR holds an image; chip = thumbnail only, fixed box sized from `--edit-line-height`, top-aligned (row height measured identical); thumbnail-only click expands; corner fold button top-left; alt text = fold identity (invisible); `--image-width` custom property; gallery built by walking the doc at double-click.

## State
- Done:
  - [x] 1 YAZ-1718 scope (comments on YAZ-1709)
  - [x] Prototype on branch, approved hands-on by Yasin
  - [x] Linear tree created YAZ-1718…1728
  - [x] 2A YAZ-1720 · [x] 2B YAZ-1721 (phase 2 YAZ-1719)
  - [x] 3 YAZ-1722
  - [x] 4A YAZ-1724 · [x] 4B YAZ-1725 (phase 4 YAZ-1723)
  - [x] 5A YAZ-1727 (phase 5 YAZ-1726)
- Now: [→] 5B YAZ-1728 — apply the audit, commit, PR, merge, closeout
- Next: PR → merge → Linear closeout → demo + worktree removed

## Open Questions
- Resolved (case 25): a broken image while folded stays the inert broken chip — the folded-wrapper rule is scoped `:not(.image-view--broken)`, the decoration still lands, no `<img>` comes back; pinned by outlineFolding.test.ts "a BROKEN image folds and unfolds like any other".

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1709-image-collapse` (branch `yaz-1709-image-collapse`, base main 35204ea); real `npm ci` in the worktree (symlinked node_modules broke Vite's fs.allow).
- Demo: `/Users/yasin/Desktop/yaz-1709-demo/` (vault `Image Collapse Feature YAZ-1709`, `pristine/`, `paste-source.png`, `app-profile/`, `run-demo.sh`, `seed-state.ts`, `dev.log`).
- Linear helper: scratchpad `linear_ops.py` (`tree`, `state`, `comment`, `create`); ids in `tree_ids.json`.
- Tests: `/opt/homebrew/bin/npm run typecheck` · `npx vitest run` (all projects). Never `npm run e2e`.
- Key files: `client/src/editor/outline/{listNodes,outlineFolding,outlineFoldKeys}.ts`, `client/src/editor/image/{imageView,imageOptions,ImageModal}.ts(x)`, `imageView.css`, `imageModal.css`, `client/src/editor/Editor.tsx`, `docs/CONTRACTS.md` rules 5/30, `tools/prototypes/make_image_collapse_demo_vault.py`.
