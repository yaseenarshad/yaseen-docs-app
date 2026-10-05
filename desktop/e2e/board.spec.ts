/**
 * THE BOARD TAB (YAZ-935/YAZ-945): proven against the REAL app over the committed encyclopedia.
 * The Board view is DECLARED in the folder's settings (`KPIs/.folder.md`; the YAZ-935 read-time
 * injection was retired by YAZ-1471 D3), so the tab this spec looks for is one the file itself
 * lists: opening the folder shows it beside the outline and the table, with nothing set up
 * first. Same harness as its siblings (temp `--user-data-dir`, COPY of the fixture, `board-` step
 * screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, contents, copyVault, launchApp, openFolder, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

let app: ElectronApplication
let win: Page
let vault: string

test.beforeAll(async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'board-userdata-'))
  vault = await copyVault(FIXTURE)
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, path.join(vault, 'KPIs'))
})

test.afterAll(async () => {
  await quitApp(app)
})

test('step 1 — the Board tab is just THERE, declared in the folder’s settings alongside the outline and the table', async () => {
  await expect(contents(win).locator('.view-tab__btn')).toHaveText(['Outline', 'Table', 'Board'])
  await shoot(win, 'board-01-injected-tab')
})
