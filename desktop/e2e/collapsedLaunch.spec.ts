/**
 * COLLAPSED ON RELAUNCH (YAZ-1642, proven here for YAZ-1647): a launch remembers nothing about
 * the sidebar's tree. The open list (`folders[root].expanded`) is
 * session state — held in main's memory, shared by every window on the root, stripped by `toDisk`
 * before every write — and the Sidebar no longer unfolds the ancestors of the file it mounts with.
 *
 * The seed is therefore a state file that STILL holds the list, as a pre-1642 app left it: the
 * claim is not "the app did not write it" but "the app does not read it either".
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `collapsed-`
 * step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, clickMenuItem, closeWindow, dirRow, editorOf, expandDirs, extraWindow, fileRow, launchApp, quitApp, readState, seededState, shoot, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The active file: THREE folders down, so nothing but a real gesture can put its row on screen. */
const DEEP = path.join('Projects', 'alpha', 'beta', 'Deep note.md')
const DEEP_BODY = 'collapsed-deep-body'
/** The dirs the seed claims are open — the whole chain to the active file, plus a sibling. */
const SEEDED_DIRS = [path.join('Projects', 'alpha', 'beta'), path.join('Projects', 'alpha'), 'Projects', 'Reference']
/** The two the test opens BY HAND, outermost first — `beta` is deliberately left folded below them. */
const OPEN_BY_HAND = ['Projects', path.join('Projects', 'alpha')]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the suite's own) ----------

/** Every dir the tree currently draws OPEN — the one number this whole file is about. */
const openDirs = (w: Page) => w.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]')

/** A small vault three folders deep. */
async function buildVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yaz1642-vault-'))
  await mkdir(path.join(root, 'Projects', 'alpha', 'beta'), { recursive: true })
  await mkdir(path.join(root, 'Reference'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'Loose note.md'), '# Loose note\n\ncollapsed-loose-body\n'),
    writeFile(path.join(root, 'Projects', 'Charter.md'), '# Charter\n\ncollapsed-charter-body\n'),
    writeFile(path.join(root, 'Projects', 'alpha', 'Alpha brief.md'), '# Alpha brief\n\ncollapsed-alpha-body\n'),
    writeFile(path.join(root, DEEP), `# Deep note\n\n${DEEP_BODY}\n`),
    writeFile(path.join(root, 'Reference', 'Handbook.md'), '# Handbook\n\ncollapsed-handbook-body\n'),
  ])
  return root
}

/** The pre-YAZ-1642 state file: the list filled in, on a window opened deep in the vault. */
function legacyState(vaultPath: string) {
  const state = seededState(vaultPath, path.join(vaultPath, DEEP))
  state.folders[vaultPath].expanded = SEEDED_DIRS.map((d) => path.join(vaultPath, d))
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz1642-userdata-'))
  vault = await buildVault()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the launch

test('step 1 — a state file full of open dirs launches FOLDED, with the deep tab restored', async () => {
  app = await launchApp({ userData, seedState: legacyState(vault) })
  win = await appWindow(app, 'w1')

  // The tab is the half that DOES restore: the file three folders down is open and reading.
  await expect(activeTab(win)).toHaveText('Deep note')
  await expect(editorOf(win)).toContainText(DEEP_BODY)

  // …and the tree behind it is at its root: two dirs and one file, every dir shut. The seed
  // named four open dirs and the active file's own chain among them; not one of them took.
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(dirRow(win, 'Reference')).toBeVisible()
  await expect(fileRow(win, 'Loose note')).toBeVisible()
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Deep note')).toHaveCount(0) // the ACTIVE file's row is not drawn either
  await expect(fileRow(win, 'Charter')).toHaveCount(0)
  await expect(fileRow(win, 'Handbook')).toHaveCount(0)
  await shoot(win, 'collapsed-01-launch')
})

// ---------------------------------------------------------------- the session list is SHARED

test('step 2 — two dirs opened by hand are open in a second window on the same vault', async () => {
  await expandDirs(win, OPEN_BY_HAND.map((d) => path.join(vault, d)))
  await expect(openDirs(win)).toHaveCount(2)
  await expect(fileRow(win, 'Charter')).toBeVisible()
  await expect(fileRow(win, 'Alpha brief')).toBeVisible()
  await expect(dirRow(win, 'beta')).toBeVisible()
  await expect(fileRow(win, 'Deep note')).toHaveCount(0) // `beta` was left folded on purpose

  // A second window on the same root (⌘⇧N duplicates it) reads the SAME in-memory list — that is
  // what "session, shared by every window on the root" means, and it is only observable here.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  for (const dir of OPEN_BY_HAND) {
    await expect(dup.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${path.join(vault, dir)}"])`)).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  }
  await expect(fileRow(dup, 'Alpha brief')).toBeVisible()
  await shoot(dup, 'collapsed-02-second-window')

  // Back to one window, so the relaunch below restores exactly the one this file follows.
  await closeWindow(app, dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
})

// ---------------------------------------------------------------- the quit, and the next launch

test('step 3 — the quit does not write the list, and the relaunch is folded again with the tab still there', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const flushed = (await readState(userData)).folders[vault]
  // Stripped, not emptied: the key is not in the file at all (desktop/src/main/store.ts `toDisk`).
  expect(flushed).not.toHaveProperty('expanded')
  // …and the rest of the bucket is untouched, which is how we know the strip is surgical.
  expect(flushed.lastFile).toBe(path.join(vault, DEEP))

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(activeTab(win)).toHaveText('Deep note')
  await expect(editorOf(win)).toContainText(DEEP_BODY)
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Deep note')).toHaveCount(0)
  await expect(fileRow(win, 'Alpha brief')).toHaveCount(0) // step 2's two dirs went with the session
  await shoot(win, 'collapsed-03-relaunch')
  await quitApp(app)
})
