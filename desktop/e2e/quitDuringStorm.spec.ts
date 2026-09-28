/**
 * QUIT DURING A WATCHER STORM KEEPS THE EDIT (YAZ-2191, main-process F1). A git pull or a Finder
 * copy lands hundreds of files at once; every one used to cost a full vault walk in main, all at
 * once, and main is the process that serves the save — so the last edit could wait behind them past
 * the 5 s quit cap. With one walk per root at a time and the renderers' 100 ms quiet window, a quit
 * in the middle of such a burst lands the edit typed a moment before.
 *
 * Not a timing budget: it asserts the edit is on disk. Same harness as the rest of the suite.
 */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

test('an edit typed right before ⌘Q, while 230 files land in the vault, is on disk', async () => {
  const src = await buildFixtureVault()
  const vault = await copyVault(src)
  const userData = await mkdtemp(path.join(tmpdir(), 'quitstorm-'))
  dirs.push(src, vault, userData)
  const file = path.join(vault, SEED_FILE)
  app = await launchApp({ userData, seedState: seededState(vault, file) })
  const win = await appWindow(app, 'w1')
  await win.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await win.keyboard.press('End')
  const marker = `STORMPROBE${Date.now()}`
  await win.keyboard.type(` ${marker}`, { delay: 5 })
  await expect(win.locator('.ProseMirror')).toContainText(marker)
  const pulled = path.join(vault, 'Pulled')
  await mkdir(pulled)
  await Promise.all(Array.from({ length: 230 }, (_, k) => writeFile(path.join(pulled, `pulled-${k}.md`), `# pulled ${k}\n`)))
  await quitApp(app)
  app = null
  expect(await readFile(file, 'utf8')).toContain(marker)
})
