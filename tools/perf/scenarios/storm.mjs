/**
 * storm: 230 notes added, then those 230 renamed, outside the app (a git pull, a bulk rename) in a
 * 2k-note vault it has open. Per phase until main settles: main CPU seconds, main's peak RSS, and
 * the longest IPC round trip the renderer saw (`state.get` every 50 ms: the stall a user feels).
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeNote, writeVault } from '../genVault.mjs'
import { sleep, usage } from '../lib/app.mjs'
import { session } from '../lib/session.mjs'

const N = 230
const SETTLE_TIMEOUT_MS = 60_000
const IPC_PROBE = `window.__ipc ??= (() => { const s = { max: 0 }; (async () => { for (;;) { const t = performance.now(); await yaseenDocs.state.get(); s.max = Math.max(s.max, performance.now() - t); await new Promise((r) => setTimeout(r, 50)) } })(); return s })(), __ipc.max = 0`

export function setup(dir) {
  const vault = writeVault(path.join(dir, 'vault'), 2000)
  return { profile: path.join(dir, 'profile'), vault, small: writeNote(vault, 'Small', 'bullets', 20), storm: path.join(vault, 'Storm') }
}

/** Runs `act`, then samples main every 250 ms until its CPU stays flat for 1 s; metrics prefixed with `name`. */
async function phase(page, pid, name, act) {
  await page.ev(IPC_PROBE)
  const cpu0 = usage([pid]).get(pid).cpuSec
  const t0 = performance.now()
  await act()
  let peak = 0
  let flatSince = null
  let last = cpu0
  while (performance.now() - t0 < SETTLE_TIMEOUT_MS) {
    await sleep(250)
    const u = usage([pid]).get(pid)
    peak = Math.max(peak, u.rssMb)
    if (u.cpuSec - last > 0.02) flatSince = null
    else flatSince ??= performance.now()
    last = u.cpuSec
    if (flatSince !== null && performance.now() - flatSince >= 1000) break
  }
  return { [`${name}CpuSec`]: last - cpu0, [`${name}PeakRssMb`]: peak, [`${name}IpcMaxMs`]: await page.ev('__ipc.max'), [`${name}SettleMs`]: (flatSince ?? performance.now()) - t0 }
}

export function run(app, { profile, vault, small, storm }) {
  fs.rmSync(storm, { recursive: true, force: true })
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small' }, async ({ proc, page }) => {
    await sleep(3000) // watcher ready, index built
    const names = Array.from({ length: N }, (_, k) => path.join(storm, `pulled-${k}.md`))
    const add = await phase(page, proc.pid, 'add', async () => {
      fs.mkdirSync(storm)
      await Promise.all(names.map((f, k) => fs.promises.writeFile(f, `---\ntags: [storm]\n---\n# Pulled ${k}\n\nSee [[Small]]\n`)))
    })
    const rename = await phase(page, proc.pid, 'rename', () => Promise.all(names.map((f) => fs.promises.rename(f, f.replace(/pulled-/, 'renamed-')))))
    return { ...add, ...rename }
  })
}
