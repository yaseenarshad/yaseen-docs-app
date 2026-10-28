/**
 * FOLDER ICONS, END TO END (YAZ-3554 D1, D3, D4, D5): with the Material set, Settings › Sidebar › Folders ›
 * "Folder icons" is Plain (the default), By name or Off. Plain gives every folder Material's default folder, so
 * `src` and `docs` look like any other folder; a folder with its own pick keeps it (D4). By name gives each its
 * folder-name icon, as before; Off draws none. This spec checks the tree; the tabs, search and Recents use the same
 * rule (`rowIcon`, D1), which `FileIcon.test.tsx` covers.
 *
 * The unit tests pin the rule (`rowIcons.test.ts`) and the CSS (`fileIconsCss.test.ts`); only the real app shows
 * the setting reaching the tree and the tab bar through the store and the IPC. The clicks are Playwright's, sent to
 * the page: in the hidden run (`YASEEN_DOCS_E2E_HIDDEN=1`, the default) no window shows.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `folderIcons-` step
 * screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, dirRow, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The icon id a folder row draws, or null with no icon: the label's `::before` is drawn (has `content`) only when one shows. */
const folderIcon = (name: string) =>
  dirRow(win, name).evaluate((row) => {
    const before = getComputedStyle(row.querySelector('.tree__label')!, '::before')
    return before.content === 'none' || before.content === 'normal' ? null : row.getAttribute('data-icon')
  })

async function choose(label: 'Plain' | 'By name' | 'Off'): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.locator('.settings-dialog .settings-nav__item', { hasText: /^Sidebar$/ }).click()
  await win.locator('.settings-dialog [data-setting="sidebarFolderIcons"] button', { hasText: new RegExp(`^${label}$`) }).click()
  await win.keyboard.press('Escape')
  await expect(win.locator('.settings-dialog')).toHaveCount(0)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3554-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz3554-vault-'))
  for (const dir of ['src', 'docs', 'recipes', 'trips']) await mkdir(path.join(vault, dir))
  await writeFile(path.join(vault, 'Intro.md'), '# Intro\n')
  // D4: the user's own pick for one folder (YAZ-3440 D8), in the vault's icons file.
  await mkdir(path.join(vault, '.yaseendocs'))
  await writeFile(path.join(vault, '.yaseendocs', 'icons.json'), JSON.stringify({ version: 1, paths: { trips: 'folder-images' } }))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — by default (Plain, D5) every folder has the default folder; a folder with its own pick keeps it (D4)', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Intro.md')) })
  win = await appWindow(app, 'w1')
  await expect(dirRow(win, 'src')).toHaveCount(1)
  await expect.poll(() => folderIcon('trips')).toBe('folder-images')
  for (const name of ['src', 'docs', 'recipes']) expect(await folderIcon(name)).toBe('folder')
  await shoot(win, 'folderIcons-1-plain')
})

test('step 2 — "By name" gives each named folder its own icon (D3)', async () => {
  await choose('By name')
  await expect.poll(() => folderIcon('src')).toBe('folder-src')
  expect(await folderIcon('docs')).toBe('folder-docs')
  expect(await folderIcon('recipes')).toBe('folder')
  expect(await folderIcon('trips')).toBe('folder-images')
  await shoot(win, 'folderIcons-2-by-name')
})

test('step 3 — "Off" draws no folder icon; "Plain" again brings the default folder back (D3)', async () => {
  await choose('Off')
  await expect.poll(() => folderIcon('src')).toBeNull()
  expect(await folderIcon('trips')).toBeNull()
  await choose('Plain')
  await expect.poll(() => folderIcon('src')).toBe('folder')
  expect(await folderIcon('trips')).toBe('folder-images')
  await shoot(win, 'folderIcons-3-plain-again')
})
