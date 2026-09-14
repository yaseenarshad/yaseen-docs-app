# CONTINUITY — YAZ-1604 new dated folder

## Goal
- Right-click a folder or the blank root → "New dated folder" → inline box opens as `MM_DD- ` with the caret after the dash → type the title → Enter creates `MM_DD- Title`. Linear: YAZ-1604 (parent) → YAZ-1606 (scope), 1607 (seed), 1608 (menu), 1609 (verify), 1610 (polish).

## Constraints
- 🔒 D1 seed is a `seed` string beside `kind`; no new EntryKind; nothing on disk before Enter. 🔒 D2 sibling item under "New folder", one `canNewFolder` gate. 🔒 D3 Enter on an untouched seed is a no-op, box stays open.
- No Playwright runs (they take over Yasin's machine). Verify with unit tests + Yasin's hand walkthrough in the isolated dev app.
- No release unless Yasin says so (he batches pushes into releases).
- Commit via /commit skill (no Claude attribution). PR → merge to main when done (permission given 2026-09-14).

## Key Decisions
- Scope findings + D1–D3 are comments on YAZ-1604 (2026-09-14). Demo approved by Yasin before any commit.
- Two commits, not one: the mechanism (1607) is proven by a direct component test so it stands without the menu; the gesture (1608) owns the label pins. Sidebar-level test pins wiring only.

## State
- Done:
  - [x] YAZ-1606 scope + decisions locked + demo approved (18-scenario hand walkthrough by Yasin)
  - [x] YAZ-1607 seed the inline create box — `e0f30bd` (+ direct `CreateInline.test.tsx`)
  - [x] YAZ-1608 "New dated folder" menu item — `17e1d85`
  - [x] YAZ-1609 verify end-to-end — full `npx vitest run` + `npm run typecheck` green on the branch (numbers in the YAZ-1609 comment)
  - [x] YAZ-1610 polish — Sidebar integration test trimmed to wiring only (caret + no-op Enter live in CreateInline.test); nothing else to cut
- Now: [→] PR → merge to main, delete demo vault/profile, remove worktree + branch. No release (Yasin batches releases).

## Open Questions
- none

## Gotchas
- Worktree needs `node_modules/electron/dist`: `npm install` skipped the Electron download; fix with `cd node_modules/electron && node install.js`.
- Demo app: `<scratchpad>/run-demo.sh` (HMR, `YASEEN_DOCS_USER_DATA_DIR=<scratchpad>/profile-YAZ-1604`, vault `<scratchpad>/YAZ-1604 New Dated Folder`). Delete both when done.
- Three places pin the menu label list: `ContextMenu.test.tsx`, `Sidebar.test.tsx` ×2, `desktop/e2e/topics.spec.ts`.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-yaz-1604`, branch `yaz-1604-dated-folder` off main `af0acb6`.
- Files: `client/src/sidebar/{createEntry,CreateInline,Sidebar,Tree,TopicsTree,ContextMenu}.tsx|ts`, their tests, `desktop/e2e/topics.spec.ts`, `README.md`.
- Tests: `npx vitest run client/src/sidebar`; `npm run typecheck`; full: `npx vitest run`.
