/**
 * Frozen Table columns (YAZ-742): the Properties menu persists one positional prefix count on the
 * folder page, and the existing semantic table sticks that prefix across header, body and footer.
 *
 * This is deliberately separate from folderPageColumns.spec.ts (YAZ-999 owns that shared column
 * propagation arc). It runs on a copy of the committed bible vault and a narrow app window so the
 * four-column KPI table genuinely overflows horizontally.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, launchApp, quitApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'KPIs.md'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (page: Page) => page.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (page: Page) => layer(page).locator('.folder-page-contents')
const table = () => contents(win).locator('.view-table')
const wrap = () => contents(win).locator('.view-table-wrap')
const headers = () => table().locator('thead th')
const firstBodyRow = () => table().locator('tbody tr:not(.view-table__group):not(.view-table__spacer)').first().locator('td')
const footer = () => table().locator('tfoot td')
const propsMenu = () => contents(win).locator('.view-popover')
const folderPagePath = () => path.join(vault, FOLDER_PAGE)

interface OnDiskView {
  type?: string
  name?: string
  order?: string[]
  columnSize?: Record<string, number>
  frozenColumns?: number
}

async function tableSettings(): Promise<OnDiskView> {
  const { frontmatter } = splitFrontmatter(await readFile(folderPagePath(), 'utf8'))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  return settings.views?.find((view) => view.type === 'table') ?? {}
}

async function openProperties(): Promise<Locator> {
  await contents(win).locator('[aria-label="Properties"]').click()
  await expect(propsMenu()).toBeVisible()
  return propsMenu()
}

async function xPositions(cells: Locator): Promise<number[]> {
  return Promise.all(
    [0, 1, 2].map(async (index) => {
      const box = await cells.nth(index).boundingBox()
      if (box === null) throw new Error(`column ${index} has no bounding box`)
      return box.x
    }),
  )
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'freeze-columns-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — selecting two persists one prefix and holds it while the rest scrolls', async () => {
  const state = seededState(vault, folderPagePath())
  state.windows[0].bounds.width = 760
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  await contents(win).locator('.view-tab__btn[role="tab"]', { hasText: 'Table' }).click()
  await expect(headers()).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages'])

  // The header's existing vertical freeze is unconditional — before and after any column choice.
  expect(await headers().first().evaluate((cell) => ({ position: getComputedStyle(cell).position, top: getComputedStyle(cell).top }))).toEqual({ position: 'sticky', top: '0px' })

  const menu = await openProperties()
  await menu.locator('[aria-label="Frozen columns"]').selectOption('2')
  await expect.poll(async () => (await tableSettings()).frozenColumns, { timeout: 10_000 }).toBe(2)
  await win.keyboard.press('Escape')

  await expect(table().locator('thead th.view-table__frozen')).toHaveCount(2)
  await expect(table().locator('tbody tr:not(.view-table__group):not(.view-table__spacer)').first().locator('td.view-table__frozen')).toHaveCount(2)
  await expect(table().locator('tfoot td.view-table__frozen')).toHaveCount(2)
  expect(await Promise.all([headers(), firstBodyRow(), footer()].map((cells) => cells.nth(1).evaluate((cell) => ({ position: getComputedStyle(cell).position, left: getComputedStyle(cell).left }))))).toEqual([
    { position: 'sticky', left: '150px' },
    { position: 'sticky', left: '150px' },
    { position: 'sticky', left: '150px' },
  ])

  const before = await xPositions(headers())
  await wrap().evaluate((node) => {
    node.scrollLeft = 120
  })
  const after = await xPositions(headers())
  expect(Math.abs(after[0] - before[0])).toBeLessThan(1)
  expect(Math.abs(after[1] - before[1])).toBeLessThan(1)
  expect(after[2]).toBeLessThan(before[2] - 100)
})

test('step 2 — resize, reorder and hide update the positional prefix without another model', async () => {
  await wrap().evaluate((node) => {
    node.scrollLeft = 0
  })

  const handle = contents(win).locator('.view-table__resize').first()
  const box = await handle.boundingBox()
  if (box === null) throw new Error('first resize handle has no bounding box')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2)
  await win.mouse.up()

  await expect.poll(async () => (await tableSettings()).columnSize?.['file.name'], { timeout: 10_000 }).toBe(190)
  await expect(headers().nth(1)).toHaveCSS('left', '190px')
  await expect(firstBodyRow().nth(1)).toHaveCSS('left', '190px')
  await expect(footer().nth(1)).toHaveCSS('left', '190px')

  const menu = await openProperties()
  const unit = menu.locator('.view-prop').filter({ has: menu.locator('[aria-label="Show unit"]') })
  await unit.locator('[aria-label="Move up"]').click()
  await expect(headers()).toHaveText(['file.name', 'unit', 'kpi_category', 'funnel_stages'])
  await expect(headers().nth(1)).toHaveClass(/view-table__frozen/)

  await unit.locator('[aria-label="Show unit"]').uncheck()
  await expect(headers()).toHaveText(['file.name', 'kpi_category', 'funnel_stages'])
  await expect(headers().nth(1)).toHaveClass(/view-table__frozen/)

  await menu.locator('[aria-label="Frozen columns"]').selectOption('3')
  const funnel = menu.locator('.view-prop').filter({ has: menu.locator('[aria-label="Show funnel_stages"]') })
  await funnel.locator('[aria-label="Show funnel_stages"]').uncheck()
  await expect(headers()).toHaveText(['file.name', 'kpi_category'])
  await expect.poll(async () => (await tableSettings()).frozenColumns, { timeout: 10_000 }).toBe(2)
  expect((await tableSettings()).order).toEqual(['file.name', 'note.kpi_category'])
})

test('step 3 — the frozen prefix survives the real quit and relaunch path', async () => {
  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()
  await contents(win).locator('.view-tab__btn[role="tab"]', { hasText: 'Table' }).click()

  await expect(headers()).toHaveText(['file.name', 'kpi_category'])
  await expect(table().locator('thead th.view-table__frozen')).toHaveCount(2)
  const menu = await openProperties()
  await expect(menu.locator('[aria-label="Frozen columns"]')).toHaveValue('2')
  expect((await tableSettings()).frozenColumns).toBe(2)

  await quitApp(app)
})
