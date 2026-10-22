/**
 * Read only, in the REAL app (YAZ-3076): the human's switch, stored IN the file.
 *  - ON from the page cog's first row, at once, with no question: the file gets `readonly: true`
 *    and a "Read only" chip with a lock shows beside the cog.
 *  - TYPING CHANGES NOTHING while it is on: the note on disk keeps its bytes after the autosave's
 *    time has passed.
 *  - OFF only through the chip: a click opens "Allow edits?", and "Allow edits" removes the key —
 *    the file is its own bytes again — and the chip goes.
 *  - THEN TYPING SAVES as before.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault with one
 * note of this spec's own in it, hidden windows (`YASEEN_DOCS_E2E_HIDDEN`), `read-only-` step
 * screenshots. Serial: each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, editorOf, launchApp, layer, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Locked note.md'
const LINE = 'read-only-line-e2e'
const BODY = `---\nstatus: draft\n---\n# Locked\n\n${LINE}\n`
const LOCKED = `---\nstatus: draft\nreadonly: true\n---\n# Locked\n\n${LINE}\n`

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
const readOnlyRow = (w: Page) => menu(w).locator('button[aria-pressed]', { hasText: 'Read only' })
const chip = (w: Page) => layer(w).locator('.read-only-chip__button')
const askBox = (w: Page) => layer(w).locator('.read-only-chip__ask')
const line = (w: Page) => editorOf(w).locator(`p:text-is("${LINE}")`)
const onDisk = (): Promise<string> => readFile(notePath, 'utf8')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'readonly-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the note opens editable: no chip, and "Read only" is the cog’s first row, off', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(line(win)).toBeVisible()
  await expect(chip(win)).toHaveCount(0)
  await cog(win).click()
  await expect(menu(win).locator('button').first()).toHaveText('Read only')
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'false')
})

test('step 2 — the row turns it on at once: the key is in the file, the chip shows, nothing asked', async () => {
  await readOnlyRow(win).click()
  await expect.poll(onDisk).toBe(LOCKED)
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'true')
  await expect(askBox(win)).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  await expect(chip(win)).toHaveText('Read only')
  await expect(chip(win)).toHaveAttribute('title', 'Click to allow edits')
  await expect(editorOf(win)).toHaveAttribute('contenteditable', 'false')
  await shoot(win, 'read-only-1-on')
})

test('step 3 — typing changes nothing: the file keeps its bytes past the autosave', async () => {
  await line(win).click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type(' typed-while-locked', { delay: 5 })
  await win.waitForTimeout(1500)
  expect(await onDisk()).toBe(LOCKED)
  await expect(line(win)).toBeVisible()
  await expect(layer(win).locator('.conflict-bar')).toHaveCount(0)
})

test('step 4 — the chip asks "Allow edits?"; "Allow edits" removes the key and the chip', async () => {
  await chip(win).click()
  await expect(askBox(win)).toContainText('Allow edits?')
  await expect(askBox(win).getByRole('button', { name: 'Allow edits' })).toBeFocused()
  await shoot(win, 'read-only-2-ask')
  await win.keyboard.press('Enter')
  await expect.poll(onDisk).toBe(BODY)
  await expect(chip(win)).toHaveCount(0)
  await expect(editorOf(win)).toHaveAttribute('contenteditable', 'true')
})

test('step 5 — typing saves again', async () => {
  await line(win).click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type(' typed-after-allow', { delay: 5 })
  await expect.poll(onDisk).toContain(`${LINE} typed-after-allow`)
  expect(await onDisk()).not.toContain('readonly')
  await quitApp(app)
})
