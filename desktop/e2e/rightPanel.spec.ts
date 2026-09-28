/**
 * The right panel (YAZ-966) in the REAL app: a main tab moved into it through the tab's own menu,
 * its handle resized, hidden and shown again — and all of it WINDOW identity
 * (`WindowEntry.rightPanel = { open, width, items, expanded }`), written through main and restored
 * by a relaunch.
 *
 * The unit suites prove ownership, drag and lifecycle over a fake bridge (CONTRACTS "Right panel");
 * this proves the one thing they cannot: the panel's state survives the real quit path and comes
 * back with the page mounted and its text on screen.
 *
 * The window is seeded 1500px wide so the panel docks beside the note instead of overlaying it
 * (App.tsx `rightOverlay`: sidebar + panel + 360px of main must fit).
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let alpha: string
let beta: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const panel = (w: Page) => w.locator('aside.right-panel[aria-label="Right panel"]')
const handle = (w: Page) => panel(w).locator('.right-panel__resize[role="separator"]')
const header = (w: Page, label: string) => panel(w).locator('.right-panel__header', { hasText: label })
const rightPanelState = async () => (await readState(userData)).windows[0]?.rightPanel

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'rightpanel-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'rightpanel-vault-'))
  alpha = path.join(vault, 'Alpha.md')
  beta = path.join(vault, 'Beta.md')
  await writeFile(alpha, '# Alpha\n\nalpha-main-body\n')
  await writeFile(beta, '# Beta\n\nbeta-panel-body\n')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a tab\'s "Move to right panel" opens the panel with that page expanded; the main tabs lose it', async () => {
  const state = seededState(vault, alpha)
  state.windows[0].tabs = [alpha, beta]
  state.windows[0].bounds = { x: 40, y: 40, width: 1500, height: 800 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText(['Alpha', 'Beta'])
  await expect(panel(win)).toHaveCount(0)

  await tabsOf(win).filter({ hasText: 'Beta' }).click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Move to right panel' }).click()

  await expect(panel(win)).toBeVisible()
  await expect(header(win, 'Beta')).toHaveAttribute('aria-expanded', 'true')
  await expect(panel(win).locator('.ProseMirror')).toContainText('beta-panel-body')
  await expect(tabsOf(win)).toHaveText(['Alpha'])
  await expect.poll(rightPanelState).toMatchObject({ open: true, items: [beta], expanded: beta })
  await shoot(win, 'rightpanel-01-moved')
})

test('step 2 — dragging the handle LEFT widens the panel, and the width lands in the window\'s state', async () => {
  const before = Number(await handle(win).getAttribute('aria-valuenow'))
  const box = await handle(win).boundingBox()
  if (box === null) throw new Error('the resize handle has no box')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 })
  await win.mouse.up()

  await expect(handle(win)).toHaveAttribute('aria-valuenow', String(before + 100))
  await expect.poll(async () => (await rightPanelState())?.width).toBe(before + 100)
})

test('step 3 — Hide closes the panel and leaves a Show button; Show brings the same page back', async () => {
  await panel(win).locator('button[aria-label="Hide right panel"]').click()
  await expect(panel(win)).toHaveCount(0)
  await expect.poll(async () => (await rightPanelState())?.open).toBe(false)
  await shoot(win, 'rightpanel-02-hidden')

  await win.locator('button.right-panel-reopen[aria-label="Show right panel"]').click()
  await expect(panel(win)).toBeVisible()
  await expect(panel(win).locator('.ProseMirror')).toContainText('beta-panel-body')
  await expect.poll(async () => (await rightPanelState())?.open).toBe(true)
})

test('step 4 — quit → relaunch: the panel comes back open, at its width, with the page mounted', async () => {
  const width = (await rightPanelState())?.width
  await quitApp(app)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(panel(win)).toBeVisible()
  await expect(handle(win)).toHaveAttribute('aria-valuenow', String(width))
  await expect(header(win, 'Beta')).toHaveAttribute('aria-expanded', 'true')
  await expect(panel(win).locator('.ProseMirror')).toContainText('beta-panel-body')
  await expect(tabsOf(win)).toHaveText(['Alpha'])
  await shoot(win, 'rightpanel-03-restored')
  await quitApp(app)
})
