# CONTINUITY — yaz-1656-images

## Goal
- Ship "images first-class" (YAZ-1656) to main: vault images render, paste/drop saves full-res files to `assets/images/` and links them at `|400`, eight-handle aspect-locked resize, double-click lightbox, right-click Copy Image / Reveal, byte-identical markdown round-trip. Merged PR, Linear fully updated, demo scaffolding gone. No release.

## Constraints
- Decisions D1–D8 + demo learnings DL1–DL7 are LOCKED (comments on YAZ-1656). No architecture changes without bringing Yasin the problem/options/recommendation/diff format.
- Never run Playwright / `npm run e2e` while Yasin is at the computer — it steals the screen. Unit tests only; ask Yasin to test in the dev app; e2e runs only on his explicit go-ahead.
- House rules: header comments explain WHY; decorations-first except the ONE approved node view (existing `image` node, serializer untouched); `roundtrip.test.ts` must stay byte-identical; IPC bodies validated like request bodies.
- Commit with `/commit` (no Claude attribution). Push + merge to main approved. No new release unless Yasin says so.
- Linear: move parent + phase + child to In Progress when starting; Done when complete; new work → `1B1-`-style children; learnings/gotchas → comments.

## Key Decisions
- See YAZ-1656 comments "Decisions D1–D8" and "Demo learnings". Summary: `app://vault/<root>/<ref>?from=` served by main; node view on the existing `image` node; width as `![alt|W](src)`; files at `assets/images/<note>-<stamp>.<ext>` never overwritten; `writeAsset` widened to bytes; paste/drop bytes beat markup; native `copyImageAt`; wiki embeds deferred (YAZ-1673).
- Small calls made during execution (recorded on the child issues): paste over a selected image inserts after it; Escape cancels a drag; no extra context-menu rows. REVERSED on evidence: the folder-page outline editor does NOT get the image view — its bullets-only lock (F3) rejects `image` nodes; widening that lock is Yasin's call, not this issue's.

## State
- Done:
  - [x] Scope + decisions locked (YAZ-1656 comments)
  - [x] Prototype on branch `yaz-1656-images`, approved by Yasin against the demo vault
  - [x] Linear tree created: YAZ-1657…1673
- Now: [→] CLOSED OUT 2026-09-19 — merged as PR #59 (3091934), release v0.9.21 (d14c3f7) built and installed over /Applications/Yaseen Docs.app; master handoff is a comment on YAZ-1656; issue In Review
- Gotcha: dev app must NOT run with `--watch` while agents edit — every main rebuild relaunches the window on Yasin's screen (he read it as Playwright). Launch only for a pointed manual test, without `--watch`.
- Next (only open item): one local run of `npm run e2e -- imagePaste imageRender` with Yasin's go-ahead → YAZ-1668/1669/1667 Done → YAZ-1656 Done
- Remaining:
  - [x] 1A YAZ-1658 · [x] 1B YAZ-1659 (phase 1 Done)
  - [x] 2A YAZ-1661 · [x] 2B YAZ-1662 (phase 2 Done)
  - [x] 3A YAZ-1664 · [x] 3B YAZ-1665 · [x] 3C YAZ-1666 (phase 3 Done)
  - [ ] 4A YAZ-1668 · 4B YAZ-1669 (Todo) — specs WRITTEN (`desktop/e2e/imagePaste.spec.ts`, `imageRender.spec.ts`, `imageFixtures.ts`), NOT run; `npm run e2e -- imagePaste imageRender` when Yasin allows
  - [x] 5A YAZ-1671 · [x] 5B YAZ-1672 (shipped; demo folder + worktree removed at closeout)
  - [x] Demo folder and worktree removed; generator kept at `tools/prototypes/make_image_demo_vault.py`

## Open Questions
- UNCONFIRMED: when Yasin will allow the single e2e run (needed for 4A/4B Done).
- Resolved: dev-profile pattern documented in LAUNCH.md (App state section).

## Working Set
- Worktree: `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1656-images` (branch `yaz-1656-images`, base main 56b0e4c)
- Demo: `/Users/yasin/Desktop/yaz-1656-demo/` (vault `Images First-Class YAZ-1656`, `app-profile/`, `run-demo.sh`, `SCENARIOS.md`); dev app log `/tmp/yaz1656-dev.log`
- Linear helper: scratchpad `linear_ops.py` (`state`, `comment`, `tree`); tree ids in `tree_ids.json`
- Tests: `/opt/homebrew/bin/npm run typecheck` · `npx vitest run` (never `npm run e2e` unprompted)
- Key files: `desktop/src/main/vaultProtocol.ts`, `desktop/src/main/fs/assets.ts`, `desktop/src/main/menu.ts`, `client/src/editor/image/*`, `client/src/editor/clipboardPaste.ts`, `client/src/editor/createCrepe.ts`, `client/src/editor/Editor.tsx`, `shared/types.ts`
