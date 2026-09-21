# CONTINUITY — header chrome: sidebar reopen + properties chip (YAZ-1760)

## Goal
- Ship two header-chrome fixes to main, with Linear closed out and the demo rig removed:
  - YAZ-1759 (child 2-): the collapsed-sidebar "Show sidebar" button lives INSIDE the tab strip, first, left of ◀ ▶. No floating button, nothing over Back.
  - YAZ-1758 (child 3-): the properties chip is chevron + `PropertiesIcon` + bare count; the words (`Add properties` / `Properties (N)` / `Properties`) are the button's `title` + `aria-label`.
- Done = merged to main, S1–S10 + C1–C12 pass by hand, 5A audit worked to zero in 5B, CONTRACTS.md true, this ledger closed, vault/profile/worktree deleted. NO release.

## Constraints
- Worktree `/Users/yasin/Documents/GitHub/yaseen-docs-app-header-chrome`, branch `yaz-1760-header-chrome` (was `demo/header-chrome`), off main `5e2466f`. Commits via the `/commit` skill.
- NO Playwright runs by anyone (D3). Verification = `npx vitest run --project client` + `npm run typecheck` + hand walkthrough in the dev app on the isolated profile (`YASEEN_DOCS_USER_DATA_DIR`, HMR). e2e specs kept correct, never executed here.
- No wrapper element around the properties chip: `contentWidthCss.test.ts` forbids `.frontmatter-panel > *` (YAZ-1710 6B1 double zoom through the `display: contents` panel).
- Linear-Simpler tree: parent YAZ-1760 → 1- YAZ-1761 (scope, Done) · 2- YAZ-1759 · 3- YAZ-1758 · 4- YAZ-1762 (verify) · 5- YAZ-1763 (polish) → 5A YAZ-1764 · 5B YAZ-1765. Parent + child both go In Progress when work starts.

## Key Decisions (LOCKED on YAZ-1760, Yasin "approved, lock it in" 2026-09-20 after the demo)
- **D1** in-flow `.tabbar-nav__btn` "Show sidebar" first in `.tabbar-nav`, via `TabBar.onShowSidebar?`; App passes `sidebarCollapsed ? toggleSidebar : undefined`. `.sidebar-reopen` CSS and `.app { position: relative }` deleted. `SidebarPanelIcon` moved to `views/view/icons.tsx`. Rejected: padded floater, rail.
- **D2** chevron + glyph + bare count; `label` const drives `title` + `aria-label` (count inside the label because `aria-label` replaces content for screen readers). Dead `.frontmatter-panel__title` CSS removed. Rejected: glyph-only-when-empty, hide-until-hover.
- **D3** hand verification only; Playwright bothers Yasin.
- **D4** one parent, six children.

## State
- Done:
  - [x] 1- Scope (YAZ-1761): findings comment posted, issue Done.
  - [x] Prototype in worktree (agent), 3453 client tests + typecheck green; demo vault "Header Chrome - Sidebar Reopen + Properties Chip" + profile in the session scratchpad; Yasin walked S1–S10, C1–C12: all passed.
  - [x] Linear tree created; LOCKED decisions + scenarios on YAZ-1760; per-child decision comments.
  - [x] 2- + 3- (YAZ-1759, YAZ-1758): reviewed by hand, one commit `7868529` (app.css and CONTRACTS.md carry hunks of each). Both Done on Linear.
  - [x] 4- Verify (YAZ-1762): 191 files / 3453 tests green, typecheck clean, Yasin's 22-scenario walkthrough on the same code. Done.
  - [x] 5A audit (YAZ-1764): four items, posted by file. Done.
  - [x] 5B apply (YAZ-1765): commit `1651c7a`; four audit items done/declined, comment posted.
- SHIPPED and CLOSED OUT (2026-09-20): PR #72 → main `391e0a3`. No release (0.9.22 stays). Linear: YAZ-1760 and every child Done; HANDOFF comment on the parent. Demo vault, profile, scripts, worktree and branch removed. Playwright never run.
- Now: nothing; this ledger is closed.
- Next: nothing.

## Open Questions
- None. (The right-panel question was never needed by a scenario; left unverified on purpose.)

## Working Set
- Source: `client/src/tabs/TabBar.tsx`, `client/src/App.tsx`, `client/src/app.css`, `client/src/tabs/tabs.css`, `client/src/views/view/icons.tsx`, `client/src/sidebar/Sidebar.tsx`, `client/src/editor/FrontmatterPanel.tsx`.
- Tests: `client/src/tabs/TabBar.test.tsx`, `client/src/App.test.tsx`, `client/src/editor/FrontmatterPanel.test.tsx`; e2e edits (not run) `desktop/e2e/easyWave.spec.ts`, `desktop/e2e/properties.spec.ts`.
- Docs: `docs/CONTRACTS.md` (Tabs bullet; Properties "The header").
- Commands: `npx vitest run --project client` · `npm run typecheck` · demo: `<scratchpad>/run-demo.sh`.
