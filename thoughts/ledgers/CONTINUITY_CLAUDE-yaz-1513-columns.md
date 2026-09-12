# CONTINUITY — YAZ-1513 folder page column overhaul

## Goal
- Every folder page Table has three built-ins — Name (page title, no `.md`, plain colour, live on rename), `#` (1-based, restarts per group, hideable per view), `status` (a Select every folder page is born with) — and columns are managed like Notion: labels + rename, header right-click (Rename / Hide / Add right / Delete), delete with confirm that strips member values, drag headers, two-level Properties panel.
- Done = Linear YAZ-1513 tree (YAZ-1537..1551) all Done, merged to main, CONTRACTS + README amended, e2e spec green.

## Constraints
- One settings door (`client/src/views/folderPageSettings.ts`); every write through `FolderPageContents` `onChange` / `setColumns` / `commitSettings`; no read-time injection (🔒 D3 YAZ-1471).
- No Playwright driving Yasin's screen without his go; live checks = dev app + "go do this".
- No release/version bump unless asked.

## Key Decisions
- D1 name cell renders `record.basename` in every skin (`pageTitle`); `file.name` VALUE keeps the extension.
- D2 `#` is a Table gutter, not a property key; `view.rowNumbers` (absent = shown).
- D3 `status` written at birth via `DEFAULT_COLUMNS` (`shared/folderPageDefaults.ts`) through `bornFolderPage` — New / Turn-into (write-if-missing) / sub-topic / Home; existing pages via `tools/seedDefaultColumns.mjs` (dry run default, git-clean).
- D4 labels persist in `folder_page_settings.properties` (`key → { displayName }`); `defaultLabel` (file-field table, sentence case); ONE writer `setDisplayName`.
- D5 delete column = confirm → awaited settings write (declaration, order/sort/groupBy/summaries/columnSize/cardStyle/image/filter leaves, label) → strip bare key from direct members; undeletable = `file.*`, `formula.*`, `APP_OWNED_KEYS`.
- D6 Properties panel two-level; detail title IS the editable name; type/options/relation inline, immediate writes; no Save/Cancel.
- Polish: host (`FolderPageContents`) owns optimistic "ahead" columns exposed as `FolderPageMode.settings.columns`; `withOrder` is the one order writer; declared columns show by default (`propertyKeys(…, declared)`, threaded explicitly, NOT via the def).

## State
- Done:
  - [x] 1- Scope (YAZ-1537)
  - [x] 2- Built-in columns 2A-2D (YAZ-1538..1542) — `d7cf39c`
  - [x] 3- Column management 3A-3E (YAZ-1543..1548) — `d7cf39c`
  - [x] 4- Polish and anti-slop (YAZ-1549) — `d787fd1`
- Now: [→] 5- Verify + CONTRACTS (YAZ-1550) — docs + spec in `f533d2b`; e2e `desktop/e2e/columns.spec.ts` NOT yet executed (needs Yasin's go: opens windows)
- Next: merge `yaz-1513-demo` → main, close YAZ-1513, delete the scratch demo vault + profile, remove the worktree.

## Open Questions
- UNCONFIRMED: `columns.spec.ts` step 4 (header drag via `page.mouse`) may need tuning under Electron's synthesized HTML5 drag events.

## Working Set
- Branch `yaz-1513-demo` (worktree `.claude/worktrees/yaz-1513-demo`), base main `0a98a66`.
- Tests: `npm run typecheck && npm test` (231 files / 3826); `npm run e2e` for the spec; `npm run build`.
- Demo: scratch vault `…/scratchpad/YAZ-1513 Name Status Number Columns` + profile, launched with `YASEEN_DOCS_USER_DATA_DIR=<profile> npm run dev` (throwaway).
