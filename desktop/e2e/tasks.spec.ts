/**
 * Task cycling (GRO-2027, `editor/outline/hotkeys.ts`): ⌘Enter turns the list item under the caret
 * bullet → `[ ]` → `[x]` → bullet, the Obsidian toggle-list way — in the REAL app, where the key
 * reaches Crepe's keymap through a live window and autosave writes the result to disk.
 *
 * What it proves: each press changes the item's box (Crepe's `.label` class), the file on disk
 * follows as plain `* [ ]` / `* [x]` / `* ` markdown, and only the item whose own line holds the
 * caret cycles — a parent above it stays as it is.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Tasks.md'
const BODY = '* Buy milk\n* Call Sam\n  * nested child\n'

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
/** The item whose OWN line reads `text`, and its box (`bullet` / `unchecked` / `checked`). */
const item = (w: Page, text: string) => editorOf(w).locator(`li.list-item:has(> .children > .content-dom > p:text-is("${text}"))`)
const box = (w: Page, text: string) => item(w, text).locator('> .label-wrapper > .label')
const disk = () => readFile(notePath, 'utf8')

/** ⌘Enter with the caret in `text`'s line, retried until the box shows `next` (a key can drop mid-render). */
async function cycleTo(w: Page, text: string, next: 'bullet' | 'unchecked' | 'checked'): Promise<void> {
  await expect(async () => {
    if (!(await box(w, text).getAttribute('class'))?.split(' ').includes(next)) {
      await editorOf(w).locator('p', { hasText: new RegExp(`^${text}$`) }).click()
      await w.keyboard.press('Meta+Enter')
    }
    await expect(box(w, text)).toHaveClass(new RegExp(`\\b${next}\\b`), { timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'tasks-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'tasks-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — ⌘Enter cycles a bullet → [ ] → [x] → bullet, and the file follows each time', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(box(win, 'Buy milk')).toHaveClass(/\bbullet\b/)

  await cycleTo(win, 'Buy milk', 'unchecked')
  await expect.poll(disk).toMatch(/^\* \[ \] Buy milk$/m)
  await shoot(win, 'tasks-01-unchecked')

  await cycleTo(win, 'Buy milk', 'checked')
  await expect.poll(disk).toMatch(/^\* \[x\] Buy milk$/m)
  await shoot(win, 'tasks-02-checked')

  await cycleTo(win, 'Buy milk', 'bullet')
  await expect.poll(disk).toMatch(/^\* Buy milk$/m)
})

test('step 2 — only the caret\'s own item cycles: a nested child becomes a task, its parent stays a bullet', async () => {
  await cycleTo(win, 'nested child', 'unchecked')
  await expect.poll(disk).toMatch(/^\s+\* \[ \] nested child$/m)
  expect(await disk()).toMatch(/^\* Call Sam$/m)
  await expect(box(win, 'Call Sam')).toHaveClass(/\bbullet\b/)
  await shoot(win, 'tasks-03-nested-only')
})
