#!/usr/bin/env node
/**
 * USAGE: npm run perf -- <scenario…|all> [--runs 5] [--app <.app>] [--vs <.app>] [--work <dir>] [--out <file.json>] [--cycles 10] [--snapshots]
 *
 * The local perf harness (YAZ-2131 1C). Launches the packaged app on generated fixtures in isolated
 * profiles, runs each scenario `--runs` times after one discarded warm-up, and writes JSON: per
 * metric the median, p95, min, max, cv (noise) and every run, plus the machine load of every run.
 * Local only: it opens real windows.
 *   --app   the build to measure (default: desktop/dist-app/mac-arm64/Yaseen Docs.app), or an unpacked
 *           build's main entry (`desktop/out/main/index.js` after `npm run build`), run by Electron's binary
 *   --vs    a second build, interleaved run by run in ABBA order (A B, B A, …), each with its own
 *           warm-up, fixtures and profiles; the table shows both and the change
 *   --work  scratch dir for vaults and profiles (default <tmpdir>/yaseen-docs-perf); must be under a
 *           temp root and empty or this harness's own; removed when the run ends
 *   --out   where the JSON goes (default <tmpdir>/yaseen-docs-perf-<time>.json)
 *   --cycles  long-day's cycle count (default 10)
 *   --snapshots  long-day writes renderer heap snapshots at cycle 1 and the last into <work>/snapshots,
 *           which the end of the run keeps (never in the repo: --work is a temp dir)
 * A scenario may export `runs` and `warmup` (long-day: 1 and 0) and `optIn` (not in `all`; YAZ-3861).
 * Compare builds on the same machine, idle, with the same --runs. A scenario whose runs saw a
 * 1-minute load over 10 is flagged `noisy`; its time and CPU metrics are `loadSensitive`.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimWorkDir } from './lib/work.mjs'
import { INSTALLED_APP, killLaunched, releaseLaunchServices } from './lib/app.mjs'
import { abba, loadSensitive, overCeilings, summarizeRuns } from './lib/stats.mjs'
import * as launch from './scenarios/launch.mjs'
import * as openBig from './scenarios/open-big.mjs'
import * as typing from './scenarios/typing.mjs'
import * as openBigCode from './scenarios/open-big-code.mjs'
import * as typingCode from './scenarios/typing-code.mjs'
import * as sidebarResize from './scenarios/sidebar-resize.mjs'
import * as tabSwitch from './scenarios/tab-switch.mjs'
import * as multiVault from './scenarios/multi-vault.mjs'
import * as storm from './scenarios/storm.mjs'
import * as watcher from './scenarios/watcher.mjs'
import * as idle from './scenarios/idle.mjs'
import * as quit from './scenarios/quit.mjs'
import * as drawio from './scenarios/drawio.mjs'
import * as longDay from './scenarios/long-day.mjs'

const SCENARIOS = { launch, 'open-big': openBig, typing, 'open-big-code': openBigCode, 'typing-code': typingCode, 'sidebar-resize': sidebarResize, 'tab-switch': tabSwitch, 'multi-vault': multiVault, storm, watcher, idle, quit, drawio, 'long-day': longDay }

const here = path.dirname(fileURLToPath(import.meta.url))
/** The timing ceilings (YAZ-3044 A19): budget.json's `perf` rows, checked against each scenario's medians. */
const { perf: ceilings = {}, perfTolerance = 0 } = JSON.parse(fs.readFileSync(path.join(here, 'budget.json'), 'utf8'))
const argv = process.argv.slice(2)
const opt = (name, dflt) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt)
const names = argv.filter((a, i) => !a.startsWith('--') && !/^--(runs|app|vs|work|out|cycles)$/.test(argv[i - 1] ?? ''))
// An opt-in scenario (long-day, YAZ-3861) runs only when it is named.
const todo = names.includes('all') ? Object.keys(SCENARIOS).filter((n) => !SCENARIOS[n].optIn) : names
const unknown = todo.filter((n) => !SCENARIOS[n])
if (todo.length === 0 || unknown.length > 0) {
  console.error(`usage: npm run perf -- <${Object.keys(SCENARIOS).join('|')}|all> [--runs 5] [--app <.app>] [--vs <.app>] [--work <dir>] [--out <file.json>] [--cycles 10] [--snapshots]${unknown.length ? `\nunknown: ${unknown.join(', ')}` : ''}`)
  process.exit(2)
}
const runs = Number(opt('runs', '5'))
const bundles = [opt('app', path.join(here, '../../desktop/dist-app/mac-arm64/Yaseen Docs.app')), opt('vs')].filter(Boolean).map((b) => path.resolve(b))
// A `.js` is an unpacked build's main entry (YAZ-3861): Electron's binary runs it, as the e2e suite does.
const apps = bundles.map((b) => (b.endsWith('.js') ? { bin: createRequire(import.meta.url)('electron'), args: [b] } : { bin: path.join(b, 'Contents/MacOS/Yaseen Docs') }))
for (const { bin, args = [] } of apps) {
  if ([bin, ...args].every((f) => fs.existsSync(f))) continue
  console.error(`no app at ${[bin, ...args].join(' ')}: run \`npm run desktop:build\` (or \`npm run build\` for desktop/out), or pass --app`)
  process.exit(2)
}
const out = path.resolve(opt('out', path.join(os.tmpdir(), `yaseen-docs-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)))
const work = claimWorkDir(path.resolve(opt('work', path.join(os.tmpdir(), 'yaseen-docs-perf'))))
const scenarioOpts = { cycles: Number(opt('cycles', '10')), snapshots: argv.includes('--snapshots') ? path.join(work.root, 'snapshots') : null }
const load1 = () => Math.round(os.loadavg()[0] * 10) / 10
/** Above this 1-minute load a timing run is not a usable number (several agents share this Mac). */
const NOISY_LOAD = 10
/** Leaves the machine as it was: nothing of ours running, the work dir gone, `yaseendocs://` back on the installed app. */
function teardown() {
  killLaunched()
  work.remove(scenarioOpts.snapshots === null ? undefined : 'snapshots')
  if (scenarioOpts.snapshots !== null) console.error(`heap snapshots kept in ${scenarioOpts.snapshots}`)
  const handler = releaseLaunchServices(bundles)
  if (handler !== INSTALLED_APP) console.error(`WARNING: yaseendocs:// now opens ${handler}, not ${INSTALLED_APP}. Launch the installed app once to take it back.`)
  return handler
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    teardown()
    process.exit(130)
  })
}

const report = { app: bundles[0], ...(bundles[1] && { vs: bundles[1] }), machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, os: `${os.type()} ${os.release()}` }, runs, warmupDiscarded: 1, scenarios: {} }
try {
  for (const name of todo) {
    const scenario = SCENARIOS[name]
    const contenders = apps.map((app, j) => ({ app, fx: scenario.setup(work.dirFor(j ? `${name}~vs` : name), scenarioOpts), results: [], series: [] }))
    const load = []
    // A scenario's own `runs` / `warmup` win (long-day: one run, no warm-up, YAZ-3737 D7).
    const [n, warmup] = [scenario.runs ?? runs, scenario.warmup ?? 1]
    for (let i = 1 - warmup; i <= n; i++) {
      for (const c of abba(i, contenders)) {
        const at = load1()
        // `series` (long-day's per-cycle numbers) is kept beside the metrics, not summarized.
        const { series, ...r } = await scenario.run(c.app, c.fx)
        // Run 0 warms the OS file cache and Chromium's caches.
        if (i > 0) {
          c.results.push(r)
          if (series !== undefined) c.series.push(series)
          load.push(at)
        }
        console.error(`${name} ${c === contenders[0] ? 'app' : 'vs'} run ${i}${i ? '' : ' (warm-up)'} load ${at}: ${JSON.stringify(r)}`)
      }
    }
    const metrics = summarizeRuns(contenders[0].results)
    const over = overCeilings(name, metrics, ceilings, perfTolerance)
    report.scenarios[name] = {
      ...((n !== runs || warmup !== 1) && { runs: n, warmupDiscarded: warmup }),
      over,
      load: { min: Math.min(...load), max: Math.max(...load), runs: load },
      noisy: Math.max(...load) > NOISY_LOAD,
      loadSensitive: Object.keys(metrics).filter(loadSensitive),
      metrics,
      ...(contenders[1] && { vs: summarizeRuns(contenders[1].results) }),
      ...(contenders[0].series.length > 0 && { series: contenders[0].series }),
      ...(contenders[1]?.series.length > 0 && { vsSeries: contenders[1].series }),
    }
  }
} finally {
  report.yaseendocsHandler = teardown()
}
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

const fmt = (s) => (s?.median == null ? '-' : `${s.median} / ${s.p95}`)
for (const [name, s] of Object.entries(report.scenarios)) {
  console.log(`\n${name}  (load ${s.load.min}–${s.load.max}${s.noisy ? ', NOISY' : ''})    median / p95${s.vs ? '    vs    change' : ''}`)
  for (const [k, m] of Object.entries(s.metrics)) {
    const v = s.vs?.[k]
    const change = m?.median != null && v?.median ? ` ${m.median - v.median > 0 ? '+' : ''}${Math.round(((m.median - v.median) / v.median) * 100)} %` : ''
    console.log(`  ${k.padEnd(28)} ${fmt(m).padStart(20)}${s.vs ? `  ${fmt(v).padStart(20)}${change}` : ''}`)
  }
}
console.log(`\nJSON: ${out}`)
// A median over its ceiling (budget.json `perf`, with `perfTolerance`) fails the run, as in Draw.
const over = Object.values(report.scenarios).flatMap((s) => s.over)
for (const line of over) console.error(`OVER: ${line}`)
if (over.length > 0) process.exitCode = 1
