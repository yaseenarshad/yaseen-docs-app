#!/usr/bin/env node
/**
 * USAGE: npm run perf -- <scenario…|all> [--runs 5] [--app <.app>] [--vs <.app>] [--work <dir>] [--out <file.json>]
 *
 * The local perf harness (YAZ-2131 1C). Launches the packaged app on generated fixtures in isolated
 * profiles, runs each scenario `--runs` times after one discarded warm-up, and writes JSON: per
 * metric the median, p95, min, max, cv (noise) and every run, plus the machine load of every run.
 * Local only: it opens real windows.
 *   --app   the build to measure (default: desktop/dist-app/mac-arm64/Yaseen Docs.app)
 *   --vs    a second build, interleaved run by run in ABBA order (A B, B A, …), each with its own
 *           warm-up, fixtures and profiles; the table shows both and the change
 *   --work  scratch dir for vaults and profiles (default <tmpdir>/yaseen-docs-perf); must be under a
 *           temp root and empty or this harness's own; removed when the run ends
 *   --out   where the JSON goes (default <tmpdir>/yaseen-docs-perf-<time>.json)
 * Compare builds on the same machine, idle, with the same --runs. A scenario whose runs saw a
 * 1-minute load over 10 is flagged `noisy`; its time and CPU metrics are `loadSensitive`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimWorkDir } from './lib/work.mjs'
import { INSTALLED_APP, killLaunched, releaseLaunchServices } from './lib/app.mjs'
import { abba, loadSensitive, summarizeRuns } from './lib/stats.mjs'
import * as launch from './scenarios/launch.mjs'
import * as openBig from './scenarios/open-big.mjs'
import * as typing from './scenarios/typing.mjs'
import * as sidebarResize from './scenarios/sidebar-resize.mjs'
import * as tabSwitch from './scenarios/tab-switch.mjs'
import * as storm from './scenarios/storm.mjs'
import * as watcher from './scenarios/watcher.mjs'
import * as idle from './scenarios/idle.mjs'
import * as quit from './scenarios/quit.mjs'

const SCENARIOS = { launch, 'open-big': openBig, typing, 'sidebar-resize': sidebarResize, 'tab-switch': tabSwitch, storm, watcher, idle, quit }

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (name, dflt) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt)
const names = argv.filter((a, i) => !a.startsWith('--') && !/^--(runs|app|vs|work|out)$/.test(argv[i - 1] ?? ''))
const todo = names.includes('all') ? Object.keys(SCENARIOS) : names
const unknown = todo.filter((n) => !SCENARIOS[n])
if (todo.length === 0 || unknown.length > 0) {
  console.error(`usage: npm run perf -- <${Object.keys(SCENARIOS).join('|')}|all> [--runs 5] [--app <.app>] [--vs <.app>] [--work <dir>] [--out <file.json>]${unknown.length ? `\nunknown: ${unknown.join(', ')}` : ''}`)
  process.exit(2)
}
const runs = Number(opt('runs', '5'))
const bundles = [opt('app', path.join(here, '../../desktop/dist-app/mac-arm64/Yaseen Docs.app')), opt('vs')].filter(Boolean).map((b) => path.resolve(b))
const apps = bundles.map((b) => ({ bin: path.join(b, 'Contents/MacOS/Yaseen Docs') }))
for (const { bin } of apps) {
  if (fs.existsSync(bin)) continue
  console.error(`no app binary at ${bin}: run \`npm run desktop:build\`, or pass --app`)
  process.exit(2)
}
const out = path.resolve(opt('out', path.join(os.tmpdir(), `yaseen-docs-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)))
const work = claimWorkDir(path.resolve(opt('work', path.join(os.tmpdir(), 'yaseen-docs-perf'))))
const load1 = () => Math.round(os.loadavg()[0] * 10) / 10
/** Above this 1-minute load a timing run is not a usable number (several agents share this Mac). */
const NOISY_LOAD = 10
/** Leaves the machine as it was: nothing of ours running, the work dir gone, `yaseendocs://` back on the installed app. */
function teardown() {
  killLaunched()
  work.remove()
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
    const contenders = apps.map((app, j) => ({ app, fx: scenario.setup(work.dirFor(j ? `${name}~vs` : name)), results: [] }))
    const load = []
    for (let i = 0; i <= runs; i++) {
      for (const c of abba(i, contenders)) {
        const at = load1()
        const r = await scenario.run(c.app, c.fx)
        // Run 0 warms the OS file cache and Chromium's caches.
        if (i > 0) {
          c.results.push(r)
          load.push(at)
        }
        console.error(`${name} ${c === contenders[0] ? 'app' : 'vs'} run ${i}${i ? '' : ' (warm-up)'} load ${at}: ${JSON.stringify(r)}`)
      }
    }
    const metrics = summarizeRuns(contenders[0].results)
    report.scenarios[name] = {
      load: { min: Math.min(...load), max: Math.max(...load), runs: load },
      noisy: Math.max(...load) > NOISY_LOAD,
      loadSensitive: Object.keys(metrics).filter(loadSensitive),
      metrics,
      ...(contenders[1] && { vs: summarizeRuns(contenders[1].results) }),
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
