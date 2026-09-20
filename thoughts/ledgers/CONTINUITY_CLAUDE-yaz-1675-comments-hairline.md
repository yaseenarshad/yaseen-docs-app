# CONTINUITY — yaz-1675-comments-hairline

## Goal
- Remove the edge-to-edge line above "Comments" (YAZ-1675): delete `.comments`' `border-top`, guard it with a CSS contract test, record the decision in the CSS header and CONTRACTS.md. Merged to main, Linear closed out, demo scaffolding gone. No release.

## Constraints
- Decisions D1–D3 LOCKED (comments on YAZ-1675): only the Comments line goes (Linked mentions + folder contents keep theirs); a 3-line guard test; one combined polish subissue.
- No Playwright while Yasin is at the computer. Unit tests + the dev app on an isolated profile (`YASEEN_DOCS_USER_DATA_DIR`) that Yasin checks by eye.
- Commit with `/commit` (no Claude attribution). Push + merge to main approved. No release unless Yasin says so.
- Linear: parent + child In Progress when starting, Done when complete; learnings → comments; new work → `1B1-`-style children.

## Key Decisions
- The line was decorative, copied from the folder-page contents block's "one hairline is the entire chrome"; it spanned the screen because it sat on the content column's outer edge (outside the 48px padding), unlike Linked mentions' header-level line. Nothing depended on it.
- Demo generator `tools/prototypes/yaz-1675-demo-vault.mjs` is NOT shipped: an 8-note vault for a one-line CSS change is not worth a file in the repo.

## State
- Done:
  - [x] 1 YAZ-1676: scope + findings (comment), demo approved by Yasin ("yes thats perfect")
  - [x] 2 YAZ-1677: CSS delete + guard test; typecheck + full vitest green
  - [x] 3 YAZ-1678: polish (CSS header + CONTRACTS.md clause, ledger), audit posted per item
  - [x] PR #60 merged to main (cbbdc2a); Linear parent + children Done; demo folder, dev app, worktree, branch removed
- Now: nothing — issue closed. No release cut (Yasin batches releases).

## Open Questions
- none

## Working Set
- Worktree and demo removed at closeout (branch `yaz-1675-comments-hairline`, base main 8a68ee5, merged as cbbdc2a)
- Files: `client/src/comments/comments.css`, `client/src/comments/CommentsSection.test.tsx`, `docs/CONTRACTS.md`
- Tests: `npx vitest run client/src/comments client/src/contentWidthCss.test.ts`; `npm run typecheck`
