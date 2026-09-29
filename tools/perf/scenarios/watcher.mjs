/**
 * watcher: file descriptors main holds with a 2k- and a 10k-note vault open, and on the 2k vault the
 * latency from an outside change to the app showing it: a new note's tree row, and a line appended
 * to the open note appearing in its editor. 5 of each per run, median.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { writeNote, writeVault } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { ACTIVE, js, row, session } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'

/** Open file descriptors of `pid` (`lsof -Ff` prints one `f<fd>` line each). */
const fds = (pid) => execFileSync('lsof', ['-p', String(pid), '-Ff'], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => /^f\d/.test(l)).length

export function setup(dir) {
  const vaults = Object.fromEntries([['2k', 2000], ['10k', 10000]].map(([key, n]) => [key, writeVault(path.join(dir, `vault-${key}`), n)]))
  return { dir, vaults, small: Object.fromEntries(Object.entries(vaults).map(([key, v]) => [key, writeNote(v, 'Small', 'bullets', 20)])) }
}

export async function run(app, { dir, vaults, small }) {
  const out = {}
  for (const key of ['2k', '10k']) {
    const vault = vaults[key]
    await session(app, { profile: path.join(dir, `profile-${key}`), wins: [{ id: 'w1', root: vault, tabs: [small[key]] }], doc: 'Small' }, async ({ proc, page }) => {
      await sleep(3000) // the watcher is ready
      out[`fds${key}`] = fds(proc.pid)
      if (key !== '2k') return
      const add = []
      const change = []
      for (let i = 0; i < 5; i++) {
        const file = path.join(vault, `Outside ${i}.md`)
        let t = performance.now()
        fs.writeFileSync(file, `# Outside ${i}\n`)
        await page.waitFor(`!!document.querySelector(${js(row(file))})`)
        add.push(performance.now() - t)
        fs.rmSync(file)
        await sleep(500)
        t = performance.now()
        fs.appendFileSync(small[key], `\noutside-edit-${i}\n`)
        await page.waitFor(`document.querySelector('${ACTIVE}').textContent.includes('outside-edit-${i}')`)
        change.push(performance.now() - t)
        await sleep(500)
      }
      out.addToRowMs = quantiles(add).p50
      out.changeToEditorMs = quantiles(change).p50
    })
  }
  writeNote(vaults['2k'], 'Small', 'bullets', 20) // undo the appended lines for the next run
  return out
}
