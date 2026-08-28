/**
 * Frozen Table axes (YAZ-742, YAZ-1151): the Properties menu persists one positional prefix count
 * on the folder page, the semantic table sticks that prefix across header/body/footer, and its
 * existing header stays pinned while the outer note scrolls vertically.
 *
 * This is deliberately separate from folderPageColumns.spec.ts (YAZ-999 owns that shared column
 * propagation arc). It runs on a copy of the committed bible vault and a narrow app window so the
 * four-column KPI table genuinely overflows horizontally.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, launchApp, quitApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'KPIs.md'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (page: Page) => page.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorHost = () => layer(win).locator('.editor-host')
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
  groupBy?: { property: string; direction?: 'ASC' | 'DESC' }
}

async function tableSettings(): Promise<OnDiskView> {
  const { frontmatter } = splitFrontmatter(await readFile(folderPagePath(), 'utf8'))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  return settings.views?.find((view) => view.type === 'table') ?? {}
}

async function updateTableSettings(update: (view: OnDiskView) => void): Promise<void> {
  const content = await readFile(folderPagePath(), 'utf8')
  const { frontmatter } = splitFrontmatter(content)
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  const view = settings.views?.find((candidate) => candidate.type === 'table')
  if (view === undefined) throw new Error('fixture has no Table view')
  update(view)
  await writeFile(folderPagePath(), setFrontmatterProperty(content, 'folder_page_settings', settings), 'utf8')
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
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      writeFile(
        path.join(vault, 'kpis', `Generated KPI ${String(index + 1).padStart(2, '0')}.md`),
        `---\nfolder_pages:\n  - "[[KPIs]]"\nkpi_category: Generated\nunit: count\n---\n`,
        'utf8',
      ),
    ),
  )
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the header and selected prefix hold while the two scroll axes move', async () => {
  const state = seededState(vault, folderPagePath())
  state.windows[0].bounds.width = 760
  state.windows[0].bounds.height = 520
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  await contents(win).locator('.view-tab__btn[role="tab"]', { hasText: 'Table' }).click()
  await expect(headers()).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages'])

  // The vertical freeze is unconditional — before and after any column choice.
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

  const editingCell = firstBodyRow().nth(1)
  await editingCell.dblclick()
  await expect(editingCell.locator('[data-editing]')).toHaveCount(1)
  await editorHost().evaluate((node) => {
    const activeTable = node.querySelector('.view-table')
    if (activeTable === null) throw new Error('table missing from editor host')
    const hostTop = node.getBoundingClientRect().top + node.clientTop
    node.scrollTop += activeTable.getBoundingClientRect().top - hostTop + 20
  })
  await expect
    .poll(() =>
      headers()
        .nth(1)
        .evaluate((cell) => {
          const box = cell.getBoundingClientRect()
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          return hit === cell || (hit !== null && cell.contains(hit))
        }),
    )
    .toBe(true)
  await win.keyboard.press('Escape')

  await editorHost().evaluate((node) => {
    node.scrollTop = 320
  })
  await expect.poll(() => editorHost().evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const [hostBox, headerBox] = await Promise.all([editorHost().boundingBox(), headers().first().boundingBox()])
      if (hostBox === null || headerBox === null) return Number.POSITIVE_INFINITY
      return Math.abs(headerBox.y - hostBox.y)
    })
    .toBeLessThan(2)
  expect(
    await headers()
      .first()
      .evaluate((cell) => {
        const box = cell.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return hit === cell || (hit !== null && cell.contains(hit))
      }),
  ).toBe(true)

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
  // `has:` is queried STARTING FROM the outer match, so the inner locator has to be a bare one —
  // a chain rooted at `menu` would be re-rooted at the row and match nothing inside it.
  const unit = menu.locator('.view-prop').filter({ has: win.locator('[aria-label="Show unit"]') })
  await unit.locator('[aria-label="Move up"]').click()
  // GATED ON DISK between menu actions (the outline spec's own no-sleep rule): each of these is a
  // debounced settings write, and the next action must not race it — a write serialized from a
  // stale snapshot resurrects the change before it (YAZ-1166, observed under full-suite load).
  await expect.poll(async () => (await tableSettings()).order, { timeout: 10_000 }).toEqual(['file.name', 'note.unit', 'note.kpi_category', 'note.funnel_stages'])
  await expect(headers()).toHaveText(['file.name', 'unit', 'kpi_category', 'funnel_stages'])
  await expect(headers().nth(1)).toHaveClass(/view-table__frozen/)

  await unit.locator('[aria-label="Show unit"]').uncheck()
  await expect.poll(async () => (await tableSettings()).order, { timeout: 10_000 }).toEqual(['file.name', 'note.kpi_category', 'note.funnel_stages'])
  await expect(headers()).toHaveText(['file.name', 'kpi_category', 'funnel_stages'])
  await expect(headers().nth(1)).toHaveClass(/view-table__frozen/)

  await menu.locator('[aria-label="Frozen columns"]').selectOption('3')
  await expect.poll(async () => (await tableSettings()).frozenColumns, { timeout: 10_000 }).toBe(3)
  const funnel = menu.locator('.view-prop').filter({ has: win.locator('[aria-label="Show funnel_stages"]') })
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

test('step 4 — a grouped label stays left even when no data columns are frozen', async () => {
  await updateTableSettings((view) => {
    view.order = ['file.name', 'note.kpi_category', 'note.unit', 'note.funnel_stages']
    view.groupBy = { property: 'note.kpi_category', direction: 'ASC' }
    delete view.frozenColumns
  })

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()
  await contents(win).locator('.view-tab__btn[role="tab"]', { hasText: 'Table' }).click()

  await expect(table().locator('.view-table__frozen')).toHaveCount(0)
  const groupCell = table().locator('.view-table__group-cell').first()
  const group = groupCell.locator(':scope > .view-group')
  await expect(group).toBeVisible()
  await expect(groupCell).toHaveCSS('overflow', 'visible')
  expect(await group.evaluate((node) => ({ position: getComputedStyle(node).position, left: getComputedStyle(node).left }))).toEqual({
    position: 'sticky',
    left: '8px',
  })

  const before = await group.boundingBox()
  if (before === null) throw new Error('group label has no bounding box')
  await wrap().evaluate((node) => {
    node.scrollLeft = 120
  })
  expect(await wrap().evaluate((node) => node.scrollLeft)).toBeGreaterThan(100)
  const after = await group.boundingBox()
  if (after === null) throw new Error('scrolled group label has no bounding box')
  expect(Math.abs(after.x - before.x)).toBeLessThan(1)

  await quitApp(app)
})
