/**
 * QUIT AND CLOSE NEVER LOSE AN EDIT (YAZ-2174, reliability R1). A keystroke typed a moment before ⌘Q
 * or ⌘W must be on disk once the app is gone. Main holds each window for its renderer's flush
 * handshake (GRO-2160, 5 s cap) and then DESTROYS it, which runs no React unmount — so a writer that
 * only saves on unmount loses its last edit. The note editor always joined the handshake; the folder
 * page's OUTLINE (its own 500 ms debounce on top of Crepe's 200 ms listener) joins it since YAZ-2174,
 * and before that lost the edit 5 of 5 times.
 *
 * No wait between the last keystroke and the quit/close: that is the case under test. The acceptance
 * bar is 5 of 5 per case, so run it with `--repeat-each=5`.
 *
 * Same harness as the rest of the suite: a temp `--user-data-dir`, a COPY of the fixture.
 */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  caretAtEndOfLine,
  closeWindow,
  copyVault,
  launchApp,
  LAST_BULLET,
  outlineEditor,
  outlineLines,
  quitApp,
  SEED_FILE,
  seededState,
} from './helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

let app: ElectronApplication | null = null
const dirs: string[] = []

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = null
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const tempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** Resolves once the process is gone: closing the last window quits the app (`window-all-closed`). */
const exited = (a: ElectronApplication): Promise<void> => new Promise((resolve) => a.on('close', () => resolve()))

test('note editor: an edit typed right before ⌘Q is on disk', async () => {
  const src = await buildFixtureVault()
  dirs.push(src)
  const vault = await copyVault(src)
  dirs.push(vault)
  const file = path.join(vault, SEED_FILE)
  app = await launchApp({ userData: await tempDir('quitflush-note-'), seedState: seededState(vault, file) })
  const win = await appWindow(app, 'w1')
  await win.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await win.keyboard.press('End')
  const marker = `NOTEPROBE${Date.now()}`
  await win.keyboard.type(` ${marker}`, { delay: 5 })
  await expect(win.locator('.ProseMirror')).toContainText(marker)
  await quitApp(app)
  app = null
  expect(await readFile(file, 'utf8')).toContain(marker)
})

for (const how of ['⌘Q', '⌘W'] as const) {
  test(`folder-page outline: an edit typed right before ${how} is on disk`, async () => {
    const vault = await copyVault(FIXTURE)
    dirs.push(vault)
    const file = path.join(vault, 'Home.md')
    app = await launchApp({ userData: await tempDir('quitflush-outline-'), seedState: seededState(vault, file) })
    const win = await appWindow(app, 'w1')
    const scope = win.locator('.tabstack__layer:not(.tabstack__layer--hidden) .folder-page-contents')
    await expect(outlineEditor(scope)).toBeVisible({ timeout: 20_000 })
    // Adoption's own first settings write (the five topics appended) lands before the probe.
    await expect.poll(async () => (await readFile(file, 'utf8')).includes('[[Roles]]'), { timeout: 20_000 }).toBe(true)
    await expect(outlineLines(scope)).toHaveCount(8, { timeout: 20_000 })
    await caretAtEndOfLine(win, scope, 0)
    const marker = `OUTLINEPROBE${Date.now()}`
    await win.keyboard.type(` ${marker}`, { delay: 5 })
    await expect(outlineEditor(scope)).toContainText(marker)
    if (how === '⌘Q') {
      await quitApp(app)
    } else {
      const gone = exited(app)
      await closeWindow(app, 'w1')
      await gone
    }
    app = null
    const onDisk = await readFile(file, 'utf8')
    expect(onDisk.includes(marker), `Home.md after ${how}:\n${onDisk.slice(0, 600)}`).toBe(true)
  })
}
