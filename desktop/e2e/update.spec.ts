/**
 * THE UPDATE FLOW (YAZ-2976 D3–D8): the pill, the "What's new" window and its buttons, against a fake
 * GitHub feed. `YASEEN_DOCS_UPDATE_FEED` turns the updater on in this unpackaged run (S7); an
 * unpackaged copy cannot replace itself, so a newer release is `manual` (S13): "Update available" and
 * "Download". The download, the checks and the swap of a `ready` update are proved out of sight by
 * `desktop/src/main/updater.codesign.test.ts` and `updater.swap.test.ts`, with the real `hdiutil`,
 * `codesign` and `/bin/sh`.
 *
 * Same harness as its siblings: temp `--user-data-dir`, COPY of the fixture, `update-` step screenshots.
 * `shell.openExternal` is stubbed in main, so "Download" never opens the browser.
 */
// Written for YAZ-2976 without being run: the testing rules of that work forbid a test that opens windows
// on Yasin's screen. Every selector here was read from the source, not observed. Run it once and fix what it finds.
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
/** What `releases/latest` answers; the list is the two releases, newest first. */
let latest = 'v99.0.0'

const release = (tag: string, title: string, body: string) => ({
  tag_name: tag,
  name: title,
  published_at: '2026-10-17T12:00:00Z',
  draft: false,
  prerelease: false,
  body,
  assets: [{ name: `Yaseen.Docs-${tag.slice(1)}-arm64.dmg`, browser_download_url: `${base}/never-downloaded.dmg`, digest: `sha256:${'0'.repeat(64)}` }],
})
const releases = () => [
  release('v99.0.0', 'Newest Release', `The newest notes.\n\n![a picture](${base}/pixel.png)\n\n[Read more](https://example.com/more)`),
  release('v98.0.0', 'Older Release', 'The older notes.'),
]

let userData = ''
let vault = ''
let app: ElectronApplication
let win: Page

const pill = (w: Page) => w.locator('.sidebar__footer .update-pill')
const whatsNew = (w: Page) => w.locator('.whats-new[role="dialog"]')

async function launch(): Promise<void> {
  process.env.YASEEN_DOCS_UPDATE_FEED = `${base}/releases`
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  // "Download" asks main to open the release page: record it instead of opening the browser.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/releases/latest') return void res.end(JSON.stringify(releases().find((r) => r.tag_name === latest) ?? release(latest, latest, '')))
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

test('step 1 — no pill at launch; Check for Updates… finds v99 and the pill says "Update available" (S7, S13, D4)', async () => {
  await expect(win.locator('.sidebar__footer .settings-button')).toBeVisible()
  await expect(pill(win)).toHaveCount(0)
  await clickMenuItem(app, 'menu.app.check-updates', 'w1')
  await expect(pill(win)).toHaveText('Update available')
  await expect(pill(win)).toHaveAttribute('title', 'Yaseen Docs 99.0.0')
  await shoot(win, 'update-01-pill')
})

test('step 2 — the pill opens "What\'s new": the newer releases, newest first, with a lazy picture (S14, S16, D5)', async () => {
  await pill(win).click()
  await expect(whatsNew(win)).toBeVisible()
  await expect(whatsNew(win).locator('.whats-new__release-title')).toHaveText(['Newest Release', 'Older Release'])
  await expect(whatsNew(win).locator('.whats-new__body img')).toHaveAttribute('loading', 'lazy')
  await expect(whatsNew(win).getByRole('button')).toHaveText(['Later', 'Download'])
  await shoot(win, 'update-02-whats-new')
})

test('step 3 — a link in the notes goes to the browser, never into the app window (S17)', async () => {
  const before = win.url()
  await whatsNew(win).getByRole('link', { name: 'Read more' }).click()
  await expect(whatsNew(win)).toBeVisible()
  expect(win.url()).toBe(before)
})

test('step 4 — "Download" opens the release page and closes the window; the pill stays (S13, S19, D3)', async () => {
  await whatsNew(win).getByRole('button', { name: 'Download' }).click()
  await expect(whatsNew(win)).toHaveCount(0)
  const opened = await app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])
  expect(opened).toContain('https://github.com/yaseenarshad/yaseen-docs-app/releases/latest')
  await expect(pill(win)).toHaveText('Update available')
})

test('step 5 — Help › What\'s New… opens the same window; Esc closes it (D8, S19)', async () => {
  await clickMenuItem(app, 'menu.help.whats-new', 'w1')
  await expect(whatsNew(win)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(whatsNew(win)).toHaveCount(0)
})

test('step 6 — the first launch after a swap: the pill says "What\'s new" once, and the marker is gone (S24)', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await quitApp(app)
  latest = `v${version}` // nothing newer: only the marker makes the pill
  await writeFile(path.join(userData, 'updated-to'), version)
  await launch()
  await expect(pill(win)).toHaveText("What's new")
  await expect(stat(path.join(userData, 'updated-to'))).rejects.toThrow()
  await pill(win).click()
  await expect(whatsNew(win).getByRole('button')).toHaveText(['Close'])
  await shoot(win, 'update-06-whats-new-after-update')
  await whatsNew(win).getByRole('button', { name: 'Close' }).click()
  await expect(whatsNew(win)).toHaveCount(0)
})
