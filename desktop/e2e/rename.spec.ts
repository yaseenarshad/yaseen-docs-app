/**
 * Links E1 (GRO-2194): in-app rename with automatic link updates, against the REAL app —
 * the sidebar context menu's "Rename" → inline input → Enter. The renamed file moves on
 * disk, every referencing note is rewritten (bare, aliased and embed forms, alias
 * preserved), the open tab follows in place (label + window title), the summary notice
 * shows, and clicking the rewritten link navigates to the renamed file. A rename onto an
 * existing name is DECLINED with a passive notice — never-overwrite, never a dialog.
 * Same harness as links.spec.ts (temp `--user-data-dir`, COPY of a generated fixture
 * vault, `rename-` step screenshots); serial by design — each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  copyVault,
  launchApp,
  quitApp,
  seededState,
  shoot,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** Seeded on top of the fixture vault: A references B three ways; C blocks a rename onto it. */
const A_BODY = 'a-hub-body'
const B_BODY = 'b-note-body'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

/** Right-click `label`'s row and drive the context menu's Rename into the inline input. */
async function startRename(w: Page, label: string): Promise<void> {
  await fileRow(w, label).click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(w.locator('.create-inline__input')).toHaveValue(label)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'rename-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(path.join(vault, 'A.md'), `# A\n\n${A_BODY}\n\nSee [[B]] and [[B|Bee]] here.\n\n![[B]]\n`),
    writeFile(path.join(vault, 'B.md'), `# B\n\n${B_BODY}\n`),
    writeFile(path.join(vault, 'C.md'), '# C\n\nc-note-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('step 1 — rename B via the context menu: disk file renamed, tab and title follow, summary notice shows', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'B.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect(tabsOf(win)).toHaveText(['B'])

  await startRename(win, 'B')
  await shoot(win, 'rename-01-inline-input')
  await win.locator('.create-inline__input').fill('B2')
  await win.keyboard.press('Enter')

  // Disk: the file moved, content intact; nothing remains at the old path.
  await expect.poll(() => readFile(path.join(vault, 'B2.md'), 'utf8')).toContain(B_BODY)
  await expect(readFile(path.join(vault, 'B.md'), 'utf8')).rejects.toThrow()
  // The open tab follows IN PLACE — label, editor content and the window title.
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect.poll(() => win.title()).toContain('B2')
  // ONE passive summary notice: exactly one referencing note was rewritten.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await shoot(win, 'rename-02-renamed')
})

test('step 2 — A was rewritten on disk: bare, aliased and embed forms, alias preserved', async () => {
  const a = await readFile(path.join(vault, 'A.md'), 'utf8')
  expect(a).toContain('See [[B2]] and [[B2|Bee]] here.')
  expect(a).toContain('![[B2]]')
  expect(a).not.toContain('[[B]]')
})

test('step 3 — clicking the rewritten link in A navigates to the renamed B2', async () => {
  await fileRow(win, 'A').click()
  await expect(editorOf(win)).toContainText(A_BODY)
  // The rewritten link renders collapsed (and resolved) once the index catches up.
  const link = editorOf(win).locator('.wikilink', { hasText: 'B2' }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await shoot(win, 'rename-03-link-navigates')
})

test('step 4 — renaming onto an existing name is DECLINED with a passive notice; nothing moves', async () => {
  await startRename(win, 'A')
  await win.locator('.create-inline__input').fill('C')
  await win.keyboard.press('Enter')
  await expect(win.locator('.link-notice')).toHaveText('Can\'t rename: "C.md" already exists')
  // Both files untouched; the row is still A.
  expect(await readFile(path.join(vault, 'A.md'), 'utf8')).toContain(A_BODY)
  expect(await readFile(path.join(vault, 'C.md'), 'utf8')).toContain('c-note-body')
  await expect(fileRow(win, 'A')).toBeVisible()
  await shoot(win, 'rename-04-decline-notice')
  await quitApp(app)
})
