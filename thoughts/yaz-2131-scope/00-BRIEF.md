# YAZ-2131 Docs App: Speed & Optimization — deep-scope brief (read fully before starting)

## What this is
- Repo: `/Users/yasinarshad/Documents/GitHub/yaseen-docs-app` (Yaseen Docs: Electron 43 + React 19 + Milkdown Crepe markdown editor; main process in `desktop/src/main`, preload `desktop/src/preload`, renderer is `client/`, shared types `shared/`). Base: `main` @ `63aeeea` (v0.9.27).
- Linear: parent YAZ-2131, deep-scope child YAZ-2132. We are ONLY scoping now. No implementation.
- Yasin's goal (verbatim spirit): make the Electron app smaller, faster, smoother, more reliable. **This is a refactor project. No feature loss. No stability or reliability loss. Nothing is removed. Nothing changes how a feature looks or works** unless the trade-off is negligible/unnoticeable for an outsized (asymmetric) gain — and then it is a DECISION for Yasin, never made silently.
- Stay on Electron (the sibling draw app already decided this: Tauri/WebKit = unpinned Safari engine, rewrite; see D1 in the draw scope). Do not re-litigate unless the docs app has a materially different reason.

## 🔒 SCOPE CHANGE from Yasin (mid-scope): IGNORE THE DRAWING COMPONENT
- Yasin barely uses the drawing (yaseendraw / Excalidraw) part of the docs app and will gut it in a future project. **Do not spend scope on it**: no engine bump, no drawing-modal perf, no drawing-preview perf, no drawing bugs, no Excalidraw bundle/font savings as levers.
- It must keep working as-is (no breakage), but it is NOT an optimization target. Focus on everything outside it: the markdown editor, sidebar/tree, tabs, folder pages/boards/columns, search, links/backlinks, properties, watcher, sync, save path, startup, packaging.
- When you measure sizes or startup, report drawing-related bytes/time as ONE separate line ("drawing component, out of scope, removable in the future gut") so it doesn't inflate or distort the numbers we act on.

## The sibling project to learn from (do NOT copy code verbatim)
- Yaseen Draw App ran the same project yesterday: Linear YAZ-2073, deep scope YAZ-2074, decisions D1–D18, build tree 1–8.
- Full dump of every issue description + comment (diffs, numbers, file:line evidence, before/after table): `SCRATCH/draw_tree.md` (373 KB). Useful sections (line numbers):
  - 1–362 parent prompt + learning comment + before/after table + handoff
  - 3076–3400 YAZ-2074 deep scope 1/2/3 (findings, locked decisions D1–D18, tree)
  - 2347–2877 phase 1 safety net (budget gate 1A, perf harness 1B, Playwright 1C, glue tests 1D)
  - 1677–2346 phase 2 reliability bugs (quit flush, fsync, watch race, Windows paths, torn asset writes, spurious conflict bar, quit teardown)
  - 4692–end phase 3 size (LZMA DMG, locale trim, fonts once, minify+hidden maps, bundle chokidar)
  - 2878–3075 phase 4 launch (V8 code cache for app://, preload engine at boot)
  - 3403–4691 phase 5 smoothness (upstream engine fixes, off-thread image decode, thumbnails, sidebar render isolation, tree-refresh coalescing, recursive fs.watch watcher, save path, idle poll, memory)
  - 1241–1676 phase 6 refactor (IPC contract as data, shared editor hook, split Sidebar)
  - 778–1240 phase 7 verify, 365–777 phase 8 polish
- The draw app's source is NOT on this machine (its branch lives on another Mac). Only the Linear text is available. The draw app local clone at `/Users/yasinarshad/Documents/GitHub/yaseen-draw-app` is the PRE-project v0.1.11 — useful only to compare shared-ancestry code.
- The docs app VENDORS THE SAME ENGINE FORK: `client/vendor/yaseendraw-*-9e63bdf2.tgz` (from `/Users/yasinarshad/Documents/GitHub/yaseen-excalidraw`). The fork branch `origin/yaz-2073-perf` @ `759e7dfd` is a descendant of `9e63bdf2` and adds: #12180 resize fix, #12183 drag fix, lazy pako, drop roundRect polyfill, fetch UI font once — but ALSO carries `56ce286c feat(editor): Writing mode` and two R2 save fixes (`e7b08538`, `e72242f8`).

## 🚨 Machine-safety rules (added after two incidents in this scope; non-negotiable)
- **Never start any Yaseen Docs binary without `--user-data-dir=SCRATCH/profiles/<you>`. That includes `--version`, `--help` and "just checking".** A bare launch opened Yasin's REAL profile and vaults. To read the Electron version, use `plutil -p ".../Contents/Frameworks/Electron Framework.framework/Resources/Info.plist"` or `node_modules/electron/package.json`. Never use `open -a`, and never double-click.
- **Do not run the Playwright e2e suite (`npm run e2e`, `playwright test`).** Each run re-registers the `yaseendocs://` link handler to the dev Electron binary (`desktop/src/main/index.ts:45`), which hijacks Yasin's real deep links. The safety-net angle already has a full baseline run. If you truly need one spec, stop and ask the lead first.
- Never read from or write to `~/Library/Application Support/Yaseen Docs`, `/Applications/Yaseen Docs.app`, or any vault outside `SCRATCH/vaults/`.
- Quit everything you launch (by PID from your own launch) and confirm with `pgrep -fl "Yaseen Docs"` that no process of yours is left running. Never kill a process whose `--user-data-dir` isn't yours.

## Hard rules for you
- READ-ONLY on the repo's tracked files. Do not edit, commit, push, stash, checkout, or change branches. You may create files only under `SCRATCH/` (below).
- Do not run `npm install`/`npm ci`/`npm run desktop:build` (the lead already built). The packaged app is at `desktop/dist-app/mac-arm64/Yaseen Docs.app` (plus a DMG in `desktop/dist-app/`) and the unpacked build at `desktop/out/`. If it isn't there yet, work on code reading first and check again later.
- If you launch the app to measure, use an ISOLATED profile (`--user-data-dir=SCRATCH/profiles/<you>`) and a throwaway vault under `SCRATCH/vaults/<you>`; never touch Yasin's real profile (`~/Library/Application Support/Yaseen Docs`) or real vaults. Quit what you launch.
- Timing numbers: repeat ≥5 runs, report median and p95, note machine load (`uptime`) because other agents run concurrently. Say "measured" vs "estimated" explicitly. Never invent numbers.
- Stay in your angle; note cross-angle findings in one line under "Handoffs to other angles".

## Output (write to `SCRATCH/findings/<angle>.md`, then reply with a ≤25-line summary)
1. **Baseline numbers** you measured (table).
2. **Findings**, most impactful first. Each: what, evidence (`file:line`, numbers), impact (size/speed/smoothness/reliability), risk to features, and whether the draw app did the equivalent (cite its issue id, e.g. "draw 5E / YAZ-2099") and whether it transfers as-is, adapted, or not at all.
3. **Proposed changes**: for each, the exact file and a unified diff block with real line numbers from the current file (```diff with `@@ -a,b +c,d @@`), plus the one-sentence "after this, the behavior is …".
4. **Decisions Yasin must make** (only real architecture/product trade-offs, not bugs): problem · numbered options · recommendation + why. Bugs and pure-speed changes with no visible effect are NOT decisions; just recommend them.
5. **Keep as-is** list (measured and not worth it), with the reason.
6. **Handoffs to other angles.**

SCRATCH = `/private/tmp/claude-501/-Users-yasinarshad-Documents-GitHub-yaseen-docs-app/c86e4da7-9236-45a1-8785-da911c6b5880/scratchpad`
