/**
 * THE APP'S OWN FRONTMATTER WRITE NEVER RAISES "File changed on disk" (YAZ-2175, reliability R2).
 * A property tick or a posted comment is `transformFile`: read, rewrite the frontmatter, write with
 * `expectedMtime`. Landing 600–660 ms after the last body keystroke, it beats its own watcher echo
 * (the watcher's 100 ms settle, YAZ-2192) to the body's debounced autosave, whose `expectedMtime` is
 * then stale: CONFLICT. Before YAZ-2175 that showed the bar 7 of 12 times, and its "Reload" discarded
 * the typing. Now a CONFLICT whose disk BODY is still ours adopts the new frontmatter and retries
 * once. A probe in main counts the `fs:write` CONFLICT answers, so every run proves it took that path
 * rather than absorbing the echo first (which would pass without testing R2).
 *
 * The other direction is pinned beside it with the same timing: a write that changes the BODY is a
 * real conflict and still raises the bar.
 *
 * The write is made from the page through the same bridge calls `transformFile` makes. The
 * acceptance bar is 12 of 12 for the frontmatter case: run with `--repeat-each=4`.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTRACT } from '../../shared/ipc'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, SEED_FILE, seededState, typeMarkerAtLastBullet } from './helpers'

let app: ElectronApplication | null = null
const dirs: string[] = []

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = null
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/**
 * Counts, in main, the `fs:write` answers that are CONFLICT. The envelope handler is wrapped through
 * Electron's own invoke-handler table (`ipcMain._invokeHandlers`, internal): if that ever moves, the
 * probe throws rather than count nothing.
 */
async function countWriteConflicts(a: ElectronApplication): Promise<() => Promise<number>> {
  await a.evaluate(({ ipcMain }, channel) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers
    const original = handlers?.get(channel)
    if (handlers === undefined || original === undefined) throw new Error(`no invoke handler for ${channel}: Electron's ipcMain internals moved`)
    const probe = globalThis as unknown as { writeConflicts: number }
    probe.writeConflicts = 0
    handlers.set(channel, async (...args: unknown[]) => {
      const answer = (await original(...args)) as { ok: boolean; error?: { code?: string } }
      if (!answer.ok && answer.error?.code === 'CONFLICT') probe.writeConflicts++
      return answer
    })
  }, CONTRACT.writeFile.channel)
  return () => a.evaluate(() => (globalThis as unknown as { writeConflicts: number }).writeConflicts)
}

/** Types a marker into the note body and returns it, with the file path; the autosave is left pending. */
async function typeIntoNote(): Promise<{ win: Page; file: string; marker: string; conflicts: () => Promise<number> }> {
  const src = await buildFixtureVault()
  const vault = await copyVault(src)
  const userData = await mkdtemp(path.join(tmpdir(), 'fmrace-'))
  dirs.push(src, vault, userData)
  const file = path.join(vault, SEED_FILE)
  app = await launchApp({ userData, seedState: seededState(vault, file) })
  const win = await appWindow(app, 'w1')
  const conflicts = await countWriteConflicts(app)
  const marker = await typeMarkerAtLastBullet(win, 'BODY')
  return { win, file, marker, conflicts }
}

/** `transformFile`'s two bridge calls, from the page: read, apply `edit`, write against the read mtime. */
async function writeFromPage(win: Page, file: string, edit: 'frontmatter' | 'body'): Promise<void> {
  await win.evaluate(
    async ({ p, edit }) => {
      const api = (window as unknown as { yaseenDocs: { readFile: (p: string) => Promise<{ content: string; mtime: number }>; writeFile: (r: object) => Promise<unknown> } }).yaseenDocs
      const f = await api.readFile(p)
      const content = edit === 'frontmatter' ? `---\nstatus: draft\n---\n${f.content}` : `${f.content}\nsomeone else's line\n`
      await api.writeFile({ path: p, content, expectedMtime: f.mtime })
    },
    { p: file, edit },
  )
}

// The window: the body's autosave fires ~700 ms after the last keystroke (Crepe's 200 ms listener +
// the 500 ms debounce), and the write's own echo reaches the editor ~100 ms after it lands (the
// watcher's settle). Only a write in between meets the stale mtime. Measured on the merged build
// (5 runs each, the probe above): 570 ms 4/5, 600–660 ms 5/5, 690 ms and later 0/5 (the autosave
// wins); the 450/550 ms of the 200 ms-settle days no longer reach the CONFLICT at all.
for (const delayMs of [600, 630, 660]) {
  test(`a frontmatter write ${delayMs} ms after the last keystroke: no bar, and both edits on disk`, async () => {
    const { win, file, marker, conflicts } = await typeIntoNote()
    await win.waitForTimeout(delayMs)
    await writeFromPage(win, file, 'frontmatter')
    await expect.poll(async () => readFile(file, 'utf8'), { timeout: 10_000 }).toContain(marker)
    expect(await conflicts(), 'the autosave met the CONFLICT and retried (R2), not an absorbed echo').toBe(1)
    await win.waitForTimeout(1000) // past the watcher's settle: nothing late may raise the bar either
    await expect(win.locator('.conflict-bar')).toHaveCount(0)
    const disk = await readFile(file, 'utf8')
    expect(disk.startsWith('---\nstatus: draft\n---\n'), disk.slice(0, 200)).toBe(true)
    await quitApp(app!)
    app = null
    expect(await readFile(file, 'utf8')).toContain(marker)
  })

  test(`a BODY write ${delayMs} ms after the last keystroke still raises the bar`, async () => {
    const { win, file, marker, conflicts } = await typeIntoNote()
    await win.waitForTimeout(delayMs)
    await writeFromPage(win, file, 'body')
    await expect(win.locator('.conflict-bar')).toBeVisible({ timeout: 10_000 })
    expect(await conflicts()).toBe(1)
    await expect(win.locator('.conflict-bar')).toContainText('File changed on disk.')
    expect(await readFile(file, 'utf8')).not.toContain(marker) // nothing was overwritten behind the user's back
  })
}
