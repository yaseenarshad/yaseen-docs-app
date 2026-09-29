/**
 * idle: a window on a 200-note vault with 2 tabs, left alone for 60 s after a 5 s settle. CPU % and
 * RSS at the end per process kind (main, renderer, gpu, utility), each kind summed over its processes.
 */
import path from 'node:path'
import { writeNote, writeVault } from '../genVault.mjs'
import { helpers, sleep, usage } from '../lib/app.mjs'
import { session } from '../lib/session.mjs'

const IDLE_MS = 60_000

export function setup(dir) {
  const vault = writeVault(path.join(dir, 'vault'), 200)
  return { profile: path.join(dir, 'profile'), vault, tabs: [writeNote(vault, 'Idle A', 'bullets', 200), writeNote(vault, 'Idle B', 'prose', 200)] }
}

export function run(app, { profile, vault, tabs }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs }], doc: 'Idle A' }, async ({ proc }) => {
    await sleep(5000)
    const kinds = [{ pid: proc.pid, type: 'main' }, ...helpers(proc.pid)].map((p) => ({ ...p, type: p.type === 'gpu-process' ? 'gpu' : p.type }))
    const pids = kinds.map((k) => k.pid)
    const before = usage(pids)
    await sleep(IDLE_MS)
    const after = usage(pids)
    const out = {}
    for (const { pid, type } of kinds) {
      if (!after.has(pid)) continue
      out[`${type}CpuPct`] = (out[`${type}CpuPct`] ?? 0) + ((after.get(pid).cpuSec - before.get(pid).cpuSec) / (IDLE_MS / 1000)) * 100
      out[`${type}RssMb`] = (out[`${type}RssMb`] ?? 0) + after.get(pid).rssMb
    }
    return out
  })
}
