/**
 * The slash menu in a bullet and its "Current time" row (YAZ-3550; YAZ-3511 D21, D22; edge cases
 * 70 and 78 on YAZ-3512) in the REAL app: a new bullet, "/time", Enter — the menu Crepe hid in
 * every list item opens there (the patched Crepe, `client/vendor/milkdown-crepe-7.22.1-yaz3550.*`),
 * Current time is its first row, and Enter leaves `h:mmam - ` at the caret of a bullet that is
 * still a bullet. Typing on, autosave writes it to disk as that one bullet's text.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, editorOf, launchApp, layer, nextFrame, seededState, shoot } from './helpers'

const NOTE = 'Slash.md'
const BODY = '* First bullet\n* Second bullet\n'
const TIME = '\\d{1,2}:\\d{2}(am|pm) - '

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const slashMenu = (w: Page) => layer(w).locator('.milkdown-slash-menu[data-show="true"]')
const slashRows = (w: Page) => slashMenu(w).locator('.menu-group li')
const disk = () => readFile(notePath, 'utf8')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'slash-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'slash-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('in a bullet, "/time" + Enter puts the time at the caret and the bullet stays a bullet', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await editorOf(win).locator('p', { hasText: /^First bullet$/ }).click()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  // A new item's node view puts the caret back where it was at mount, one frame later
  // (`@milkdown/components`' list-item restore): wait that frame out, or "/" lands before it.
  const items = editorOf(win).locator('li.list-item .content-dom > p')
  await expect(items).toHaveCount(3)
  await nextFrame(win)
  await win.keyboard.type('/time')
  await expect(items.nth(1)).toHaveText('/time')

  await expect(slashMenu(win)).toBeVisible()
  await expect(slashRows(win).first()).toHaveText('Current time')
  await shoot(win, 'slash-01-time-in-a-bullet')
  await win.keyboard.press('Enter')
  await expect(slashMenu(win)).toHaveCount(0)

  // The new bullet holds the time, and nothing of the "/time" the user typed.
  await expect(items).toHaveCount(3)
  await expect(items.nth(1)).toHaveText(new RegExp(`^${TIME}$`))
  await expect(editorOf(win)).not.toContainText('/time')

  // The caret is after the time: typing on extends that same bullet, and autosave writes it.
  await win.keyboard.type('stand-up')
  await expect(items.nth(1)).toHaveText(new RegExp(`^${TIME}stand-up$`))
  await shoot(win, 'slash-02-time-inserted')
  await expect.poll(disk).toMatch(new RegExp(`^\\* First bullet\\n\\* ${TIME}stand-up\\n\\* Second bullet\\n$`))
})
