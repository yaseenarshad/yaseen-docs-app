/**
 * THE APP'S OWN FRONTMATTER WRITE NEVER RAISES "File changed on disk" (YAZ-2175, reliability R2).
 * A property tick or a posted comment is `transformFile`: read, rewrite the frontmatter, write with
 * `expectedMtime`. Landing 450–650 ms after the last body keystroke, it beats its own watcher echo
 * (chokidar's 200 ms settle) to the body's debounced autosave, whose `expectedMtime` is then stale:
 * CONFLICT. Before YAZ-2175 that showed the bar 7 of 12 times, and its "Reload" discarded the typing.
 * Now a CONFLICT whose disk BODY is still ours adopts the new frontmatter and retries once.
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
import { appWindow, buildFixtureVault, copyVault, launchApp, LAST_BULLET, quitApp, SEED_FILE, seededState } from './helpers'

let app: ElectronApplication | null = null
const dirs: string[] = []

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = null
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** Types a marker into the note body and returns it, with the file path; the autosave is left pending. */
async function typeIntoNote(): Promise<{ win: Page; file: string; marker: string }> {
  const src = await buildFixtureVault()
  const vault = await copyVault(src)
  const userData = await mkdtemp(path.join(tmpdir(), 'fmrace-'))
  dirs.push(src, vault, userData)
  const file = path.join(vault, SEED_FILE)
  app = await launchApp({ userData, seedState: seededState(vault, file) })
  const win = await appWindow(app, 'w1')
  await win.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await win.keyboard.press('End')
  const marker = `BODY${Date.now()}`
  await win.keyboard.type(` ${marker}`, { delay: 5 })
  return { win, file, marker }
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

for (const delayMs of [450, 550, 650]) {
  test(`a frontmatter write ${delayMs} ms after the last keystroke: no bar, and both edits on disk`, async () => {
    const { win, file, marker } = await typeIntoNote()
    await win.waitForTimeout(delayMs)
    await writeFromPage(win, file, 'frontmatter')
    await expect.poll(async () => readFile(file, 'utf8'), { timeout: 10_000 }).toContain(marker)
    await win.waitForTimeout(1000) // past the watcher's settle: nothing late may raise the bar either
    await expect(win.locator('.conflict-bar')).toHaveCount(0)
    const disk = await readFile(file, 'utf8')
    expect(disk.startsWith('---\nstatus: draft\n---\n'), disk.slice(0, 200)).toBe(true)
    await quitApp(app!)
    app = null
    expect(await readFile(file, 'utf8')).toContain(marker)
  })

  test(`a BODY write ${delayMs} ms after the last keystroke still raises the bar`, async () => {
    const { win, file, marker } = await typeIntoNote()
    await win.waitForTimeout(delayMs)
    await writeFromPage(win, file, 'body')
    await expect(win.locator('.conflict-bar')).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('.conflict-bar')).toContainText('File changed on disk.')
    expect(await readFile(file, 'utf8')).not.toContain(marker) // nothing was overwritten behind the user's back
  })
}
