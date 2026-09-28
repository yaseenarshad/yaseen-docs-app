/**
 * FOCUS MODE, END TO END (S12 of YAZ-2171 — YAZ-1605 / 1628): right-click a folder → "Focus on
 * folder" narrows the Files lens to that folder alone, the eye ("Exit focus mode") lights in the
 * lens row, and one click on it brings the whole tree back.
 *
 * What only the real app can prove is WHERE the focus lives: it is WINDOW identity since YAZ-1628
 * (`WindowEntry.focusDirs`, next to the lens), written to `yaseendocs.json` through main and
 * restored from it — so quit → relaunch comes back NARROWED, on a tree that is otherwise folded
 * (expansion is session state, YAZ-1642: the focused folder's row is there, its children are not).
 * The Topics lens keeps its own list (`focusTopics`, "Focus on topic"), proven last over a
 * two-page folder-page shape added to the fixture's copy.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `focus-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, readState, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The Topics shape (collapsedLaunch.spec.ts's): Home to hang from, one promoted topic, its one member. */
const TOPIC = 'Atlas.md'
const MEMBER = 'Atlas note.md'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx, TopicsTree.tsx) ----------

const fileRow = (w: Page, label: string) => w.locator('.sidebar__body .tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
const dirRow = (w: Page, label: string) => w.locator('.sidebar__body .tree__row--dir').filter({ hasText: new RegExp(`^${label}$`) })
/** The DEPTH-0 rows of the Files tree — a focus makes the focused folder the ONLY one. */
const topLabels = (w: Page) => w.locator('.sidebar__body ul[role="tree"] > li > .tree__row .tree__label')
/** Every row the Topics tree draws, in document order (topicsDrag.spec.ts's idiom). */
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const topicRow = (w: Page, label: string) => w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const menuItem = (w: Page, label: string) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]').filter({ hasText: new RegExp(`^${label}$`) })
/** Focus Mode's eye: in the lens row, lit ONLY while the active lens is focused (YAZ-1605). */
const eye = (w: Page) => w.locator('.sidebar__lenses .sidebar__focus-off')
const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
const openDirs = (w: Page) => w.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]')

/** Right-click `row` and take the menu's Focus item — the only way in (Sidebar.test.tsx's `focusRow`). */
async function focusVia(row: Locator, label: 'Focus on folder' | 'Focus on topic'): Promise<void> {
  await row.click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'focus-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  // The Topics shape, written into the COPY before the app sees it: Home leads, Atlas is promoted
  // beside it (its only parent is Home), and the note is Atlas's one member.
  await Promise.all([
    writeFile(path.join(vault, 'Home.md'), '---\nfolder_page: true\n---\n\n# Home\n'),
    writeFile(path.join(vault, TOPIC), '---\nfolder_page: true\nfolder_pages: ["[[Home]]"]\n---\n\n# Atlas\n'),
    writeFile(path.join(vault, MEMBER), '---\nfolder_pages: ["[[Atlas]]"]\n---\n\n# Atlas note\n\nfocus-member-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the focus

test('step 1 — "Focus on folder" makes the folder the only top row, opens it, lights the eye and writes `focusDirs` to the window\'s state entry', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(eye(win)).toHaveCount(0) // nothing focused: no eye
  // Focus is a FOLDER verb: a file row's menu has no such item (Sidebar.test.tsx pins blank space too).
  await fileRow(win, 'Ideas').click({ button: 'right' })
  await expect(menuItem(win, 'Cut')).toBeVisible()
  await expect(menuItem(win, 'Focus on folder')).toHaveCount(0)
  await win.keyboard.press('Escape')

  await focusVia(dirRow(win, 'Projects'), 'Focus on folder')
  // The tree narrows to the folder — and OPENS it, so the focus never lands on a closed chevron.
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(fileRow(win, 'Roadmap')).toBeVisible()
  await expect(dirRow(win, 'archive')).toBeVisible()
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await expect(fileRow(win, 'Welcome note')).toHaveCount(0) // the ACTIVE file's row is hidden too
  await expect(eye(win)).toHaveAttribute('aria-label', 'Exit focus mode')
  // Window identity (YAZ-1628): the window's entry, never the vault bucket.
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusDirs).toEqual([path.join(vault, 'Projects')])
  expect((await readState(userData)).folders[vault]).not.toHaveProperty('focusDirs')
  await shoot(win, 'focus-01-folder-focused')
})

// ---------------------------------------------------------------- the relaunch

test('step 2 — the focus survives quit → relaunch: the Files lens comes back narrowed, the folder folded, the eye lit', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await readState(userData)).windows[0]?.focusDirs).toEqual([path.join(vault, 'Projects')])

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await expect(eye(win)).toHaveAttribute('aria-label', 'Exit focus mode')
  // Folded: the focus is durable, the expansion is not (YAZ-1642) — the row, without its children.
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Roadmap')).toHaveCount(0)
  await shoot(win, 'focus-02-restored-folded')
})

// ---------------------------------------------------------------- the eye

test('step 3 — one click on the eye ends the focus: the whole tree is back, the eye is gone, `focusDirs` is empty', async () => {
  await eye(win).click()
  await expect(eye(win)).toHaveCount(0)
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(fileRow(win, 'Welcome note')).toBeVisible()
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(topLabels(win)).toHaveCount(6) // Projects + Atlas, Atlas note, Home, Ideas, Welcome note
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusDirs).toEqual([])
  await shoot(win, 'focus-03-exited')
})

// ---------------------------------------------------------------- the Topics lens

test('step 4 — "Focus on topic" narrows the Topics lens to the topic and its members, on its OWN list (`focusTopics`)', async () => {
  await lensTab(win, 'Topics').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Atlas', 'Uncategorized'])
  await expect(eye(win)).toHaveCount(0) // the Files focus ended in step 3; Topics has none of its own yet

  await focusVia(topicRow(win, 'Atlas'), 'Focus on topic')
  // The focused topic IS the root, opened, with its one member — Home and Uncategorized hidden.
  await expect(topicLabels(win)).toHaveText(['Atlas', 'Atlas note'])
  await expect(eye(win)).toHaveAttribute('aria-label', 'Exit focus mode')
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusTopics).toEqual([path.join(vault, TOPIC)])
  expect((await readState(userData)).windows[0]?.focusDirs).toEqual([]) // the Files list untouched
  await shoot(win, 'focus-04-topic-focused')

  // Exit: the full topic tree again — Atlas still open, because the focus opened it and ending
  // a focus folds nothing.
  await eye(win).click()
  await expect(eye(win)).toHaveCount(0)
  await expect(topicLabels(win)).toHaveText(['Home', 'Atlas', 'Atlas note', 'Uncategorized'])
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusTopics).toEqual([])
  await shoot(win, 'focus-05-topic-exited')
  await quitApp(app)
})
