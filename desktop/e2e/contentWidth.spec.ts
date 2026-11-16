/**
 * YAZ-1176: the real Electron proof for one global content-width preference — exact preset
 * mapping, aligned page/folder surfaces, live switching, persistence, and narrow-window
 * fallback. The app runs against a copied vault and isolated `--user-data-dir` throughout.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTENT_TEXT_WIDTHS } from '../../shared/types'
import { appWindow, contents, copyVault, launchApp, layer, openFolder, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const PAGE = path.join('Funnel Stages', 'Lead Gen.md')
const FOLDER = 'KPIs'
/** A step's column at most (YAZ-5144): its text's widest and the column's two 48 px sides — Narrow 736, Medium 996. */
const NARROW = CONTENT_TEXT_WIDTHS.narrow! + 96
const MEDIUM = CONTENT_TEXT_WIDTHS.medium! + 96

async function pickContentWidth(win: Page, label: 'Narrow' | 'Medium' | 'Full'): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  // The dialog opens on General (YAZ-3276 D7); the row lives on Appearance, and `data-setting` addresses it.
  await win.locator('.settings-dialog .settings-nav__item', { hasText: /^Appearance$/ }).click()
  const row = win.locator('.settings-dialog [data-setting="contentWidth"]')
  await row.getByRole('button', { name: label, exact: true }).click()
  await win.keyboard.press('Escape')
}

async function computedMaxWidths(win: Page, selectors: readonly string[]): Promise<string[]> {
  return layer(win).locator('.editor-host').evaluate((host, requested) =>
    requested.map((selector) => getComputedStyle(host.querySelector(selector)!).maxWidth), selectors)
}

/** Full is the window (YAZ-5144: `100vw`, wider than any column): each surface's cap is none, or wider than its host. */
async function capsWiderThanHost(win: Page, selectors: readonly string[]): Promise<boolean> {
  return layer(win).locator('.editor-host').evaluate((host, requested) =>
    requested.every((selector) => {
      const max = getComputedStyle(host.querySelector(selector)!).maxWidth
      return max === 'none' || parseFloat(max) >= host.clientWidth
    }), selectors)
}

async function alignedWithinHost(win: Page, selectors: readonly string[], cap: number | null): Promise<boolean> {
  return layer(win).locator('.editor-host').evaluate((host, input) => {
    const rects = input.selectors.map((selector) => host.querySelector(selector)!.getBoundingClientRect())
    // The host's CLIENT width, not its border box: a tall folder view shows the host's vertical
    // scrollbar, and on a machine with classic (non-overlay) scrollbars that is 15 px the children
    // cannot have — their `width: 100%` is of the content box (YAZ-1634).
    const expectedWidth = input.cap === null ? host.clientWidth : Math.min(host.clientWidth, input.cap)
    return (
      rects.every((rect) => Math.abs(rect.width - expectedWidth) < 1 && Math.abs(rect.left - rects[0].left) < 1) &&
      host.scrollWidth === host.clientWidth
    )
  }, { selectors, cap })
}

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'content-width-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('Narrow → Medium → Full changes the real page surfaces live and persists Full', async () => {
  const state = seededState(vault, path.join(vault, PAGE))
  state.windows[0].bounds.width = 1800
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  const pageSurfaces = ['.page-header', '.editor-instance', '.backlinks'] as const
  await expect(layer(win).locator('.editor-instance')).toBeVisible()
  await expect.poll(() => computedMaxWidths(win, pageSurfaces)).toEqual([`${NARROW}px`, `${NARROW}px`, `${NARROW}px`])
  await expect.poll(() => alignedWithinHost(win, pageSurfaces, NARROW)).toBe(true)

  await pickContentWidth(win, 'Medium')
  await expect.poll(() => computedMaxWidths(win, pageSurfaces)).toEqual([`${MEDIUM}px`, `${MEDIUM}px`, `${MEDIUM}px`])
  await expect.poll(() => alignedWithinHost(win, pageSurfaces, MEDIUM)).toBe(true)

  await pickContentWidth(win, 'Full')
  await expect.poll(() => capsWiderThanHost(win, pageSurfaces)).toBe(true)
  await expect.poll(() => alignedWithinHost(win, pageSurfaces, null)).toBe(true)
  await expect.poll(async () => (await readState(userData)).settings.contentWidth).toBe('full')
  await shoot(win, 'content-width-01-full-page')
})

test('Full aligns the folder view and Board, survives relaunch, and stays fluid in a narrow window', async () => {
  await openFolder(win, path.join(vault, FOLDER))

  const boardTab = layer(win).getByRole('tab', { name: 'Board', exact: true })
  await expect(boardTab).toBeVisible()
  await boardTab.click()
  await expect(layer(win).locator('.view-board__hint')).toBeVisible()
  await layer(win).locator('[aria-label="Sort"]').click()
  // "Add group level" makes the first level (YAZ-3746 D60); its "Group by" picker then takes the column.
  await layer(win).getByRole('button', { name: '+ Add group level', exact: true }).click()
  await layer(win).locator('[aria-label="Group by"]').click()
  await layer(win).locator('[role="option"][data-value="note.kpi_category"]').click()
  await win.keyboard.press('Escape')
  await expect(layer(win).locator('.view-board')).toBeVisible()
  // A folder's tab stacks the header row, the views and its comments (FolderView.tsx): there is no
  // page body, and "Linked mentions" renders nothing for a folder no page links to.
  const folderSurfaces = ['.page-header', '.folder-view', '.comments'] as const
  await expect(layer(win).locator('.comments')).toBeVisible()
  await expect.poll(() => capsWiderThanHost(win, folderSurfaces)).toBe(true)
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)
  await shoot(win, 'content-width-02-full-folder-view')

  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible() // the folder's tab is restored like any other
  await expect(layer(win).locator('.comments')).toBeVisible() // mounted once the settings file's bytes are read
  await expect(win.locator('.app')).toHaveAttribute('data-content-width', 'full')
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(780, 700)
  })
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)
  await shoot(win, 'content-width-03-full-narrow-window')
  await quitApp(app)
})
