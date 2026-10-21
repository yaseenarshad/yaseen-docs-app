/**
 * THE UPDATE FLOW (YAZ-2976 D3–D8): the pill, the "What's new" sheet and its buttons, against a fake
 * GitHub feed. `YASEEN_DOCS_UPDATE_FEED` turns the updater on in this unpackaged run (S7); an
 * unpackaged copy cannot replace itself, so a newer release is `manual` (S13): "New update ready" and
 * "Download". The download, the checks and the swap of a `ready` update are proved out of sight by
 * `desktop/src/main/updater.codesign.test.ts` and `updater.swap.test.ts`, with the real `hdiutil`,
 * `codesign` and `/bin/sh`.
 *
 * Same harness as its siblings: temp `--user-data-dir`, COPY of the fixture, `update-` step screenshots.
 * `shell.openExternal` is stubbed in main, so "Download" and a link in the notes never open the browser.
 */
// Written for YAZ-2976 and corrected for YAZ-2986 and YAZ-2988 (the list of releases, the tags, the lightbox) without being run: the testing rules of that work forbid a test
// that opens windows on Yasin's screen. Every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** A 1×1 PNG: the picture of a release body, served by the feed. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let server: Server
let base = ''
const NEWEST = 'v99.0.0'
/** What `releases/latest` answers. While it is v99 the list is the two newer releases and the running version, newest first; after that, the running version alone. */
let latest = NEWEST
/** The running app's version, read at each launch: the feed lists its release, so the sheet can tag it (YAZ-2988 D10). */
let running = ''

const release = (tag: string, title: string, body: string) => ({
  tag_name: tag,
  name: title,
  published_at: '2026-10-17T12:00:00Z',
  draft: false,
  prerelease: false,
  body,
  assets: [{ name: `Yaseen.Docs-${tag.slice(1)}-arm64.dmg`, browser_download_url: `${base}/never-downloaded.dmg`, digest: `sha256:${'0'.repeat(64)}` }],
})
const releases = () =>
  latest === NEWEST
    ? [release(NEWEST, 'Newest Release', `The newest notes.\n\n![a picture](${base}/pixel.png)\n\n[Read more](https://example.com/more)`), release('v98.0.0', 'Older Release', 'The older notes.'), release(`v${running}`, 'This Release', 'The notes of the running version.')]
    : [release(latest, 'This Release', 'The notes of the running version.')]

let userData = ''
let vault = ''
let app: ElectronApplication
let win: Page

const pill = (w: Page) => w.locator('.sidebar__footer .update-pill')
const whatsNew = (w: Page) => w.locator('.whats-new[role="dialog"]')
/** The footer's buttons: the rows of the list are options, not buttons, but scope to the footer all the same. */
const actions = (w: Page) => whatsNew(w).locator('.whats-new__actions button')
const rows = (w: Page) => whatsNew(w).locator('.whats-new__row')
const opened = (): Promise<string[]> => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])

async function launch(): Promise<void> {
  process.env.YASEEN_DOCS_UPDATE_FEED = `${base}/releases`
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  running = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  // "Download" and a link in the notes ask main to open the browser: record the URL instead.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/releases/latest') return void res.end(JSON.stringify(releases()[0]))
    if (url.pathname === '/releases') return void res.end(JSON.stringify(releases()))
    if (url.pathname === '/pixel.png') return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(PIXEL)
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  userData = await mkdtemp(path.join(tmpdir(), 'update-userdata-'))
  vault = await copyVault(await buildFixtureVault())
  await launch()
})

test.afterAll(async () => {
  await quitApp(app)
  delete process.env.YASEEN_DOCS_UPDATE_FEED
  await new Promise((resolve) => server.close(resolve))
})

// No "no pill at launch" check: the timer's check 10 s after `ready` can win the race on a slow launch.
test('step 1 — Check for Updates… finds v99: the sheet opens at once, and the pill says "New update ready" (S6, S7, S13, D4)', async () => {
  await expect(win.locator('.sidebar__footer .settings-button')).toBeVisible()
  await clickMenuItem(app, 'menu.app.check-updates', 'w1')
  await expect(whatsNew(win)).toBeVisible()
  await expect(actions(win)).toHaveText(['Later', 'Download'])
  await expect(pill(win)).toHaveText('🎉New update ready')
  await expect(pill(win)).toHaveAttribute('title', "Click to see what's new") // YAZ-2988: the tooltip says what a click does
  await shoot(win, 'update-01-pill')
  await whatsNew(win).getByRole('button', { name: 'Later' }).click()
  await expect(whatsNew(win)).toHaveCount(0)
  await expect(pill(win)).toHaveText('🎉New update ready') // S19
})

test('step 2 — the pill opens "What\'s new": every release in the list, the tags, the latest selected, a lazy picture (S14, S16, D5, YAZ-2988 D9–D11)', async () => {
  await pill(win).click()
  await expect(whatsNew(win)).toBeVisible()
  await expect(rows(win)).toHaveCount(3)
  expect(await rows(win).evaluateAll((r) => r.map((e) => e.getAttribute('data-version')))).toEqual(['99.0.0', '98.0.0', running])
  await expect(rows(win).nth(0).locator('.whats-new__tag')).toHaveText(['Latest'])
  await expect(rows(win).nth(2).locator('.whats-new__tag')).toHaveText(['Your current version'])
  await expect(rows(win).nth(0)).toHaveAttribute('aria-selected', 'true') // `manual`: the update waiting
  await expect(whatsNew(win).locator('.whats-new__release-title')).toHaveText(['Newest Release'])
  await expect(whatsNew(win).locator('.whats-new__body img')).toHaveAttribute('loading', 'lazy')
  await expect(actions(win)).toHaveText(['Later', 'Download'])
  // D9: about 94% of the window.
  const box = await whatsNew(win).boundingBox()
  const [width, height] = await win.evaluate(() => [innerWidth, innerHeight]) // an Electron page has no `viewportSize()`
  expect(box !== null && box.width > Math.min(width * 0.85, 1200) && box.height > height * 0.85).toBe(true) // the width stops at 1280px
  await shoot(win, 'update-02-whats-new')
})

test('step 2b — a row click shows its notes; a picture opens big; Esc closes the lightbox, then the sheet stays (YAZ-2988 D10, D12)', async () => {
  await rows(win).nth(1).click()
  await expect(whatsNew(win).locator('.whats-new__release-title')).toHaveText(['Older Release'])
  await rows(win).nth(0).click()
  await expect(whatsNew(win).locator('.whats-new__release-title')).toHaveText(['Newest Release'])
  await whatsNew(win).locator('.whats-new__body img').click()
  await expect(win.locator('.image-modal-overlay')).toBeVisible()
  await shoot(win, 'update-02b-lightbox')
  await win.keyboard.press('Escape')
  await expect(win.locator('.image-modal-overlay')).toHaveCount(0)
  await expect(whatsNew(win)).toBeVisible()
})

test('step 3 — a link in the notes goes to the browser, never into the app window (S17)', async () => {
  const before = win.url()
  await whatsNew(win).getByRole('link', { name: 'Read more' }).click()
  await expect.poll(opened).toContain('https://example.com/more')
  await expect(whatsNew(win)).toBeVisible()
  expect(win.url()).toBe(before)
})

test('step 4 — "Download" opens the release page and closes the sheet; the pill stays (S13, S19, D3)', async () => {
  await whatsNew(win).getByRole('button', { name: 'Download' }).click()
  await expect(whatsNew(win)).toHaveCount(0)
  await expect.poll(opened).toContain('https://github.com/yaseenarshad/yaseen-docs-app/releases/latest')
  await expect(pill(win)).toHaveText('🎉New update ready')
})

test('step 5 — Help › What\'s New… opens the same sheet; Esc closes it (D8, S19)', async () => {
  await clickMenuItem(app, 'menu.help.whats-new', 'w1')
  await expect(whatsNew(win)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(whatsNew(win)).toHaveCount(0)
})

test('step 6 — the first launch after a swap: the pill says "What\'s new" once, the sheet shows this release, and Check for Updates… says it is the newest (S24, S15, S4)', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await quitApp(app)
  latest = `v${version}` // nothing newer: only the marker makes the pill, and the feed lists this release alone
  await writeFile(path.join(userData, 'updated-to'), version)
  await launch()
  await expect(pill(win)).toHaveText("🎉See what's new")
  await expect(stat(path.join(userData, 'updated-to'))).rejects.toThrow()
  await pill(win).click()
  await expect(whatsNew(win).locator('.whats-new__release-title')).toHaveText(['This Release'])
  await expect(rows(win).locator('.whats-new__tag')).toHaveText(['Latest', 'Your current version']) // up to date: one row, both tags
  await expect(actions(win)).toHaveText(['Close'])
  await shoot(win, 'update-06-whats-new-after-update')
  await actions(win).click() // the one action, Close; the corner × is the sheet's other Close
  await expect(whatsNew(win)).toHaveCount(0)
  await clickMenuItem(app, 'menu.app.check-updates', 'w1')
  await expect(win.locator('.link-notice')).toHaveText(`Yaseen Docs ${version} is the newest version`)
})

test('step 7 — on the Welcome window, which has no sidebar and no pill, Check for Updates… opens the sheet (S6)', async () => {
  await quitApp(app)
  latest = NEWEST
  app = await launchApp({ userData: await mkdtemp(path.join(tmpdir(), 'update-welcome-')) }) // a fresh profile: one Welcome window
  win = await app.firstWindow()
  await expect(win.locator('.welcome__title')).toHaveText('Yaseen Docs')
  await expect(win.locator('.update-pill')).toHaveCount(0)
  await clickMenuItem(app, 'menu.app.check-updates', new URL(win.url()).searchParams.get('win') ?? undefined)
  await expect(whatsNew(win)).toBeVisible()
  await expect(actions(win)).toHaveText(['Later', 'Download'])
  await shoot(win, 'update-07-welcome-whats-new')
})
