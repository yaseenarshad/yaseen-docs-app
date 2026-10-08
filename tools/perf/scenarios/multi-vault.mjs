/**
 * multi-vault: ONE window on two 2k-note vaults (YAZ-2602), two 200-line bullet notes of each open
 * as tabs. Spawn → the restored note painted; then click a tab → its note painted plus a frame, as
 * `tab-switch` measures a revisit, 20 switches round a ring: every other one stays INSIDE a vault and
 * every other one goes BETWEEN the two. S80 is the claim: the two measure the same, within noise,
 * because every vault of the window stays loaded (D1). S79, a window on one vault, is `launch`,
 * `tab-switch` and `typing` with `--vs` a build from before this work.
 *
 * WRITTEN, NOT RUN: `npm run perf` starts the app, which an agent may not do here. The first person
 * to run it corrects what it finds: `npm run desktop:build && npm run perf -- multi-vault --runs 5`.
 * Under `--vs` a build from before YAZ-2602 drops `roots` and opens the first vault alone, where the
 * other vault's tabs are files outside the vault: its `between` numbers are of that, not of two vaults.
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeNote, writeVault } from '../genVault.mjs'
import { launch, sleep } from '../lib/app.mjs'
import { clickUntilPainted, painted, tab } from '../lib/session.mjs'
import { PAGE_PROBES, quantiles } from '../lib/stats.mjs'
import { writeState } from '../lib/work.mjs'

/** The tabs, left to right: two notes of the first vault, then two of the second. The switches go round it. */
export const RING = ['Alpha 1', 'Alpha 2', 'Beta 1', 'Beta 2']
/** Switch `i` lands on `RING[i % 4]`: an even one crosses to the other vault, an odd one stays inside its own. */
export const crosses = (i) => i % 2 === 0
const SWITCHES = 20
/** The size `storm` and `watcher` use: a switch that read a vault's index again would show at it. */
const NOTES = 2000

export function setup(dir) {
  const vaults = ['a', 'b'].map((key) => writeVault(path.join(dir, `vault-${key}`), NOTES))
  return { profile: path.join(dir, 'profile'), vaults, files: RING.map((name, i) => writeNote(vaults[i < 2 ? 0 : 1], name, 'bullets', 200)) }
}

/**
 * `writeState` for one window on SEVERAL vaults: it seeds a window on its `root` alone, so the list
 * of vaults (`WindowEntry.roots`, `root` first) is put in here before the launch.
 */
export function seedVaults(profile, vaults, tabs) {
  writeState(profile, [{ id: 'w1', root: vaults[0], tabs }])
  const file = path.join(profile, 'yaseendocs.json')
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  state.windows[0].roots = vaults
  fs.writeFileSync(file, JSON.stringify(state, null, 2))
}

/** `session` with that seed (lib/session.mjs seeds through `writeState`): launch, wait for the restored note, act, always quit. */
export async function run(app, { profile, vaults, files }) {
  seedVaults(profile, vaults, files)
  const proc = await launch({ ...app, profile })
  try {
    const [page] = await proc.windows(1)
    const docAt = await page.waitFor(painted(RING[0]))
    await page.ev(PAGE_PROBES)
    await sleep(500)
    const visit = (i) => page.ev(clickUntilPainted(tab(files[i % 4]), RING[i % 4]))
    // Every tab is visited once, so each switch below is a revisit: no editor mounts under the clock.
    for (const i of [1, 2, 3, 0]) await visit(i)
    const ms = { inside: [], between: [] }
    for (let i = 1; i <= SWITCHES; i++) {
      await sleep(300)
      ms[crosses(i) ? 'between' : 'inside'].push((await visit(i)).ms)
    }
    const [inside, between] = [quantiles(ms.inside), quantiles(ms.between)]
    return { spawnToDocMs: docAt - proc.spawnedAt, insideP50Ms: inside.p50, insideP95Ms: inside.p95, betweenP50Ms: between.p50, betweenP95Ms: between.p95 }
  } finally {
    await proc.quit()
  }
}
