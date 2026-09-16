# CONTINUITY — YAZ-1643 new pages land beside the page that made them

## Goal
- A bare `[[link]]` clicked or typed in ANY page creates its page in that page's own folder (main tab, right panel, folder-page block alike). Linear: YAZ-1643 (parent) → 1650 scope · 1651 default · 1652 source-path getter + rename · 1653 hand verify · 1654 polish · 1655 Future (same-folder-first resolution).
- Done = 1651–1654 Done with comments, PR merged to main, NO release cut. 1653 closes on Yasin's word (his final run + flipping his installed app's setting).

## Constraints
- Linear-Simpler; parent + child In Progress / Done as work moves. NO Playwright on Yasin's machine — verification is a dev app (`electron-vite dev`, HMR) on an isolated profile (`YASEEN_DOCS_USER_DATA_DIR=/tmp/yaz-1643/userdata`) + demo vault `/tmp/yaz-1643/New Pages Land Beside Their Page`, driven by hand from a scenario list. No release unless Yasin says so.

## Key Decisions (🔒 2026-09-16, comment on YAZ-1643)
- D1 `DEFAULT_SETTINGS.newNoteLocation: 'current'`. No store migration (an explicit saved `root` is indistinguishable from a choice); Yasin flips his own setting once.
- D2 App's getter takes the source path — `newNoteFolderFor(sourcePath)`; each editor binds its OWN `file.path` into `WikilinkNav.createFolder`. App no longer tracks the active tab for this. Getter identity stays stable (CrepeHost effect dep).
- Rename `createBase` → `newNoteFolderFor` (prop) / `createFolder` (nav): "base" read as Bases; it only meant "base folder".
- D3 same-folder-first RESOLUTION deferred → YAZ-1655. D4 sidebar blank-space New note stays root. D5 folder-page BODY links create beside the page, not in `folder_page_settings.folder` (members via New/board/Topics still do).
- Label stays "Same folder as current file" (tried "…the page I'm in" live; reverted on Yasin's call).

## State
- Done:
  - [x] 1- Scope (YAZ-1650): findings + decisions comments; 15-scenario demo run by Yasin — "approved lock it in"
  - [x] 2- Default (YAZ-1651) + 3- Source-path getter & rename (YAZ-1652): 15 files, typecheck clean, vitest 3964 green; one new Editor-level test pins the nav to the editor's own path at click time
  - [x] 5- Polish (YAZ-1654): `newNoteBase(sourcePath: string)` — dropped the `null` arm nobody calls; test tightened to match. Nothing else to trim: comments match the surrounding convention, CONTRACTS rules 23/24 + settings row rewritten, zero `createBase` left (one dated plan under docs/superpowers keeps its snippet)
  - [x] 4- Verify (YAZ-1653): Yasin's final pass on the demo app — "ok that's good it worked"
  - [x] PR #57 merged to main (`75f2ee9`); handoff on the parent and every subissue; worktree, branch, demo folder removed
- Now: COMPLETE — nothing pending (human item, unconfirmed: Yasin flips his installed app's setting; D1 ships no migration)
- Next: none. Learning: a default flip never reaches a profile that already saved the old value explicitly — say so in the issue, don't write a migration that overrides real choices.

## Open Questions
- none

## Working Set
- Everything on main; worktree and branch removed
- Files: `shared/types.ts`, `client/src/App.tsx`, `client/src/editor/Editor.tsx`(+test), `client/src/views/FolderPageContents.tsx`, `client/src/editor/wikilink/{wikilinkClick,wikilinkPicker,createFromLink}.ts`(+tests), `client/src/sidebar/SettingsPanel.test.tsx`, `desktop/src/main/store.test.ts`, `desktop/e2e/links.spec.ts` (wording only), `docs/CONTRACTS.md`
- Tests: `npx vitest run client/src/editor/wikilink client/src/editor/Editor.test.tsx` · `npm run typecheck` · `npm test`
- Demo folder `/tmp/yaz-1643` deleted at closeout; recipe in the handoff comment on YAZ-1643
