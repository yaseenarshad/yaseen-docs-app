/**
 * The SIDEBAR zoom (YAZ-3389), in the REAL app: "Zoom the sidebar in" makes the footer say 125% and
 * a tree row 1.25× taller on screen, while the sidebar's header, its tab row and the footer's cog keep
 * their size and place, and the window's own Chromium zoom stays 0. The value is a setting: it is in
 * the state file after a quit and comes back on the next launch. The percent goes back to 100%, and
 * View › Zoom In / Actual Size with no note focused step the same zoom. A Chromium zoom left from an
 * older build goes back to 0 at the next load (D8). A Files window (D13) zooms its own list: it opens one step above
 * the full window's sidebar zoom, and its footer and View › Zoom In change only its own value.
 * The footer fits (YAZ-3401): from the narrowest sidebar (180 px) up, with the "Files window" chip, with an update
 * ready (a fake feed, as `update.spec`), and with both, no item runs past the footer and no label is cut.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SIDEBAR_MIN_W } from '../../shared/types'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, extraWindow, fileRow, launchApp, quitApp, readState, seededState, shoot, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const control = (w: Page) => w.locator('.sidebar__footer [role="group"][aria-label="Sidebar zoom"]')
const percent = (w: Page) => control(w).locator('.sidebar-zoom__value')
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
    // The cog and the whole zoom control always show, on one row.
    const tops = Array.from(footer.querySelectorAll('.settings-button, .sidebar-zoom > button')).map((el) => (el.getClientRects().length === 0 ? null : Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)))
    if (tops.length !== 4 || tops.some((t) => t === null || t !== tops[0])) out.push(`the cog and the zoom are not all shown on one row: ${JSON.stringify(tops)}`)
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
 * than a Files window. The chip's 212 and 239 (app.css) are Files windows of 228 and 255. The pill's slot is the
 * footer less the cog, the zoom and the chip (update.css): its 119 and 156 are a sidebar of 248 and 285, and a Files
 * window (with "Files window") of 349 and 386.
 */
const WIDTHS = [...new Set([...Array.from({ length: (400 - SIDEBAR_MIN_W) / 10 + 1 }, (_, i) => SIDEBAR_MIN_W + i * 10), 228, 248, 255, 285, 349, 386])].sort((a, b) => a - b)
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
  await expect(percent(win)).toHaveText('100%')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  expect(await zoomLevel(app)).toBe(0)

  const row = await rowHeight(win)
  const chrome = await Promise.all(CHROME.map((s) => box(win, s)))
  await control(win).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(percent(win)).toHaveText('125%')
  await expect.poll(async () => (await rowHeight(win)) / row).toBeCloseTo(1.25, 1)
  expect(await Promise.all(CHROME.map((s) => box(win, s)))).toEqual(chrome)
  expect(await zoomLevel(app)).toBe(0)
  await shoot(win, 'sidebarzoom-01-125')
})

test('step 2 — quit and launch again: the state file says 125 and the sidebar comes back at 125%', async () => {
  await quitApp(app)
  expect((await readState(userData)).settings.sidebarZoom).toBe(125)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(percent(win)).toHaveText('125%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 3 — a click on the percent goes back to 100%', async () => {
  await percent(win).click()
  await expect(percent(win)).toHaveText('100%')
})

test('step 4 — View › Zoom In and Actual Size, with no note focused, step the sidebar zoom and never the window', async () => {
  await clickMenuItem(app, 'menu.view.zoom-in', 'w1')
  await expect(percent(win)).toHaveText('125%')
  await clickMenuItem(app, 'menu.view.zoom-reset', 'w1')
  await expect(percent(win)).toHaveText('100%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 5 — a Chromium zoom from an older build: the next load sets it back to 0 (D8)', async () => {
  await setZoomLevel(app, 2)
  expect(await zoomLevel(app)).toBe(2)
  await win.reload()
  await expect(percent(win)).toHaveText('100%')
  await expect.poll(() => zoomLevel(app)).toBe(0)
})

test('step 6 — a Files window (D13): it opens one step above (125%), its + and View › Zoom In change only its own zoom, its window zoom stays 0', async () => {
  await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
  const files = await extraWindow(app, ['w1'])
  const filesId = winParam(files) ?? ''
  await expect(percent(files)).toHaveText('125%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(125)
  await control(files).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(percent(files)).toHaveText('150%')
  await clickMenuItem(app, 'menu.view.zoom-in', filesId)
  await expect(percent(files)).toHaveText('200%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(200)
  // The full window and the shared setting never moved; no window has a Chromium zoom.
  await expect(percent(win)).toHaveText('100%')
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

    // The full window: the cog, the zoom and the pill.
    expect.soft(await footerFaults(win), `full window at ${SIDEBAR_MIN_W} px, update ready`).toEqual([])
    expect.soft(await pillShows(win)).toBe('🎉')
    await shoot(win, `sidebarzoom-08-full-${SIDEBAR_MIN_W}`)
    await dragSidebarTo(win, 260)
    expect.soft(await footerFaults(win), 'full window at 260 px, update ready').toEqual([])
    expect.soft(await pillShows(win)).toBe('Update')
    await shoot(win, 'sidebarzoom-08-full-260')
    expect.soft(await sweep(win, (width) => dragSidebarTo(win, width)), 'full window, 180–400 px, update ready').toEqual({})
    // The short words from 248 px, the full words from 285 px: as soon as each fits.
    await dragSidebarTo(win, 247)
    expect.soft(await pillShows(win)).toBe('🎉')
    await dragSidebarTo(win, 248)
    expect.soft(await pillShows(win)).toBe('Update')
    await dragSidebarTo(win, 284)
    expect.soft(await pillShows(win)).toBe('Update')
    await dragSidebarTo(win, 285)
    expect.soft(await pillShows(win)).toBe('New update ready')
    await expect(pill(win)).toHaveAttribute('title', "Click to see what's new")

    // A Files window: the cog, the zoom, the chip and the pill.
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
    // Beside the chip, the pill keeps its round 🎉 to 348 px, then its short words, then its full words from 386 px.
    for (const [width, shows] of [[348, '🎉'], [349, 'Update'], [385, 'Update'], [386, 'New update ready']] as const) {
      await fit(width)
      expect.soft(await pillShows(files), `Files window at ${width} px`).toBe(shows)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
