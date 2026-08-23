# CONTINUITY — Sidebar wave (delete / copy path / reveal in Finder)

## Goal

Ship three sidebar context-menu features to `main`, fully finished, not half-cooked:

- **GRO-2272** — delete notes & folders to the system Trash, right-click.
- **GRO-2273** — blank-space right-click → Copy path (vault root).
- **GRO-2274** — right-click → Reveal in Finder (files, folders, root).

**Done means:** all 31 issues Done in Linear, `npm run typecheck` + `npm run test` + `npm run e2e` green, merged to `main` and pushed. Every locked ruling honoured. The resurrection bug provably impossible.

## Constraints

- Worktree `.claude/worktrees/sidebar`, branch `sidebar`. Base `43c9d10`.
- **Locked rulings must not be re-litigated.** They live as comments on GRO-2272 / 2273 / 2274.
- Architecture/design/functionality decisions that arise mid-build go to Yasin in the agreed format (problem → numbered options → recommendation + why → file → line-numbered red/green diff → behaviour after). Bugs and implementation details are mine.
- Linear stays current: parent AND subissue → In Progress when started, → Done when complete. Decisions, rationale, learnings and gotchas go into comments as I go.
- New work found mid-build gets filed as a new issue (e.g. `C3a-`), not silently absorbed.

## Key locked decisions (do not re-open)

- **Trash only.** `shell.trashItem`, never `fs.rm`. A trash failure refuses loudly with `IO_ERROR` and deletes nothing. No permanent-delete fallback, ever.
- **No link rewriting on delete.** Referencing notes stay byte-identical; their `[[links]]` go unresolved. Obsidian behaviour.
- **Retire before remap.** `file:deleted` → retire the editor's autosave → then close the tab. Reverse the order and deleting an open note resurrects it.
- **In-app delete ≠ external delete.** External deletes keep the tab open on purpose (`Sidebar.tsx`). Do not unify them.
- **Confirm sheet** is in-app, never native. `confirmDelete` setting defaults **true**; "Don't ask me again" + a settings toggle back on.
- **Copy path only** — no Copy Relative Path (Yasin declined; deliberate VS Code divergence).
- **Reveal in parent** for every row type, incl. the vault root. VS Code parity.
- **No hotkeys** in any wave — all blocked on the tree selection model (GRO-2263), preserved in GRO-2295.

## Sequencing (enforced by blocking relations in Linear)

1. GRO-2275 (scope pass) · GRO-2296 (menu-target decoupling refactor)
2. Parallel: 2272 `A-` (2277/2278/2279) · 2272 `B-` (2281/2282/2283) · 2274 `A1-`/`A2-` (2300/2301)
3. One at a time (same ~30 lines of `ContextMenu.tsx` + `Sidebar.openMenu`): 2297 → 2302 → 2285
4. 2272 `C2-`/`C3-`/`C4-` → `D-` (2289/2290) → every polish audit/execute pair

## State — COMPLETE (2026-08-23)

- Done: every phase of all three waves. Merged to `main` as `5deb568` and pushed.
  - [x] YAZ-578 delete — scope pass, main process, renderer, UI, e2e, polish
  - [x] YAZ-577 blank-space copy path — decoupling refactor + behaviour + polish
  - [x] YAZ-579 reveal in Finder — main, bridge, menu entry + polish
- Gate at close: typecheck clean · 1518 unit tests (113 files) · 60/60 e2e.
- Worktree and branch `sidebar` deleted (local + remote).

## Open at close

- **YAZ-722** — pre-existing `quitApp` e2e flake, verified against a baseline worktree at `43c9d10` (failed 2 of 3 there too). Not fixed; may mask a real quit-path bug.
- **YAZ-698** — perf budgets raised to 150ms. One unreproducible full-suite failure recorded honestly.
- **YAZ-572 / YAZ-573** — Futures: deleted-files setting, tree selection hotkeys (blocked on GRO-2263).
- Cross-window autosave retire still unfixed (pre-existing; same limit rename has).

## Gotchas worth carrying forward

- **Vitest treats a value returned from a hook as a teardown callback.** `beforeEach(() => mock.mockReset())` returns the mock, so vitest calls it after every test — an unhandled rejection attributed to a test whose assertions all passed. Use a block body.
- **Linear identifiers are not safe addressing** — `issue(id:"GRO-2276")` resolved to a different issue. Use UUIDs. The Milkdown project is team **YAZ**, not GRO, with different state UUIDs.
- **The Bash cwd resets between calls.** Twice this session, edits intended for the worktree landed in the main repo. Assert the cwd inside any script that writes files.

## Working set

- Worktree: `.claude/worktrees/sidebar` (branch `sidebar`)
- Test: `npm run typecheck` · `npm run test` · `npm run e2e`
- Linear: GRO-2272 (21+1), GRO-2273 (4), GRO-2274 (5)
