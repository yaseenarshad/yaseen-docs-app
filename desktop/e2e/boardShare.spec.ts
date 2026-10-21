/**
 * Share links (YAZ-3040 under YAZ-3028; Draw's `e2e/share.spec.ts`, YAZ-3044 A21) end-to-end against the
 * REAL app and `tools/fakeCloudflare.mjs`: a local stand-in for the Cloudflare API that runs the REAL
 * share Worker on 127.0.0.1. No request leaves the Mac. The app honours the two endpoint overrides
 * (`YASEEN_DOCS_CLOUDFLARE_API`, `YASEEN_DOCS_SHARE_ORIGIN`) only unpackaged, which is how this suite
 * runs it. Hidden-safe: no step asks for window focus.
 *
 *   1 before setup, a board's Share says so, and its button opens Settings › Sharing on "Not set up".
 *   2 setup with the fake account's good key walks to "Sharing ready"; the key goes to `secrets.json`,
 *     never to the state file.
 *   3 right-click › Share › Anyone with the link: the link serves the board's scene and its download,
 *     the tree marks the row; View only refuses the download; Not shared takes the link down.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, menuItem, quitApp, REPO_ROOT, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const BOARD = 'Plan.excalidraw'
const SCENE = `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, index: 'a0', roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false }], appState: {}, files: {} }, null, 2)}\n`

let vaultSrc: string
let vault: string
let userData: string
let fakeData: string
let fake: ChildProcess | null = null
let origin: string
let app: ElectronApplication | null = null
let win: Page

const shareDialog = (w: Page) => w.getByTestId('share-dialog')
const settings = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
/** The board's share record, read through the renderer's own bridge door (`share:get`). */
const shareOf = (w: Page) =>
  w.evaluate((req) => (window as unknown as { yaseenDocs: { share: { get: (r: object) => Promise<{ id: string; url: string } | null> } } }).yaseenDocs.share.get(req), { root: vault, path: path.join(vault, BOARD) })

async function openShare(w: Page): Promise<void> {
  await fileRow(w, BOARD).click({ button: 'right' })
  await menuItem(w, 'Share').click()
  await expect(shareDialog(w)).toBeVisible()
}

test.beforeAll(async () => {
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, BOARD), SCENE)
  userData = await mkdtemp(path.join(tmpdir(), 'yaz-3044-share-'))
  fakeData = await mkdtemp(path.join(tmpdir(), 'yaz-3044-fake-cloudflare-'))
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'fakeCloudflare.mjs'), '--data', fakeData, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] })
  fake = child
  const port = await new Promise<string>((resolve, reject) => {
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
      if (m) resolve(m[1])
    })
    child.once('exit', (code) => reject(new Error(`fakeCloudflare exited ${code}: ${out}`)))
  })
  origin = `http://127.0.0.1:${port}`
})

test.afterAll(async () => {
  if (app !== null) await quitApp(app)
  fake?.kill()
  await Promise.all([vaultSrc, vault, userData, fakeData].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — before setup, Share says so and sends you to Settings › Sharing', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null), env: { YASEEN_DOCS_CLOUDFLARE_API: `${origin}/client/v4`, YASEEN_DOCS_SHARE_ORIGIN: origin } })
  win = await appWindow(app, 'w1')
  await openShare(win)
  await expect(shareDialog(win)).toContainText("Sharing isn't set up")
  await shareDialog(win).getByTestId('share-setup').click()
  await expect(settings(win).getByTestId('sharing-status')).toContainText('Not set up')
  await shoot(win, 'board-share-01-not-set-up')
})

test('step 2 — setup with the fake account walks to "Sharing ready"; the key is a secret', async () => {
  await settings(win).getByRole('textbox', { name: 'Cloudflare API key' }).fill('demo-good')
  await settings(win).getByTestId('sharing-setup').click()
  await expect(settings(win).getByTestId('sharing-status')).toContainText('Sharing ready', { timeout: 30_000 })
  for (const step of ['verify', 'account', 'bucket', 'viewer', 'worker', 'subdomain', 'test']) {
    await expect(settings(win).getByTestId('sharing-steps').locator(`[data-step="${step}"]`)).toHaveAttribute('data-state', 'done')
  }
  await shoot(win, 'board-share-02-ready')
  await settings(win).getByRole('button', { name: 'Close settings' }).click()
  await expect(settings(win)).toHaveCount(0)
  expect(await readFile(path.join(userData, 'secrets.json'), 'utf8')).toContain('demo-good')
  expect(await readFile(path.join(userData, 'yaseendocs.json'), 'utf8')).not.toContain('demo-good')
})

test('step 3 — a shared board serves its scene; View only blocks the download; Not shared takes the link down', async () => {
  await openShare(win)
  await shareDialog(win).getByTestId('share-access').click()
  await win.getByRole('menuitemradio', { name: 'Anyone with the link' }).click()
  await expect(shareDialog(win).getByTestId('share-live')).toContainText('Up to date', { timeout: 30_000 })
  const entry = await shareOf(win)
  const id = entry?.id ?? ''
  expect(entry?.url).toBe(`${origin}/b/${id}`)
  await expect(fileRow(win, BOARD).locator('.tree__share')).toBeVisible()
  expect((await fetch(`${origin}/b/${id}`)).status).toBe(200)
  const shared = (await (await fetch(`${origin}/scene/${id}`)).json()) as { elements: { id: string }[] }
  expect(shared.elements.map((el) => el.id)).toEqual(['a'])
  expect((await fetch(`${origin}/raw/${id}`)).status).toBe(200)
  await shoot(win, 'board-share-03-shared')

  await shareDialog(win).getByTestId('share-permission').click()
  await win.getByRole('menuitemradio', { name: 'View only' }).click()
  await expect.poll(async () => (await fetch(`${origin}/raw/${id}`)).status).toBe(403)

  await shareDialog(win).getByTestId('share-access').click()
  await win.getByRole('menuitemradio', { name: 'Not shared' }).click()
  await expect.poll(async () => (await fetch(`${origin}/b/${id}`)).status).toBe(404)
  await expect.poll(() => shareOf(win)).toBeNull()
  await expect(fileRow(win, BOARD).locator('.tree__share')).toHaveCount(0)
})
