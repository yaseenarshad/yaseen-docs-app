/** quit: ⌘Q (`app.quit()`, what the menu item calls) → the main process is gone, with 2 tabs open. Null when it had to be killed. */
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { launch, sleep } from '../lib/app.mjs'
import { painted } from '../lib/session.mjs'
import { writeState } from '../lib/work.mjs'

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  return { profile: path.join(dir, 'profile'), vault, tabs: [writeNote(vault, 'Quit A', 'bullets', 200), writeNote(vault, 'Quit B', 'prose', 200)] }
}

export async function run(app, { profile, vault, tabs }) {
  writeState(profile, [{ id: 'w1', root: vault, tabs }])
  const proc = await launch({ ...app, profile })
  try {
    const pages = await proc.windows()
    await pages[0].waitFor(painted('Quit A'))
    await sleep(1000)
  } catch (e) {
    await proc.quit()
    throw e
  }
  const t = performance.timeOrigin + performance.now()
  const gone = await proc.quit()
  return { quitMs: gone === null ? null : gone - t }
}
