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
 * The third case quits during a WATCHER STORM (YAZ-2191, main-process F1): a git pull or a Finder
 * copy lands hundreds of files at once, and every one used to cost a full vault walk in main, the
 * process that serves the save, so the last edit could wait behind them past the 5 s quit cap. With
 * one walk per root at a time and the renderers' 100 ms quiet window, the edit lands. It asserts the
 * edit is on disk, not a timing budget.
 *
 * Same harness as the rest of the suite: a temp `--user-data-dir`, a COPY of the fixture.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  caretAtEndOfLine,
  closeWindow,
  contents,
  copyVault,
  editorOf,
  launchApp,
  outlineEditor,
  outlineLines,
  quitApp,
  SEED_FILE,
  seededState,
  typeMarkerAtLastBullet,
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

/** A copy of the generated fixture, open on its seed note; every temp dir is cleaned after the test. */
async function openSeedNote(prefix: string): Promise<{ win: Page; vault: string; file: string }> {
  const src = await buildFixtureVault()
  const vault = await copyVault(src)
  dirs.push(src, vault)
  const file = path.join(vault, SEED_FILE)
  app = await launchApp({ userData: await tempDir(prefix), seedState: seededState(vault, file) })
  return { win: await appWindow(app, 'w1'), vault, file }
}

test('note editor: an edit typed right before ⌘Q is on disk', async () => {
  const { win, file } = await openSeedNote('quitflush-note-')
  const marker = await typeMarkerAtLastBullet(win, 'NOTEPROBE')
  await expect(editorOf(win)).toContainText(marker)
  await quitApp(app!)
  app = null
  expect(await readFile(file, 'utf8')).toContain(marker)
})

test('note editor: an edit typed right before ⌘Q, while 230 files land in the vault, is on disk', async () => {
  const { win, vault, file } = await openSeedNote('quitflush-storm-')
  const marker = await typeMarkerAtLastBullet(win, 'STORMPROBE')
  await expect(editorOf(win)).toContainText(marker)
  const pulled = path.join(vault, 'Pulled')
  await mkdir(pulled)
  await Promise.all(Array.from({ length: 230 }, (_, k) => writeFile(path.join(pulled, `pulled-${k}.md`), `# pulled ${k}\n`)))
  await quitApp(app!)
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
    const scope = contents(win)
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
