/**
 * The SIDEBAR zoom (YAZ-3389), in the REAL app, from the footer's zoom chip and its menu (YAZ-3432): the menu's
 * "Zoom the sidebar in" makes the chip say 125% and
 * a tree row 1.25× taller on screen, while the sidebar's header, its tab row and the footer's cog keep
 * their size and place, and the window's own Chromium zoom stays 0. The value is a setting: it is in
 * the state file after a quit and comes back on the next launch. The percent goes back to 100%, and
 * View › Zoom In / Actual Size with no note focused step the same zoom. A Chromium zoom left from an
 * older build goes back to 0 at the next load (D8). A Files window (D13) zooms its own list: it opens one step above
 * the full window's sidebar zoom, and its zoom menu and View › Zoom In change only its own value.
 * The footer fits (YAZ-3401): from the narrowest sidebar (180 px) up, with the "Files window" chip, with an update
 * ready (a fake feed, as `update.spec`), and with both, no item runs past the footer and no label is cut.
 * The APP SIZE (YAZ-3432): the menu's App size row, on top and the same "− 100% +" as the Sidebar row below it, zooms
 * every window (Chromium's page zoom, a Files window too), a tab 1.25× larger on the screen at 125%, while the menu
 * keeps its size and its place, so a double click on + takes 100 to 125; it opens right above the chip at 125%, the
 * footer still fits at 180 px, and the value comes back after a relaunch; its percent goes back to 100%.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SIDEBAR_MIN_W } from '../../shared/types'
import { ARTIFACTS_DIR, activeTab, appWindow, buildFixtureVault, clickMenuItem, copyVault, extraWindow, fileRow, launchApp, quitApp, readState, seededState, shoot, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

/** The footer's zoom chip (YAZ-3432): it shows the sidebar zoom and opens the menu. */
const zoomChip = (w: Page) => w.locator('.sidebar__footer .zoom-chip')
const zoomMenu = (w: Page) => w.locator('.zoom-menu[role="dialog"]')
/** The menu's Sidebar row, "− 100% +"; the menu opens first when it is not up. */
async function control(w: Page) {
  if ((await zoomMenu(w).count()) === 0) await zoomChip(w).click()
  return zoomMenu(w).locator('[role="group"][aria-label="Sidebar zoom"]')
}
/** The menu's App size row, the same "− 100% +" as the Sidebar row (YAZ-3432), and its percent. */
const appRow = (w: Page) => zoomMenu(w).locator('[role="group"][aria-label="App size"]')
const appPercent = (w: Page) => appRow(w).locator('.zoom-stepper__value')
/** The real Chromium zoom factor of the window with `?win=<id>`, from main. */
const zoomFactor = (a: ElectronApplication, id = 'w1'): Promise<number> =>
  a.evaluate(({ BrowserWindow }, winId) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${winId}`))!.webContents.getZoomFactor(), id)
/** An element's box in SCREEN px (page px × `devicePixelRatio`, which Chromium's page zoom raises), rounded to 0.1. */
const screenBox = (w: Page, selector: string) =>
  w.locator(selector).first().evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished)) // the menu's settle-in moves it 4 px
    const r = el.getBoundingClientRect()
    const k = window.devicePixelRatio
    const round = (v: number) => Math.round(v * k * 10) / 10
    return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), dpr: k }
  })
/** Where an element is on the screen, in CSS px of the viewport (standardized zoom counts in `getBoundingClientRect`). */
const box = (w: Page, selector: string) =>
  w.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })
const rowHeight = (w: Page) => fileRow(w, 'Ideas').evaluate((el) => el.getBoundingClientRect().height)
/** The real Chromium zoom level of the window with `?win=<id>` (w1 by default), from main. */
const zoomLevel = (a: ElectronApplication, id = 'w1'): Promise<number> =>
  a.evaluate(({ BrowserWindow }, winId) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${winId}`))!.webContents.getZoomLevel(), id)
/** Set the window's Chromium zoom from main, as a ⌘+ of an older build did. */
const setZoomLevel = (a: ElectronApplication, level: number): Promise<void> =>
  a.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('win=w1'))!.webContents.setZoomLevel(l), level)
const CHROME = ['.sidebar__header', '.sidebar__lenses', '.sidebar__footer .settings-button']

/**
 * Why the footer does not fit (YAZ-3401), or `[]`: each rendered element in `.sidebar__footer` that ends past the
 * footer's content box (its edges less its padding), and each one whose text is cut (`scrollWidth` > `clientWidth`).
 * An inline box has no `clientWidth`, and an svg does not clip, so neither is checked for a cut. The pill's pop
 * (a scale from 0.6) ends first, because a transform changes `getBoundingClientRect`.
 */
const footerFaults = (w: Page): Promise<string[]> =>
  w.locator('.sidebar__footer').evaluate(async (footer) => {
    await Promise.all(footer.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished))
    const out: string[] = []
    const box = footer.getBoundingClientRect()
    const style = getComputedStyle(footer)
    const [left, right] = [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)]
    if (footer.scrollWidth > footer.clientWidth) out.push(`footer: content ${footer.scrollWidth} > ${footer.clientWidth}`)
    // The cog and the zoom chip always show, on one row.
    const tops = Array.from(footer.querySelectorAll('.settings-button, .zoom-chip')).map((el) => (el.getClientRects().length === 0 ? null : Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)))
    if (tops.length !== 2 || tops.some((t) => t === null || t !== tops[0])) out.push(`the cog and the zoom chip are not both shown on one row: ${JSON.stringify(tops)}`)
    for (const el of Array.from(footer.querySelectorAll<HTMLElement | SVGElement>('*'))) {
      if (el.getClientRects().length === 0) continue // not rendered
      const name = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]} "${el.textContent ?? ''}"`
      const r = el.getBoundingClientRect()
      if (r.right > right + 0.5) out.push(`${name}: right ${r.right.toFixed(1)} > footer ${right.toFixed(1)}`)
      if (r.left < left - 0.5) out.push(`${name}: left ${r.left.toFixed(1)} < footer ${left.toFixed(1)}`)
      if (el instanceof HTMLElement && getComputedStyle(el).display !== 'inline' && el.scrollWidth > el.clientWidth) out.push(`${name}: cut, ${el.scrollWidth} > ${el.clientWidth}`)
    }
    return out
  })
/**
 * Each width from the narrowest sidebar to 400 px, in 10 px steps, and each breakpoint's first width: the footer's
 * content box is 17 px narrower than a full window's sidebar (the padding and the resize edge) and 16 px narrower
 * than a Files window. The chip's 168 and 195 (app.css) are Files windows of 184 and 211. The pill's slot is the
 * footer less the cog, the zoom chip and the Files window chip (update.css): its 119 and 156 are a sidebar of 204 and
 * 241, and a Files window (with "Files window") of 305 and 342.
 */
const WIDTHS = [...new Set([...Array.from({ length: (400 - SIDEBAR_MIN_W) / 10 + 1 }, (_, i) => SIDEBAR_MIN_W + i * 10), 184, 204, 211, 241, 305, 342])].sort((a, b) => a - b)
/** Set the outer width of the window with `?win=<id>` from main. A Files window's sidebar is the whole window. */
const setWindowWidth = (a: ElectronApplication, id: string, width: number): Promise<void> =>
  a.evaluate(({ BrowserWindow }, arg) => {
    const bw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${arg.id}`))!
    bw.setBounds({ ...bw.getBounds(), width: arg.width })
  }, { id, width })
const sidebarW = (w: Page): Promise<number> => w.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width))
/** Drag the full window's sidebar edge to `width` (real mouse moves: the handler listens on `window`). */
async function dragSidebarTo(w: Page, width: number): Promise<void> {
  const edge = await w.locator('.sidebar-resize').boundingBox()
  if (edge === null) throw new Error('the sidebar resize edge has no box')
  const x = edge.x + edge.width / 2
  const y = edge.y + edge.height / 2
  await w.mouse.move(x, y)
  await w.mouse.down()
  await w.mouse.move(x + width - (await sidebarW(w)), y, { steps: 4 })
  await w.mouse.up()
  await expect.poll(() => sidebarW(w)).toBe(width)
}
/** The footer of `w` at each width that `resize` sets; one entry per width that does not fit. */
async function sweep(w: Page, resize: (width: number) => Promise<void>): Promise<Record<number, string[]>> {
  const bad: Record<number, string[]> = {}
  for (const width of WIDTHS) {
    await resize(width)
    const faults = await footerFaults(w)
    if (faults.length > 0) bad[width] = faults
  }
  return bad
}
const chip = (w: Page) => w.locator('.sidebar__footer .sidebar__files-chip')
const pill = (w: Page) => w.locator('.sidebar__footer .update-pill')
/** What the pill shows: its full words, its short words (CSS `::after`), or the round 🎉 alone. */
const pillShows = (w: Page): Promise<string> =>
  pill(w).evaluate((el) => {
    const label = el.querySelector('.update-pill__label')
    if (label === null || getComputedStyle(label).display !== 'none') return (label ?? el).textContent?.replace('🎉', '') ?? ''
    const after = getComputedStyle(el, '::after').content
    return after === 'none' ? '🎉' : after.replace(/^"|"$/g, '')
  })

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sidebarzoom-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "Zoom the sidebar in": 125%, a tree row 1.25× taller, the header, the tab row and the cog unchanged, the window not zoomed', async () => {
  // No note open: nothing claims the menu's zoom later, so it reaches the sidebar.
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(zoomChip(win)).toHaveText('100%')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  expect(await zoomLevel(app)).toBe(0)

  const row = await rowHeight(win)
  const chrome = await Promise.all(CHROME.map((s) => box(win, s)))
  await (await control(win)).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(zoomChip(win)).toHaveText('125%')
  await expect((await control(win)).locator('.zoom-stepper__value')).toHaveText('125%')
  await expect.poll(async () => (await rowHeight(win)) / row).toBeCloseTo(1.25, 1)
  expect(await Promise.all(CHROME.map((s) => box(win, s)))).toEqual(chrome)
  expect(await zoomLevel(app)).toBe(0)
  await shoot(win, 'sidebarzoom-01-125')
  await win.keyboard.press('Escape')
  await expect(zoomMenu(win)).toHaveCount(0)
})

test('step 2 — quit and launch again: the state file says 125 and the sidebar comes back at 125%', async () => {
  await quitApp(app)
  expect((await readState(userData)).settings.sidebarZoom).toBe(125)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(zoomChip(win)).toHaveText('125%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 3 — a click on the menu\'s percent goes back to 100%', async () => {
  await (await control(win)).locator('.zoom-stepper__value').click()
  await expect(zoomChip(win)).toHaveText('100%')
  await win.keyboard.press('Escape')
})

test('step 4 — View › Zoom In and Actual Size, with no note focused, step the sidebar zoom and never the window', async () => {
  await clickMenuItem(app, 'menu.view.zoom-in', 'w1')
  await expect(zoomChip(win)).toHaveText('125%')
  await clickMenuItem(app, 'menu.view.zoom-reset', 'w1')
  await expect(zoomChip(win)).toHaveText('100%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 5 — a Chromium zoom from an older build: the next load sets it back to the App size, 100% (D8, YAZ-3432)', async () => {
  await setZoomLevel(app, 2)
  expect(await zoomLevel(app)).toBe(2)
  await win.reload()
  await expect(zoomChip(win)).toHaveText('100%')
  await expect.poll(() => zoomLevel(app)).toBe(0)
})

test('step 6 — a Files window (D13): it opens one step above (125%), its + and View › Zoom In change only its own zoom, its window zoom stays 0', async () => {
  await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
  const files = await extraWindow(app, ['w1'])
  const filesId = winParam(files) ?? ''
  await expect(zoomChip(files)).toHaveText('125%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(125)
  await (await control(files)).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(zoomChip(files)).toHaveText('150%')
  await files.keyboard.press('Escape')
  await clickMenuItem(app, 'menu.view.zoom-in', filesId)
  await expect(zoomChip(files)).toHaveText('200%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(200)
  // The full window and the shared setting never moved; no window has a Chromium zoom.
  await expect(zoomChip(win)).toHaveText('100%')
  expect((await readState(userData)).settings.sidebarZoom).toBe(100)
  expect(await zoomLevel(app, filesId)).toBe(0)
  expect(await zoomLevel(app)).toBe(0)
  await shoot(files, 'sidebarzoom-06-files-window')
})

test('step 7 — YAZ-3401: a Files window\'s footer fits from 180 px up; the chip is never cut, also when armed', async () => {
  const files = app.windows().find((p) => p !== win && winParam(p) !== null)!
  const filesId = winParam(files) ?? ''
  const fit = (width: number) => async () => {
    await setWindowWidth(app, filesId, width)
    await expect.poll(() => sidebarW(files)).toBe(width)
  }
  for (const width of [SIDEBAR_MIN_W, 260]) {
    await fit(width)()
    expect.soft(await footerFaults(files), `Files window at ${width} px`).toEqual([])
    await expect(chip(files)).toHaveAccessibleName('Files window')
    await shoot(files, `sidebarzoom-07-files-${width}`)
    await chip(files).click() // armed: the first of the two clicks
    await expect(chip(files)).toHaveAccessibleName('Make full window')
    expect.soft(await footerFaults(files), `Files window at ${width} px, chip armed`).toEqual([])
    await shoot(files, `sidebarzoom-07-files-${width}-armed`)
    await files.mouse.move(5, 5) // leaving the chip disarms it
    await expect(chip(files)).toHaveAccessibleName('Files window')
  }
  expect.soft(await sweep(files, (width) => fit(width)()), 'Files window, 180–400 px').toEqual({})
})

test('step 8 — YAZ-3401: with an update ready, the footer fits from 180 px up, in a full window and in a Files window', async () => {
  // A fake feed with a newer release, as `update.spec`: an unpackaged run makes it `manual`, "New update ready".
  const release = (tag: string) => ({ tag_name: tag, name: 'Newest', published_at: '2026-10-17T12:00:00Z', draft: false, prerelease: false, body: 'Notes.', assets: [{ name: `Yaseen.Docs-${tag.slice(1)}-arm64.dmg`, browser_download_url: 'http://127.0.0.1:9/never.dmg', digest: `sha256:${'0'.repeat(64)}` }] })
  const server: Server = createServer((req, res) => {
    if (req.url === '/releases/latest') return void res.end(JSON.stringify(release('v99.0.0')))
    if (req.url?.startsWith('/releases') === true) return void res.end(JSON.stringify([release('v99.0.0')]))
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    if (app !== undefined) await quitApp(app) // undefined when this step runs alone (`-g "step 8"`)
    const seed = seededState(vault, null)
    seed.sidebarWidth = SIDEBAR_MIN_W
    app = await launchApp({ userData, seedState: seed, env: { YASEEN_DOCS_UPDATE_FEED: `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases` } })
    win = await appWindow(app, 'w1')
    await clickMenuItem(app, 'menu.app.check-updates', 'w1')
    await expect(pill(win)).toHaveAccessibleName('New update ready', { timeout: 15_000 })
    // The check may open the "What's new" sheet over the window: "Later" closes it.
    const sheet = win.locator('.whats-new[role="dialog"]')
    await sheet.getByRole('button', { name: 'Later' }).click({ timeout: 3_000 }).catch(() => undefined)
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sidebarW(win)).toBe(SIDEBAR_MIN_W)

    // The full window: the cog, the zoom chip and the pill.
    expect.soft(await footerFaults(win), `full window at ${SIDEBAR_MIN_W} px, update ready`).toEqual([])
    expect.soft(await pillShows(win)).toBe('🎉')
    await shoot(win, `sidebarzoom-08-full-${SIDEBAR_MIN_W}`)
    await dragSidebarTo(win, 220)
    expect.soft(await footerFaults(win), 'full window at 220 px, update ready').toEqual([])
    expect.soft(await pillShows(win)).toBe('Update')
    await shoot(win, 'sidebarzoom-08-full-220')
    expect.soft(await sweep(win, (width) => dragSidebarTo(win, width)), 'full window, 180–400 px, update ready').toEqual({})
    // The short words from 204 px, the full words from 241 px: as soon as each fits.
    await dragSidebarTo(win, 203)
    expect.soft(await pillShows(win)).toBe('🎉')
    await dragSidebarTo(win, 204)
    expect.soft(await pillShows(win)).toBe('Update')
    await dragSidebarTo(win, 240)
    expect.soft(await pillShows(win)).toBe('Update')
    await dragSidebarTo(win, 241)
    expect.soft(await pillShows(win)).toBe('New update ready')
    await expect(pill(win)).toHaveAttribute('title', "Click to see what's new")

    // A Files window: the cog, the zoom chip, the Files window chip and the pill.
    await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
    const files = await extraWindow(app, ['w1'])
    const filesId = winParam(files) ?? ''
    await expect(pill(files)).toHaveAccessibleName('New update ready')
    const fit = async (width: number) => {
      await setWindowWidth(app, filesId, width)
      await expect.poll(() => sidebarW(files)).toBe(width)
    }
    for (const width of [SIDEBAR_MIN_W, 260]) {
      await fit(width)
      expect.soft(await footerFaults(files), `Files window at ${width} px, update ready`).toEqual([])
      await shoot(files, `sidebarzoom-08-files-${width}`)
      await chip(files).click()
      await expect(chip(files)).toHaveAccessibleName('Make full window')
      expect.soft(await footerFaults(files), `Files window at ${width} px, update ready, chip armed`).toEqual([])
      await shoot(files, `sidebarzoom-08-files-${width}-armed`)
      await files.mouse.move(5, 5)
      await expect(chip(files)).toHaveAccessibleName('Files window')
    }
    expect.soft(await sweep(files, fit), 'Files window, 180–400 px, update ready').toEqual({})
    // Beside the chip, the pill keeps its round 🎉 to 304 px, then its short words, then its full words from 342 px.
    for (const [width, shows] of [[304, '🎉'], [305, 'Update'], [341, 'Update'], [342, 'New update ready']] as const) {
      await fit(width)
      expect.soft(await pillShows(files), `Files window at ${width} px`).toBe(shows)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

/**
 * A step screenshot of a window at an App size other than 100%, from main (`capturePage`): `page.screenshot` sizes its
 * shot by the page's px and so cuts a zoomed window short. Same name and folder as `shoot`.
 */
async function shootZoomed(a: ElectronApplication, w: Page, name: string): Promise<void> {
  const id = winParam(w) ?? ''
  const png = await a.evaluate(async ({ BrowserWindow }, winId) => (await BrowserWindow.getAllWindows().find((bw) => bw.webContents.getURL().includes(`win=${winId}`))!.webContents.capturePage()).toPNG().toString('base64'), id)
  await mkdir(ARTIFACTS_DIR, { recursive: true })
  await writeFile(path.join(ARTIFACTS_DIR, `${name}.png`), Buffer.from(png, 'base64'))
}
/** The Files window step 8 opened (its `?win=` is not w1). */
const filesPage = (): Page => app.windows().find((p) => p !== win && winParam(p) !== null && winParam(p) !== 'w1')!
/** The menu's box against the chip's, in page px: how far its bottom is above the chip's top, its left against the chip's, its right against the window's. */
const menuPlace = (w: Page) =>
  w.evaluate(async () => {
    await Promise.all(document.querySelector('.zoom-menu')!.getAnimations().map((a) => a.finished))
    const m = document.querySelector('.zoom-menu')!.getBoundingClientRect()
    const c = document.querySelector('.sidebar__footer .zoom-chip')!.getBoundingClientRect()
    return { above: Math.round((c.top - m.bottom) * 10) / 10, left: Math.round((m.left - c.left) * 10) / 10, room: Math.round((window.innerWidth - m.right) * 10) / 10 }
  })
const ACTIVE_TAB = '.tabbar [role="tab"][aria-selected="true"]'

test('step 9 — YAZ-3432: the zoom chip opens the menu right above it, App size on top and Sidebar below, each − % +; Escape and a click outside close it', async () => {
  await dragSidebarTo(win, 260)
  await expect(zoomChip(win)).toHaveAttribute('aria-expanded', 'false')
  await zoomChip(win).click()
  await expect(zoomMenu(win)).toBeVisible()
  await expect(zoomChip(win)).toHaveAttribute('aria-expanded', 'true')
  // App size on top, Sidebar at the bottom next to the chip; both rows the same "− 100% +".
  await expect(zoomMenu(win).locator('.zoom-menu__label')).toHaveText(['App size', 'Sidebar'])
  await expect(zoomMenu(win).locator('[role="group"]')).toHaveText(['−100%+', '−100%+'])
  await expect(appRow(win).getByRole('button', { name: 'Make the app smaller', exact: true })).toBeEnabled()
  const place = await menuPlace(win)
  expect(place.above).toBeCloseTo(4, 0)
  expect(place.left).toBeCloseTo(0, 0)
  expect(place.room).toBeGreaterThan(0)
  await shoot(win, 'sidebarzoom-09-menu')
  await win.keyboard.press('Escape')
  await expect(zoomMenu(win)).toHaveCount(0)
  await expect(zoomChip(win)).toBeFocused()
  await zoomChip(win).click()
  await expect(zoomMenu(win)).toBeVisible()
  await win.mouse.click(700, 400) // the page, away from the menu
  await expect(zoomMenu(win)).toHaveCount(0)
})

test('step 10 — YAZ-3432: a double click on App size + (100 → 125) zooms every window, a tab 1.25× and the Files window too, while the menu and its + keep their size and place', async () => {
  const files = filesPage()
  const filesId = winParam(files) ?? ''
  await fileRow(win, 'Ideas').click()
  await expect(activeTab(win)).toBeVisible()
  const tab = await screenBox(win, ACTIVE_TAB)
  const filesRow = await screenBox(files, '.tree__row--file')
  const filesPageW = await sidebarW(files)
  expect([await zoomFactor(app), await zoomFactor(app, filesId)]).toEqual([1, 1])

  await zoomChip(win).click()
  const before = await screenBox(win, '.zoom-menu')
  const plus = appRow(win).getByRole('button', { name: 'Make the app larger', exact: true })
  const plusBefore = await screenBox(win, '.zoom-menu [aria-label="App size"] button[aria-label="Make the app larger"]')
  await shoot(win, 'sidebarzoom-10-app-100-menu-open')
  // A quick double click on + at one point on the screen: both clicks land on +, 100 → 110 → 125, and + is then off.
  await plus.dblclick()
  await expect(appPercent(win)).toHaveText('125%')
  await expect(plus).toBeDisabled()
  await expect.poll(() => zoomFactor(app)).toBe(1.25)
  await expect.poll(() => zoomFactor(app, filesId)).toBe(1.25)
  await expect.poll(async () => (await screenBox(win, ACTIVE_TAB)).height / tab.height).toBeCloseTo(1.25, 1)
  await expect.poll(async () => (await screenBox(win, ACTIVE_TAB)).width / tab.width).toBeCloseTo(1.25, 1)
  await expect.poll(async () => (await screenBox(files, '.tree__row--file')).height / filesRow.height).toBeCloseTo(1.25, 1)
  // YAZ-3441: the open Files window grew by the same factor, so its page keeps its width.
  await expect.poll(() => sidebarW(files)).toBe(filesPageW)
  // The menu on the screen: the same size, in the same place, so the buttons stay under the pointer.
  const after = await screenBox(win, '.zoom-menu')
  expect(after.dpr / before.dpr).toBeCloseTo(1.25, 2)
  const plusAfter = await screenBox(win, '.zoom-menu [aria-label="App size"] button[aria-label="Make the app larger"]')
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(plusAfter[k] - plusBefore[k]), `+ ${k}: ${plusBefore[k]} → ${plusAfter[k]}`).toBeLessThanOrEqual(1.5)
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[k] - before[k]), `menu ${k}: ${before[k]} → ${after[k]}`).toBeLessThanOrEqual(1.5)
  await expect.poll(async () => (await readState(userData)).settings.appZoom).toBe(125)
  await shootZoomed(app, win, 'sidebarzoom-10-app-125-menu-open')
  await shootZoomed(app, files, 'sidebarzoom-10-files-125')
  // The Files window's own menu says the same.
  await zoomChip(files).click()
  await expect(appPercent(files)).toHaveText('125%')
  await files.keyboard.press('Escape')
  await expect(zoomMenu(files)).toHaveCount(0)
})

test('step 11 — YAZ-3432, YAZ-3441: at 125% the menu opens right above the chip and inside the window; the footer still fits at 180 px; a new Files window\'s page is as wide as the 180 px sidebar, with its "Files" tab', async () => {
  await win.keyboard.press('Escape')
  await expect(zoomMenu(win)).toHaveCount(0)
  await zoomChip(win).click()
  // Within a page px: at 125% the 4 px gap is 5 screen px, snapped to whole device pixels.
  const place = await menuPlace(win)
  expect(Math.abs(place.above - 4)).toBeLessThanOrEqual(1)
  expect(Math.abs(place.left)).toBeLessThanOrEqual(1)
  expect(place.room).toBeGreaterThan(0)
  await shootZoomed(app, win, 'sidebarzoom-11-menu-at-125')
  await win.keyboard.press('Escape')

  await dragSidebarTo(win, SIDEBAR_MIN_W)
  expect.soft(await footerFaults(win), `full window at ${SIDEBAR_MIN_W} px, App size 125%`).toEqual([])
  await zoomChip(win).click()
  await shootZoomed(app, win, `sidebarzoom-11-full-${SIDEBAR_MIN_W}-at-125`)
  await win.keyboard.press('Escape')

  // YAZ-3441: File › New Files Window from the 180 px sidebar, with no resize by hand. The window is 225 px on the
  // screen, so its page is 180 px, as wide as the source's sidebar, and the "Files" tab shows (it went to ⋯ at 144 px).
  const known = app.windows().map(winParam).filter((id): id is string => id !== null)
  await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
  const files = await extraWindow(app, known)
  const filesId = winParam(files) ?? ''
  await expect.poll(() => sidebarW(files)).toBe(SIDEBAR_MIN_W)
  expect(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${id}`))!.getBounds().width, filesId)).toBe(SIDEBAR_MIN_W * 1.25)
  await expect(files.locator('.sidebar__lenses .sidebar__lens').filter({ hasText: /^Files$/ })).toBeVisible()
  // The menu, wider than the chip's room, moves left to stay inside it (a measure that once looped and blanked the window).
  expect.soft(await footerFaults(files), `Files window at ${SIDEBAR_MIN_W} px, App size 125%`).toEqual([])
  await zoomChip(files).click()
  await expect(zoomMenu(files)).toBeVisible()
  expect((await menuPlace(files)).room).toBeGreaterThanOrEqual(0)
  await shootZoomed(app, files, `sidebarzoom-11-files-${SIDEBAR_MIN_W}-at-125`)
  await files.keyboard.press('Escape')
})

test('step 12 — YAZ-3432: quit and launch again: the state file says 125 and every window comes back at 125%; a click on the App size percent goes back to 100%', async () => {
  await quitApp(app)
  expect((await readState(userData)).settings.appZoom).toBe(125)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect.poll(() => zoomFactor(app)).toBe(1.25)
  await expect(activeTab(win)).toBeVisible()
  await shootZoomed(app, win, 'sidebarzoom-12-relaunch-125')
  await zoomChip(win).click()
  await appPercent(win).click()
  await expect.poll(() => zoomFactor(app)).toBe(1)
  await expect.poll(async () => (await readState(userData)).settings.appZoom).toBe(100)
})
