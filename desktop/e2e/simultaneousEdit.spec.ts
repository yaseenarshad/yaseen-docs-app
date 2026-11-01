/**
 * You and an agent edit one note at once (YAZ-3704): the REAL built app, the one user flow.
 * Type in one line → before the 500 ms autosave, an "agent" writes a change to ANOTHER line →
 * no conflict bar, both edits in the editor, the one-line note counts the outside change, and the
 * merged note reaches the disk. Then the agent edits the line being typed in → the conflict bar,
 * and the typing is still there. Serial; screenshots are the evidence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Together.md'
const BODY = `# Shopping

* Call the bank tomorrow
* Send the invoice to Sam
* Book the room
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

/** Puts the caret at the end of the bullet that holds `text`. */
const caretAtEndOf = async (text: string): Promise<void> => {
  await win.locator('.ProseMirror li', { hasText: text }).first().click()
  await win.keyboard.press('End')
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sim-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'sim-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the agent edits another line while you type: both stay, no bar, the note counts it', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText('Call the bank')

  await caretAtEndOf('Call the bank')
  await win.keyboard.type(' and buy milk')
  // Inside the autosave's 500 ms: the typing is still unsaved when the agent writes.
  await writeFile(notePath, BODY.replace('Send the invoice', 'Send the signed invoice'))

  await expect(win.locator('.ProseMirror')).toContainText('Send the signed invoice', { timeout: 15_000 })
  await expect(win.locator('.ProseMirror')).toContainText('Call the bank tomorrow and buy milk')
  await expect(win.locator('.conflict-bar')).toHaveCount(0)
  await expect(win.locator('.outside-changes-bar')).toContainText('1 outside change in this note')
  await expect(win.locator('.ProseMirror .outside-change')).toContainText('signed')

  // The merged note saves.
  await expect.poll(async () => readFile(notePath, 'utf8'), { timeout: 10_000 }).toContain('Call the bank tomorrow and buy milk')
  expect(await readFile(notePath, 'utf8')).toContain('Send the signed invoice')
  await shoot(win, 'sim-01-merged')

  await win.getByRole('button', { name: 'Mark all checked' }).click()
  await expect(win.locator('.outside-changes-bar')).toHaveCount(0)
  await expect(win.locator('.ProseMirror .outside-change')).toHaveCount(0)
})

test('step 2 — the agent edits the line you type in: the conflict bar, and your typing stays', async () => {
  const saved = await readFile(notePath, 'utf8')
  await caretAtEndOf('Book the room')
  await win.keyboard.type(' for ten')
  await writeFile(notePath, saved.replace('Book the room', 'Book the big room'))

  await expect(win.locator('.conflict-bar')).toContainText('File changed on disk.', { timeout: 15_000 })
  await expect(win.locator('.ProseMirror')).toContainText('Book the room for ten')
  await expect(win.locator('.outside-changes-bar')).toHaveCount(0)
  await shoot(win, 'sim-02-conflict')
})
