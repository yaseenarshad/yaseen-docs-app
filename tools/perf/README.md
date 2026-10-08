# tools/perf

Two tools (YAZ-2131): a size and integrity gate that CI runs, and a local perf harness that drives the real app.

| File | What |
|---|---|
| `measureBudget.mjs` | `npm run perf:budget` / `perf:budget:ci`: the gate (see `docs/CONTRACTS.md` "Packaging") |
| `budget.json` | the gate's ceilings. **Ratchet:** a PR that shrinks a row lowers its ceiling; raising one needs Yasin's OK |
| `baseline.json` | FROZEN v0.9.27 @ 63aeeea numbers: `size` from the gate, `perf` from the harness. Never edited |
| `run.mjs`, `scenarios/`, `lib/`, `genVault.mjs` | `npm run perf`: the harness |
| `runs/` | the raw before/after A/B and budget JSON behind the 7A ratchet (YAZ-2204) |

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
| `typing` | keydown → next frame per key (40 keys) at the end of a 5k and a 20k-line bullet note; null when the note is not painted within 90 s |
| `sidebar-resize` | per mouse move while dragging the sidebar edge with 3 mounted tabs, move → next frame |
| `tab-switch` | click a tab → painted: first visit (mounts an editor) and revisits |
| `multi-vault` | one window on two 2k-note vaults, two tabs of each (YAZ-2602): spawn → the restored note painted; click a tab → painted, for a switch inside one vault and for a switch between the two, which must measure the same (S80). Written, not yet run |
| `storm` | 230 adds, then 230 renames, outside the app in a 2k-note vault: main CPU s, main peak RSS, longest IPC round trip seen by the renderer, settle time |
| `watcher` | main's open fds at 2k and 10k notes; on 2k, an outside add → tree row and an outside edit → editor |
| `idle` | 60 s alone: CPU % and RSS per process kind (main, renderer, gpu, utility) |
| `quit` | `app.quit()` → main process gone |
