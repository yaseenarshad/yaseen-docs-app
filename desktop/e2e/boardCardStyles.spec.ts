/**
 * BOARD CARD STYLES, END TO END (YAZ-1206/YAZ-1217): the per-property `cardStyle` flags proven
 * against the REAL app over the committed encyclopedia. The Properties menu's toggles write ONE
 * `cardStyle` entry per click into the KPIs folder's settings file on disk; the board's cards
 * restyle live — bold, hidden label, and the JOIN model gluing a value onto the row above with a
 * dash. Same harness as its siblings (temp `--user-data-dir`, COPY of the fixture, step
 * screenshots); serial by design — each step continues the previous state.
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, contents, copyVault, launchApp, openFolder, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

let app: ElectronApplication
let win: Page
let vault: string

const firstCard = (): Locator => contents(win).locator('.view-board__card').first()
/** The folder's settings file: where every `cardStyle` write lands (YAZ-2290 D1). */
const kpis = (): Promise<string> => readFile(path.join(vault, 'KPIs', '.folder.md'), 'utf8')

test.beforeAll(async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'cardstyle-userdata-'))
  vault = await copyVault(FIXTURE)
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, path.join(vault, 'KPIs'))
})

test.afterAll(async () => {
  await quitApp(app)
})

test('step 1 — a grouped board shows plain cards; note rows carry B/U/–L/join, file.name only join', async () => {
  await contents(win).locator('.view-tab__btn', { hasText: 'Board' }).click()
  await contents(win).locator('[aria-label="Sort"]').click()
  await contents(win).locator('[aria-label="Group by"]').click()
  await contents(win).locator('[role="option"][data-value="note.kpi_category"]').click()
  await win.keyboard.press('Escape')
  await expect(contents(win).locator('.view-board__col')).toHaveCount(2)
  // The Properties menu is TWO levels since YAZ-1513: the list names each column, "Open <Label>"
  // shows that ONE column's detail with its card-style toggles; labels are sentence-case
  // (`Unit`, `Name`) since YAZ-1549. Steps 2–5 act on Unit, so its detail is left open.
  await contents(win).locator('[aria-label="Properties"]').click()
  await contents(win).locator('[aria-label="Open Unit"]').click()
  await expect(contents(win).locator('[aria-label="Bold Unit on cards"]')).toBeVisible()
  await expect(contents(win).locator('[aria-label="Join Unit to the row above"]')).toBeVisible()
  await contents(win).locator('[aria-label="Back to columns"]').click()
  await contents(win).locator('[aria-label="Open Name"]').click()
  await expect(contents(win).locator('[aria-label="Join Name to the row above"]')).toBeVisible()
  await expect(contents(win).locator('[aria-label="Bold Name on cards"]')).toHaveCount(0)
  await expect(contents(win).locator('[aria-label$=" of the title"]')).toHaveCount(0)
  await contents(win).locator('[aria-label="Back to columns"]').click()
  await contents(win).locator('[aria-label="Open Unit"]').click()
  await shoot(win, 'cardstyle-01-toggles')
})

test('step 2 — Bold writes one cardStyle entry to disk and the rows go bold', async () => {
  await contents(win).locator('[aria-label="Bold Unit on cards"]').click()
  await expect(firstCard().locator('.view-board__prop--bold')).toBeVisible()
  await expect(contents(win).locator('.views-pane__error')).toHaveCount(0)
  // Block-style YAML: the entry is `note.unit:` with `bold: true` nested on the NEXT line.
  await expect.poll(async () => /cardStyle:\s*\n\s*note\.unit:\s*\n\s*bold: true/.test(await kpis())).toBe(true)
  await shoot(win, 'cardstyle-02-bold')
})

test('step 3 — Hide label drops the muted label; the value stays', async () => {
  await contents(win).locator('[aria-label="Hide Unit label on cards"]').click()
  await expect(firstCard().locator('.view-board__prop--bold .view-board__prop-name')).toHaveCount(0)
  await expect.poll(async () => /hideLabel: true/.test(await kpis())).toBe(true)
  await shoot(win, 'cardstyle-03-hidelabel')
})

test('step 4 — join glues the value onto the row above, dash-separated, durable on disk', async () => {
  await contents(win).locator('[aria-label="Join Unit to the row above"]').click()
  const line = firstCard().locator('.view-board__line', { has: win.locator('.view-board__dash') })
  await expect(line.locator('.view-board__dash')).toBeVisible()
  await expect.poll(async () => /join: true/.test(await kpis())).toBe(true)
  await shoot(win, 'cardstyle-04-join')
})

test('step 5 — untoggling everything cleans cardStyle out of the YAML completely', async () => {
  // One durable write per click, awaited like a human clicks: each toggle-off is a separate
  // whole-settings write, and firing all three concurrently can land them out of order.
  await contents(win).locator('[aria-label="Join Unit to the row above"]').click()
  await expect.poll(async () => /join: true/.test(await kpis())).toBe(false)
  await contents(win).locator('[aria-label="Hide Unit label on cards"]').click()
  await expect.poll(async () => /hideLabel: true/.test(await kpis())).toBe(false)
  await contents(win).locator('[aria-label="Bold Unit on cards"]').click()
  await expect.poll(async () => (await kpis()).includes('cardStyle')).toBe(false)
  await expect(firstCard().locator('.view-board__prop--bold')).toHaveCount(0)
  await shoot(win, 'cardstyle-05-cleaned')
  await win.keyboard.press('Escape')
})
