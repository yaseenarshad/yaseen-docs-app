/**
 * The `app://` origin (index.ts `registerSchemesAsPrivileged`: standard + secure + supportFetchAPI)
 * checked from INSIDE the real window, where the renderer actually lives: a secure context, a
 * working `crypto.subtle`, `fetch` on its own origin, a vault image served through `app://vault/`
 * — and not one request leaving `app:`, `data:` or `blob:`.
 *
 * Only the real app can say this: the privileges are granted by main before `ready`, and a unit
 * test can only read the call, never what Chromium made of it. A size or launch refactor that
 * moves the registration (a V8 code cache, a new scheme) must keep every line below true.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, editorOf, launchApp, seededState, shoot } from './helpers'
import { SMALL_WIDTH, smallPng } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Secure.md'
const ALLOWED = /^(app|data|blob):/

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
const requested: string[] = []

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'secure-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'secure-vault-'))
  await mkdir(path.join(vault, 'images'))
  await writeFile(path.join(vault, 'images', 'a.png'), smallPng(7))
  await writeFile(path.join(vault, NOTE), '# Secure\n\nsecure-body\n\n![a](images/a.png)\n')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the window is a secure `app://yaseen` context with working crypto.subtle and same-origin fetch', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  app.context().on('request', (request) => requested.push(request.url()))
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('secure-body')

  const facts = await win.evaluate(async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('yaseen'))
    const page = await fetch(new URL('index.html', location.href).href)
    return {
      secure: isSecureContext,
      protocol: location.protocol,
      host: location.host,
      digest: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
      fetchOk: page.ok,
    }
  })
  expect(facts).toMatchObject({ secure: true, protocol: 'app:', host: 'yaseen', fetchOk: true })
  expect(facts.digest).toBe(createHash('sha256').update('yaseen').digest('hex'))
})

test('step 2 — a vault image loads through `app://vault/`, and nothing the window loaded left app:, data: or blob:', async () => {
  const img = win.locator('.image-view--ready img[alt="a"]')
  await expect(img).toHaveAttribute('src', /^app:\/\/vault\//)
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(SMALL_WIDTH)
  await shoot(win, 'secure-01-vault-image')

  // Everything the page fetched since it began (the resource timeline covers the load before the
  // listener above was attached), plus every request Playwright saw afterwards.
  const loaded = await win.evaluate(() => [location.href, ...performance.getEntriesByType('resource').map((e) => e.name)])
  const all = [...loaded, ...requested]
  expect(all.length).toBeGreaterThan(1)
  expect(all.filter((url) => !ALLOWED.test(url))).toEqual([])
})
