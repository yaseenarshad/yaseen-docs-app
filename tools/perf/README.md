# tools/perf

Three tools: a size and integrity gate that CI runs and a local perf harness that drives the real app (YAZ-2131), and a local headless probe of the sidebar's level lines (YAZ-3329).

| File | What |
|---|---|
| `measureBudget.mjs` | `npm run perf:budget` / `perf:budget:ci`: the gate (see `docs/CONTRACTS.md` "Packaging") |
| `budget.json` | the gate's ceilings. **Ratchet:** a PR that shrinks a row lowers its ceiling; raising one needs Yasin's OK |
| `baseline.json` | FROZEN v0.9.27 @ 63aeeea numbers: `size` from the gate, `perf` from the harness. Never edited |
| `run.mjs`, `scenarios/`, `lib/`, `genVault.mjs` | `npm run perf`: the harness. `--app` takes a packaged `.app` or an unpacked build's `desktop/out/main/index.js` |
| `runs/` | the raw before/after A/B and budget JSON behind the 7A ratchet (YAZ-2204) |
| `sidebarLinesRecalc.mjs` | `node tools/perf/sidebarLinesRecalc.mjs` after `npm run build`: the style and layout cost of the sidebar's level lines and thread for each action, at 10,207 open rows, in headless Chromium (no window), with the real `levelLinesHover.ts`. It also checks what jsdom cannot see (the keyboard and the mouse marks, S2, S3, D11, the rename chevron of YAZ-3342) and exits 1 if a check fails. Local only, not in CI (YAZ-3329) |

## The harness

```bash
npm run desktop:build                                   # the build to measure
npm run perf -- launch typing --runs 5                  # one build
npm run perf -- all --runs 5 --app <after.app> --vs <before.app>   # A/B
```

- **A/B.** `--vs` runs a second build run by run in ABBA order (A B, B A, A B …), so drift in machine load hits both sides the same. Each side gets its own warm-up run (discarded), fixtures and profiles. The table shows both medians and p95s and the change. Keep a copy of the before build outside `desktop/dist-app` (e.g. `ditto` it to a temp dir) because the next `desktop:build` overwrites it.
- **Output.** A table on stdout, progress on stderr, and JSON at `--out` (default `<tmpdir>/yaseen-docs-perf-<time>.json`): per metric the median, p95, min, max, cv (noise) and every run.
- **Load.** The 1-minute load average is recorded before every run. A scenario whose runs saw a load over 10 is marked `noisy`, and its time and CPU metrics are listed as `loadSensitive` (sizes, counts and fds are not). Compare builds on an idle machine with the same `--runs`; several agents share this Mac, so ask for a quiet window before a timing run.
- **Isolation.** Every launch passes `--user-data-dir=<work>/<scenario>/profile…` and sets `YASEEN_DOCS_USER_DATA_DIR` to the same path. Vaults are generated into `--work` (default `<tmpdir>/yaseen-docs-perf`), which must be under a temp root and empty or the harness's own, and is removed when the run ends. The harness signals only the PIDs it spawned: it quits through `app.quit()` (what ⌘Q calls) and SIGKILLs its own main and helpers if a quit hangs or the harness is interrupted (Ctrl-C). Before measuring anything, every launch checks that main's `userData` is the isolated profile.
- **Instrumentation.** Main runs with `--inspect=0` (to read main's clock and call `app.quit()`) and Chromium with `--remote-debugging-port`, on both sides of an A/B alike.
- **LaunchServices.** Every launch sets `YASEEN_DOCS_E2E=1`, so a guarded build leaves `yaseendocs://` alone; v0.9.27 predates the guard and claims it. So every run (and a Ctrl-C) ends by unregistering each bundle it launched (`lsregister -u`) and checking that `yaseendocs://` opens `/Applications/Yaseen Docs.app` again. The JSON records the answer as `yaseendocsHandler`, and anything else prints a warning.

## Scenarios

The big notes copy the shapes the YAZ-2132 scope measured (`genVault.mjs`), so their numbers line up with its baseline and locked targets: the "bullet" notes are its mixed outline note (headings, 3-level bullets, tasks, links, some code), "prose" and "code" its `Big 5k prose` and `Big 5k`. Vaults of N notes come from `desktop/e2e/fixtures/genVault.mjs` (seed 42).

| Scenario | Measures |
|---|---|
| `launch` | spawn → main JS → navigation → first paint → the restored note painted (warm profile, 2 tabs); spawn → note on a fresh profile, with 10 restored tabs, and with 3 windows (the last one's note) |
| `open-big` | click a 1k / 5k / 20k-line bullet note, a 5k prose note, a 5k code note → painted, and the longest task. 90 s cap per open: past it, `timedOut` and null for the rest |
| `typing` | keydown → next frame per key (40 keys) at the end of a 5k and a 20k-line bullet note, and of a 5k-line prose note twice: with "Section indent" off (`prose5k`) and turned on from the page cog (`prose5kIndent`, YAZ-2724). The prose note has about 1,800 top-level blocks, which is what that feature costs on, so the two rows apart are its cost per key. Null when the note is not painted within 90 s, and for `prose5kIndent` on a build with no such switch. The two prose rows are written, not yet run |
| `open-big-code` | click the 5 MB code file (`scenarios/bigCode.mjs`: 52,000 lines, 260,000 symbols, the demo vault's `speed/big-5mb.ts`) → its first lines painted, the longest task, and the time until its Outline is there (YAZ-3501). Written, not yet run |
| `typing-code` | keydown → next frame per key, 20 keys typed into that file in 4 bursts of 5 with a 700 ms pause after each (each pause sets off the Outline's read and sticky scroll), and the longest task while typing. Target: every key under 16 ms (YAZ-3438). Written, not yet run; the hidden `codeTab.spec.ts` step 11 measures the same |
| `sidebar-resize` | per mouse move while dragging the sidebar edge with 3 mounted tabs, move → next frame |
| `tab-switch` | click a tab → painted: first visit (mounts an editor) and revisits |
| `multi-vault` | one window on two 2k-note vaults, two tabs of each (YAZ-2602): spawn → the restored note painted; click a tab → painted, for a switch inside one vault and for a switch between the two, which must measure the same (S80). Written, not yet run |
| `storm` | 230 adds, then 230 renames, outside the app in a 2k-note vault: main CPU s, main peak RSS, longest IPC round trip seen by the renderer, settle time |
| `watcher` | main's open fds at 2k and 10k notes; on 2k, an outside add → tree row and an outside edit → editor |
| `idle` | 60 s alone: CPU % and RSS per process kind (main, renderer, gpu, utility) |
| `quit` | `app.quit()` → main process gone |
| `drawio` | click a `.drawio` (30 boxes) in the tree → draw.io's `load` message, marked in the page as `window.__drawioLoad` (Draw's scenario, YAZ-3044 A19). Ceiling: `drawio.drawioOpenMs` 760 ms. Written, not yet run |
| `long-day` | **Opt-in** (not in `all`), 1 run, no warm-up, the app HIDDEN (`YASEEN_DOCS_E2E_HIDDEN=1`, in-page events only). One window on a 2k-note vault, `--cycles` cycles (10): each opens 20 kept tabs (double click on the tree row: 1k and 5k bullet notes, 5k prose, twelve 200-line notes, a `.drawio`, an `.excalidraw` with 3 pictures, small `.ts` and `.py`, the 5 MB `.ts`), switches tabs, types, shows and hides the right panel, then closes them all with their ✕. After each cycle, GC 3 times: the renderer's JS heap, its workers' heaps (Monaco's TS worker), Blink's heap, the DOM counters, RSS and physical footprint summed over every renderer helper, and main's heap (S12); per cycle in the JSON's `series`. The run ends idle: it waits for the TS worker to stop (2 min after the last code tab closes, YAZ-3862), then 30 s more, then takes one more sample (`settled` in `series`): the `…EndMb` numbers are that one, `…LastCycleMb` the last cycle's. On macOS, RSS swings with memory pressure; the footprint (`footprint -p`, Activity Monitor's Memory column) does not. Before the cycles (S11): the RSS and heap of a window with no tab and of one with one tab, and of a no-tab window on an empty vault (the gap is the vault's cost per window). `--snapshots`: heap snapshots after cycle 1 and the last into `<work>/snapshots`, kept when the run ends. Before numbers: `runs/long-day-before.json` (YAZ-3861). `npm run build && npm run perf -- long-day --app desktop/out/main/index.js` |

## Timing ceilings

`budget.json`'s `perf` rows (`<scenario>.<metric>`, YAZ-3044 A19) are checked against each scenario's median after a run: a median over `max` by more than `perfTolerance` (15 %) prints `OVER:` and the run exits 1. `drawio.drawioOpenMs` (760 ms) is Draw's ceiling, kept by YAZ-3028 D5. Local only, like the harness.

A row's own `tolerance` replaces `perfTolerance`. long-day's four memory rows (YAZ-3737 D7, YAZ-3862) have `tolerance: 0`: `heapEndOverStartRatio` ≤ 1.1 (the JS heap after GC at the last cycle over cycle 3's: cycles 1 and 2 are V8 compiling the app's code), `heapSlopeMbPerCycle` ≤ 1 MB (over every cycle: the main leak signal), `rendererRssEndMb` ≤ 450 MB and `rendererFootprintEndMb` ≤ 1,000 MB at the idle end of the run (see each `$comment`). After numbers, with the base build in the same session (`--vs`): `runs/long-day-after-4.json`.
