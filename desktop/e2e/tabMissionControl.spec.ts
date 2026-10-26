/**
 * TABS & WINDOWS MISSION CONTROL (YAZ-3343): the user flow of the tab board with TWO windows on one vault,
 * through the real IPC and the real state file. "Show all windows" is on by default (D19), so the board of
 * w1 shows a frame for each window (D8, D17). A card dragged to a new place keeps it when the board closes
 * and opens again (D1, S19). A card dropped in the other window's frame moves the real tab there as a
 * background tab, and that window is not raised (D13, D20, S40, S41). A double-click on a frame's label
 * names the window (D14, D32, S24). A relaunch with the same user-data-dir keeps the moved card's place
 * and the window's name (D1, S19).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a copy of the fixture vault, hidden windows
 * (`YASEEN_DOCS_E2E_HIDDEN`, helpers.ts), `mission-` step screenshots, serial. The drags are Playwright's
 * pointer events in the page (CDP): no OS pointer moves.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState, CanvasCard } from '../../shared/types'
import { activeTab, appWindow, buildFixtureVault, copyVault, launchApp, multiWindowState, quitApp, readState, SEED_FILE, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

const WINDOW_NAME = 'Client work'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let w1: Page
let w2: Page
let welcome: string
let ideas: string
let roadmap: string
let oldPlan: string
/** Where the Roadmap card was put by the drag of step 2 (world px, as stored). */
let placed: { x: number; y: number }

const board = (w: Page) => w.locator('.taboverview')
const gridButton = (w: Page) => w.locator('.tabbar-nav [aria-label="Show all open tabs"]')
const frame = (w: Page, win: string) => w.locator(`.taboverview__frame[data-win="${win}"]`)
const card = (w: Page, win: string, file: string) => w.locator(`.taboverview__page[data-win="${win}"][data-path="${file}"]`)
const cardTitles = (w: Page, win: string) => w.locator(`.taboverview__page[data-win="${win}"] .taboverview__title`)

/** The stored card of `file` in window `win`, window layout, or undefined. */
const storedCard = (state: AppState, win: string, file: string): CanvasCard | undefined =>
  state.tabCanvas.cards.find((c) => c.win === win && c.path === file && c.by === 'window')

/** A card's place as the board draws it: its `left` / `top` in world px. */
async function placeOf(c: Locator): Promise<{ x: number; y: number }> {
  return c.evaluate((el) => ({ x: Math.round(parseFloat((el as HTMLElement).style.left)), y: Math.round(parseFloat((el as HTMLElement).style.top)) }))
}

/** A real drag on the board: press on the card's title, move in steps past the drag slop, let go at `to`. */
async function drag(w: Page, c: Locator, to: { x: number; y: number }): Promise<void> {
  const box = (await c.locator('.taboverview__title').boundingBox())!
  const from = { x: box.x + 12, y: box.y + box.height / 2 }
  await w.mouse.move(from.x, from.y)
  await w.mouse.down()
  await w.mouse.move(from.x + 8, from.y + 8, { steps: 4 })
  await w.mouse.move(to.x, to.y, { steps: 12 })
  await w.mouse.up()
}

/** Whether point `p` is inside `box` grown by `pad` on each side. */
const inside = (p: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }, pad: number): boolean =>
  p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad

async function openBoard(w: Page): Promise<void> {
  await gridButton(w).click()
  await expect(board(w)).toBeVisible()
  // The board opens with a zoom and then fits every window (D24): measure only once the camera stands still.
  const first = card(w, 'w1', welcome)
  await expect(first).toBeVisible()
  await expect
    .poll(async () => {
      const a = await first.boundingBox()
      await w.waitForTimeout(150)
      const b = await first.boundingBox()
      return a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width
    })
    .toBe(true)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3343-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  welcome = path.join(vault, SEED_FILE)
  ideas = path.join(vault, 'Ideas.md')
  roadmap = path.join(vault, 'Projects', 'Roadmap.md')
  oldPlan = path.join(vault, 'Projects', 'archive', 'Old plan.md')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the board opens with a frame for each window: "Show all windows" is on by default (D8, D19, S21)', async () => {
  const state = multiWindowState(
    [
      { id: 'w1', root: vault, file: welcome, bounds: { x: 60, y: 60, width: 1200, height: 800 } },
      { id: 'w2', root: vault, file: oldPlan, bounds: { x: 120, y: 90, width: 1000, height: 700 } },
    ],
    [vault],
  )
  state.windows[0].tabs = [welcome, ideas, roadmap]
  app = await launchApp({ userData, seedState: state })
  w1 = await appWindow(app, 'w1')
  w2 = await appWindow(app, 'w2')
  await expect(tabsOf(w1)).toHaveText(['Welcome note', 'Ideas', 'Roadmap'])
  await expect(tabsOf(w2)).toHaveText(['Old plan'])

  await openBoard(w1)
  await expect(w1.locator('.taboverview__switch input[role="switch"]')).toBeChecked()
  await expect(frame(w1, 'w1')).toBeVisible()
  await expect(frame(w1, 'w2')).toBeVisible()
  await expect(frame(w1, 'w1').locator('.taboverview__frame-here')).toHaveText('This window')
  await expect(frame(w1, 'w2').locator('.taboverview__frame-here')).toHaveCount(0)
  await expect(cardTitles(w1, 'w1')).toHaveText(['Welcome note', 'Ideas', 'Roadmap'])
  await expect(cardTitles(w1, 'w2')).toHaveText(['Old plan'])
  // Nothing is stored before the user moves something (D1).
  expect((await readState(userData)).tabCanvas.cards).toEqual([])
  await shoot(w1, 'mission-01-board-two-frames')
})

test('step 2 — a card of this window dragged to a new place stays there, and the place is stored (D1, D12, S13, S19)', async () => {
  const c = card(w1, 'w1', roadmap)
  const before = await placeOf(c)
  const box = (await c.boundingBox())!
  const other = (await frame(w1, 'w2').boundingBox())!
  // A spot of empty canvas above the card (its frame grows there, S18), never near the other window's frame: a drop
  // in it would move the tab, and a frame that would grow into it gives way back to the free cell (D28).
  const spots = [-1.4, -2.4, 2.6, 3.6].map((k) => ({ x: box.x + 12, y: box.y + box.height * k }))
  const to = spots.find((p) => !inside(p, other, 120))!
  expect(to).toBeDefined()
  await drag(w1, c, to)

  await expect.poll(async () => storedCard(await readState(userData), 'w1', roadmap) !== undefined).toBe(true)
  const stored = storedCard(await readState(userData), 'w1', roadmap)!
  placed = { x: stored.x, y: stored.y }
  expect(placed).not.toEqual(before)
  await expect.poll(() => placeOf(c)).toEqual(placed)
  // It moved no tab: both strips are as they were (S16).
  await expect(tabsOf(w1)).toHaveText(['Welcome note', 'Ideas', 'Roadmap'])
  await expect(tabsOf(w2)).toHaveText(['Old plan'])
  // Only the card the user moved is stored (D16).
  expect((await readState(userData)).tabCanvas.cards.map((one) => path.basename(one.path))).toEqual(['Roadmap.md'])
  await shoot(w1, 'mission-02-card-moved')
})

test('step 3 — the board closes and opens again: the card is still where it was put (S19)', async () => {
  await w1.keyboard.press('Escape')
  await expect(board(w1)).toHaveCount(0)
  await openBoard(w1)
  await expect.poll(() => placeOf(card(w1, 'w1', roadmap))).toEqual(placed)
  await shoot(w1, 'mission-03-reopened')
})

test('step 4 — a card dropped in the other window\'s frame moves the tab there as a background tab; that window is not raised (D13, D20, S40, S41)', async () => {
  // A spy on each window's raise: main calls `focus`, `show` or `restore` on a window it brings to the front.
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const spy = globalThis as unknown as { __raised: string[] }
    spy.__raised = []
    for (const win of BrowserWindow.getAllWindows()) {
      const id = new URL(win.webContents.getURL()).searchParams.get('win')
      for (const name of ['focus', 'show', 'restore', 'moveTop'] as const) {
        const real = win[name].bind(win)
        win[name] = (() => {
          spy.__raised.push(`${id}:${name}`)
          real()
        }) as never
      }
    }
    const realFocus = electronApp.focus.bind(electronApp)
    electronApp.focus = ((opts?: { steal: boolean }) => {
      spy.__raised.push('app:focus')
      realFocus(opts)
    }) as typeof electronApp.focus
  })

  const target = (await frame(w1, 'w2').boundingBox())!
  await drag(w1, card(w1, 'w1', ideas), { x: target.x + target.width / 2, y: target.y + target.height - 12 })

  // The tab is in w2 now: its strip and the state file say so, and it left w1.
  await expect(tabsOf(w2)).toHaveText(['Old plan', 'Ideas'])
  await expect(tabsOf(w1)).toHaveText(['Welcome note', 'Roadmap'])
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w2')?.tabs).toEqual([oldPlan, ideas])
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w1')?.tabs).toEqual([welcome, roadmap])
  // A BACKGROUND tab (D20): w2 keeps its active tab, and main raised no window.
  await expect(activeTab(w2)).toHaveText('Old plan')
  expect(await app.evaluate(() => (globalThis as unknown as { __raised: string[] }).__raised)).toEqual([])
  // The board stays open on w1, and the card now stands in w2's frame, where it is stored (D28, S41).
  await expect(board(w1)).toBeVisible()
  await expect(card(w1, 'w2', ideas)).toBeVisible()
  await expect(card(w1, 'w1', ideas)).toHaveCount(0)
  await expect.poll(async () => storedCard(await readState(userData), 'w2', ideas) !== undefined).toBe(true)
  const arrived = storedCard(await readState(userData), 'w2', ideas)!
  await expect.poll(() => placeOf(card(w1, 'w2', ideas))).toEqual({ x: arrived.x, y: arrived.y })
  // The Roadmap card did not move (S16).
  await expect.poll(() => placeOf(card(w1, 'w1', roadmap))).toEqual(placed)
  await shoot(w1, 'mission-04-moved-to-other-window')
  await shoot(w2, 'mission-04b-other-window-strip')
})

test('step 5 — a double-click on the other frame\'s label names that window (D14, D32, S24)', async () => {
  await frame(w1, 'w2').locator('.taboverview__frame-label').dblclick()
  const field = frame(w1, 'w2').locator('input[aria-label="Display name"]')
  await expect(field).toBeFocused()
  await w1.keyboard.type(WINDOW_NAME)
  await w1.keyboard.press('Enter')
  await expect(frame(w1, 'w2').locator('.taboverview__frame-name')).toHaveText(WINDOW_NAME)
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w2')?.name).toBe(WINDOW_NAME)
  // The name leads the window's title (D14): ⌘` and the Window menu list it.
  await expect.poll(() => w2.title()).toMatch(new RegExp(`^${WINDOW_NAME}`))
  // w1 keeps its automatic label.
  expect((await readState(userData)).windows.find((w) => w.id === 'w1')?.name).toBeUndefined()
  await shoot(w1, 'mission-05-window-named')
})

test('step 6 — a relaunch with the same user-data-dir keeps the moved cards\' places and the window\'s name (D1, D14, S19)', async () => {
  const arrived = storedCard(await readState(userData), 'w2', ideas)!
  await quitApp(app)
  const flushed = await readState(userData)
  expect(storedCard(flushed, 'w1', roadmap)).toMatchObject(placed)
  expect(flushed.windows.find((w) => w.id === 'w2')?.name).toBe(WINDOW_NAME)

  app = await launchApp({ userData }) // NO re-seed: the state is what the quit wrote
  w1 = await appWindow(app, 'w1')
  w2 = await appWindow(app, 'w2')
  await expect(tabsOf(w1)).toHaveText(['Welcome note', 'Roadmap'])
  await expect(tabsOf(w2)).toHaveText(['Old plan', 'Ideas'])
  await openBoard(w1)
  await expect.poll(() => placeOf(card(w1, 'w1', roadmap))).toEqual(placed)
  await expect.poll(() => placeOf(card(w1, 'w2', ideas))).toEqual({ x: arrived.x, y: arrived.y })
  await expect(frame(w1, 'w2').locator('.taboverview__frame-name')).toHaveText(WINDOW_NAME)
  await expect.poll(() => w2.title()).toMatch(new RegExp(`^${WINDOW_NAME}`))
  await shoot(w1, 'mission-06-relaunched')
  await quitApp(app)
})
