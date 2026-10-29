/**
 * DRAG TABS TO DIFFERENT WINDOWS (YAZ-3637): a tab of the strip drags out of its window. Let go on another window:
 * that window takes it, anywhere on it, at the end of its strip when the drop is off the strip (D4, widened in the
 * demo). Let go off every window: a window opens there with the tab (D3); the only tab of a window takes the window
 * there instead (D5). A window that does not show the page's vault asks to add that vault first (D6).
 *
 * A real OS drag would take the user's pointer, so none runs here: the spec fires the drag's DOM events in the pages.
 * The source's `dragstart` is real, so the drop carries the data its strip writes (`writePageDrag`, D1). The drop
 * builds a `DataTransfer` from that data in the target page. The source's `dragend` gets a stand-in `dataTransfer`
 * (Chromium keeps `dropEffect` of a script-made `DataTransfer` at 'none') and a screen point the test picks off
 * every window, as the Mac would hand it.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, temp vaults, hidden windows
 * (`YASEEN_DOCS_E2E_HIDDEN`, helpers.ts), `dragtabs-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type ElementHandle, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WindowBounds } from '../../shared/types'
import { activeTab, appWindow, confirmSheet, editorOf, extraWindow, launchApp, multiWindowState, readState, shoot, tabsOf, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

/** Small windows, so the screen keeps room off every window for a drop (D3). Main clamps them to the screen. */
const SIZE = { width: 480, height: 360 }

let userData: string
let vault: string
let other: string
let app: ElectronApplication
let w1: Page
let w2: Page
let w3: Page
let popped: Page

/** The strip tab named `name`: the element that drags (`.tabbar__tab`, draggable). */
const stripTab = (w: Page, name: string) => w.locator('.tabbar__tab').filter({ has: w.locator('[role="tab"]').filter({ hasText: new RegExp(`^${name}$`) }) })

/** A real `dragstart` on the tab (D1): its strip writes the drag. Answers each type of the drag with its data. */
async function startDrag(tab: Locator): Promise<Record<string, string>> {
  return tab.evaluate((el) => {
    const data = new DataTransfer()
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }))
    return Object.fromEntries([...data.types].map((t) => [t, data.getData(t)]))
  })
}

/**
 * The source's `dragend` (D1): `none` = no surface took the drop, at `point` on the screen; `move` = a window took it.
 * On a handle, so it still reaches a tab that a move is about to take away.
 */
async function endDrag(tab: ElementHandle, dropEffect: 'none' | 'move', point: { x: number; y: number }): Promise<void> {
  await tab.evaluate((el, { dropEffect, point }) => {
    const event = new DragEvent('dragend', { bubbles: true, screenX: point.x, screenY: point.y })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect, types: [], getData: () => '', setData: () => undefined } })
    el.dispatchEvent(event)
  }, { dropEffect, point })
}

/**
 * Another window's drag over `target`, then its drop (D4): the data as the source wrote it. Chromium repeats `dragover`
 * about every 50 ms while the pointer is over a window; so does this, until the window glows (its ring goes out
 * 200 ms after the last one). Answers whether the window took the `dragover` and whether it glowed.
 */
async function dropOn(target: Locator, data: Record<string, string>): Promise<{ taken: boolean; glowed: boolean }> {
  return target.evaluate(async (el, data) => {
    const transfer = new DataTransfer()
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value)
    const fire = (type: string) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer })
      el.dispatchEvent(event)
      return event.defaultPrevented
    }
    fire('dragenter')
    let taken = false
    let glowed = false
    for (let i = 0; i < 40 && !glowed; i++) {
      taken = fire('dragover')
      await new Promise((resolve) => setTimeout(resolve, 50))
      glowed = document.querySelector('.window-glow') !== null
    }
    fire('drop')
    return { taken, glowed }
  }, data)
}

/** Main's bounds of the window that shows `?win=<id>`. */
const mainBounds = (id: string): Promise<WindowBounds | undefined> =>
  app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(`win=${id}`))?.getBounds(), id)
const inside = (p: { x: number; y: number }, b: WindowBounds) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height

/** `TEAR_OFF_GRAB` (desktop/src/main/windows.ts, D3): where the first tab sits in a torn-off window, from its top left. */
const GRAB = { x: 190, y: 50 }
/** Where a window of `size` lands for a tab let go at `spot` (D3): the tab under the pointer. */
const landing = (spot: { x: number; y: number }, size: WindowBounds): WindowBounds => ({ x: spot.x - GRAB.x, y: spot.y - GRAB.y, width: size.width, height: size.height })

/**
 * A point on the primary screen that no window covers, 30 px clear of each: where a tab is let go "off every window"
 * (D3). The window it gets (`landing`) fits on that screen, so main does not clamp it: near the edge of two displays
 * main moves it to the other display (Finding on YAZ-3660), and the test would not know where to look.
 */
async function emptySpot(size: WindowBounds): Promise<{ x: number; y: number }> {
  const { area, wins } = await app.evaluate(({ BrowserWindow, screen }) => ({ area: screen.getPrimaryDisplay().workArea, wins: BrowserWindow.getAllWindows().map((b) => b.getBounds()) }))
  const pad = (b: WindowBounds) => ({ x: b.x - 30, y: b.y - 30, width: b.width + 60, height: b.height + 60 })
  const fits = (b: WindowBounds) => b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height
  for (let y = area.y + area.height - 40; y > area.y + 40; y -= 40) {
    for (let x = area.x + area.width - 40; x > area.x + 40; x -= 40) {
      if (fits(landing({ x, y }, size)) && !wins.some((b) => inside({ x, y }, pad(b)))) return { x, y }
    }
  }
  throw new Error(`no spot of ${JSON.stringify(area)} is off every window ${JSON.stringify(wins)}`)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3637-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz3637-vault-'))
  other = await mkdtemp(path.join(tmpdir(), 'yaz3637-other-'))
  await Promise.all([
    writeFile(path.join(vault, 'Stays.md'), '# Stays\n\ndragtabs-stays-body\n'),
    writeFile(path.join(vault, 'Travels.md'), '# Travels\n\ndragtabs-travels-body\n'),
    writeFile(path.join(vault, 'Leaves.md'), '# Leaves\n\ndragtabs-leaves-body\n'),
    writeFile(path.join(vault, 'Target.md'), '# Target\n\ndragtabs-target-body\n'),
    writeFile(path.join(other, 'Far.md'), '# Far\n\ndragtabs-far-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault, other].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('a tab dropped on another window\'s page: that window glows, takes it as its last tab and shows it; the first window loses it', async () => {
  const stays = path.join(vault, 'Stays.md')
  const travels = path.join(vault, 'Travels.md')
  const leaves = path.join(vault, 'Leaves.md')
  const target = path.join(vault, 'Target.md')
  // w1 and w2 show `vault`; w3 shows only `other` (D6). Side by side, the bottom right of the screen left free.
  const state = multiWindowState([
    { id: 'w1', root: vault, file: stays, bounds: { x: 0, y: 0, ...SIZE } },
    { id: 'w2', root: vault, file: target, bounds: { x: SIZE.width + 20, y: 0, ...SIZE } },
    { id: 'w3', root: other, file: path.join(other, 'Far.md'), bounds: { x: 0, y: SIZE.height + 20, ...SIZE } },
  ], [vault, other])
  state.windows[0].tabs = [stays, travels, leaves]
  app = await launchApp({ userData, seedState: state })
  ;[w1, w2, w3] = await Promise.all(['w1', 'w2', 'w3'].map((id) => appWindow(app, id)))
  await expect(tabsOf(w1)).toHaveText(['Stays', 'Travels', 'Leaves'])
  await expect(tabsOf(w2)).toHaveText(['Target'])
  await expect(editorOf(w2)).toContainText('dragtabs-target-body')

  const tab = stripTab(w1, 'Travels')
  const data = await startDrag(tab)
  // D1: the payload, and a second type that names the window and the vault, the only part another window reads mid-drag.
  expect(JSON.parse(data['application/x-yaseen-workspace-page'])).toEqual({ path: travels, owner: 'main', from: 'w1', copy: 0 })
  expect(Object.keys(data)).toContain('application/x-yaseen-from-w1.0')
  const handle = await tab.elementHandle()
  // D4 (widened): the editor of w2, not its strip. The window catches the drag before the editor sees it.
  expect(await dropOn(editorOf(w2), data)).toEqual({ taken: true, glowed: true })
  await endDrag(handle!, 'move', { x: 1, y: 1 })

  // D4: the end of w2's strip, active, its page on show. w1 lost it; nothing new opened.
  await expect(tabsOf(w2)).toHaveText(['Target', 'Travels'])
  await expect(activeTab(w2)).toHaveText('Travels')
  await expect(editorOf(w2)).toContainText('dragtabs-travels-body')
  await expect(tabsOf(w1)).toHaveText(['Stays', 'Leaves'])
  expect(await windowCount(app)).toBe(3)
  await shoot(w2, 'dragtabs-1-taken')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w2')?.tabs).toEqual([target, travels])
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w1')?.tabs).toEqual([stays, leaves])
})

test('a tab let go off every window: a window opens there with the tab, as big as the first, sidebar hidden; the first window loses it', async () => {
  const leaves = path.join(vault, 'Leaves.md')
  const size = (await mainBounds('w1'))!
  const spot = await emptySpot(size)
  const tab = stripTab(w1, 'Leaves')
  await startDrag(tab)
  // D1, D3: no surface took the drop, so main reads the point. It is on no window: a window opens there.
  await endDrag((await tab.elementHandle())!, 'none', spot)

  popped = await extraWindow(app, ['w1', 'w2', 'w3'])
  await expect(tabsOf(popped)).toHaveText(['Leaves'])
  await expect(editorOf(popped)).toContainText('dragtabs-leaves-body')
  await expect(popped.getByRole('button', { name: 'Show sidebar' })).toBeVisible() // only a hidden sidebar offers it
  await expect(tabsOf(w1)).toHaveText(['Stays'])
  expect(await windowCount(app)).toBe(4)
  // D3: as big as the first window, the tab under the pointer.
  expect(await mainBounds(winParam(popped)!)).toEqual(landing(spot, size))
  await shoot(popped, 'dragtabs-2-opened')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === winParam(popped))).toMatchObject({ tabs: [leaves], sidebarCollapsed: true })
})

test('the only tab of a window let go off every window: that window moves there, and no window opens', async () => {
  const before = (await mainBounds(winParam(popped)!))!
  const spot = await emptySpot(before)
  const tab = stripTab(popped, 'Leaves')
  await startDrag(tab)
  // D5: one tab, no blank tab, an empty right panel — the window itself goes, no reload.
  await endDrag((await tab.elementHandle())!, 'none', spot)

  await expect.poll(() => mainBounds(winParam(popped)!)).toEqual(landing(spot, before))
  expect(await windowCount(app)).toBe(4)
  await expect(tabsOf(popped)).toHaveText(['Leaves'])
  // Main stored the move at once, as its bounds debounce would.
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === winParam(popped))?.bounds).toEqual(landing(spot, before))
})

test('a tab of a vault the window does not show: the window asks to add that vault; Add adds it and the tab moves there', async () => {
  const far = path.join(other, 'Far.md')
  const tab = stripTab(w3, 'Far')
  const data = await startDrag(tab)
  expect(Object.keys(data)).toContain('application/x-yaseen-from-w3.0')
  const handle = await tab.elementHandle()
  // D6 (revised in the demo): w2 shows only `vault`, yet it glows and takes the drop — then asks first.
  expect(await dropOn(editorOf(w2), data)).toEqual({ taken: true, glowed: true })
  await endDrag(handle!, 'move', { x: 1, y: 1 })

  await expect(w2.locator('#confirm-add-vault-for-tab-text')).toContainText('This tab (Far) is not in this vault.')
  await shoot(w2, 'dragtabs-3-ask')
  // Nothing moves until the vault is in.
  await expect(tabsOf(w2)).toHaveText(['Target', 'Travels'])
  await confirmSheet(w2).getByRole('button', { name: 'Add vault to this window' }).click()

  await expect(tabsOf(w2)).toHaveText(['Target', 'Travels', 'Far'])
  await expect(activeTab(w2)).toHaveText('Far')
  await expect(editorOf(w2)).toContainText('dragtabs-far-body')
  // YAZ-3091 D6 (D5 here): the move left w3 with no tab, so w3 closed.
  await expect.poll(() => windowCount(app)).toBe(3)
  await shoot(w2, 'dragtabs-4-added')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w2')).toMatchObject({ roots: [vault, other] })
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w2')?.tabs).toEqual([path.join(vault, 'Target.md'), path.join(vault, 'Travels.md'), far])
})
