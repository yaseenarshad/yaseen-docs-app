/**
 * The FILE clipboard against the REAL app (S7, YAZ-1674 — e2e coverage under YAZ-2171): Cut /
 * Copy / Paste of vault files through ONE app-wide clipboard that lives in main.
 *
 * WHAT IT PROVES, and why only the real app can: the clipboard is `desktop/src/main/fileClip.ts`
 * — one object in the main process, pushed to every window as `clip:changed` — so a Copy made in
 * window A on vault A must label and land a Paste in window B on vault B (🔒 D1). Unit tests prove
 * the clipboard, the menu data and `fs/copy.ts` each in isolation; only two live windows on two
 * vaults prove that the push, the label ("Paste 1 item" in a window that never copied anything),
 * the `fs.cp` under Finder's free name (`Ideas.md` → `Ideas copy.md` → `Ideas copy 2.md`, 🔒 D3)
 * and the cut's ride through the rename pipeline (source gone, bytes identical, clipboard cleared
 * after the one paste, 🔒 D2) all happen together, with the real watcher echoing the tree.
 *
 * Gestures: the sidebar row context menu (the app's own `.ctx-menu`, never the OS one) for Cut /
 * Copy / Paste, and the renderer-owned ⌘V window chord (D6) for the repeat pastes — a plain click
 * on a folder row SELECTS it (D9), and ⌘V pastes INTO the first selected folder.
 *
 * Same harness as scenarios.spec.ts: temp `--user-data-dir`, TWO copies of a generated fixture
 * vault seeded as two windows (`multiWindowState`), `fileClipboard-` screenshots; serial by design.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, dirRow, fileRow, launchApp, md5, multiWindowState, quitApp, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The file step 3 CUTS out of vault A; its bytes are pinned before the move. */
const MOVER = 'Mover.md'
const MOVER_BODY = 'fileclip-mover-body'

let userData: string
let vaultSrc: string
let vaultA: string
let vaultB: string
let moverMd5: string
let app: ElectronApplication
let winA: Page
let winB: Page

const rowAt = (w: Page, file: string) => w.locator(`.tree__row--file[data-path="${file}"]`)
const menu = (w: Page) => w.locator('.ctx-menu')
/** An item by its label; the accessible name also carries the ⌘ hint (`Paste ⌘V`), so it is matched as an optional tail. */
const menuItem = (w: Page, label: string) => menu(w).getByRole('menuitem', { name: new RegExp(`^${label}(?: ⌘\\S*)?$`) })
/** App's one passive notice (`.link-notice`, YAZ-1341): every clipboard verb confirms through it. */
const notice = (w: Page) => w.locator('.link-notice')

const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'fileclip-userdata-'))
  vaultSrc = await buildFixtureVault()
  vaultA = await copyVault(vaultSrc)
  vaultB = await copyVault(vaultSrc)
  await writeFile(path.join(vaultA, MOVER), `# Mover\n\n${MOVER_BODY}\n`)
  moverMd5 = await md5(path.join(vaultA, MOVER))
})

test.afterAll(async () => {
  if (app !== undefined) await quitApp(app).catch(() => undefined)
  await Promise.all([userData, vaultSrc, vaultA, vaultB].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Copy in window A (vault A) pastes into a folder of window B (vault B): one clipboard', async () => {
  // No file open in either window on purpose: focus never lands in an editor, so the window
  // chords of step 2 are unambiguously the FILE clipboard's (`ownsWindowChord`).
  app = await launchApp({
    userData,
    seedState: multiWindowState(
      [
        { id: 'wa', root: vaultA, file: null },
        { id: 'wb', root: vaultB, file: null },
      ],
      [vaultA, vaultB],
    ),
  })
  winA = await appWindow(app, 'wa')
  winB = await appWindow(app, 'wb')
  await expect(fileRow(winA, 'Ideas')).toBeVisible()
  await expect(dirRow(winB, 'Projects')).toBeVisible()

  // Before anything is clipped, a folder row's menu shows Paste DISABLED — discoverable, inert (🔒 D5).
  await dirRow(winB, 'Projects').click({ button: 'right' })
  await expect(menu(winB)).toBeVisible()
  await expect(menuItem(winB, 'Paste')).toBeDisabled()
  await winB.keyboard.press('Escape')
  await expect(menu(winB)).toHaveCount(0)

  // Window A: Copy the Ideas row. Nothing on disk moves — the notice is the only visible effect.
  await fileRow(winA, 'Ideas').click({ button: 'right' })
  await expect(menu(winA)).toBeVisible()
  await expect(menuItem(winA, 'Cut')).toBeVisible()
  await menuItem(winA, 'Copy').click()
  await expect(menu(winA)).toHaveCount(0)
  await expect(notice(winA)).toContainText('Copied 1 item')
  await shoot(winA, 'fileClipboard-01a-copied-in-a')

  // Window B, on ANOTHER vault: the folder menu already counts the other window's clip.
  await dirRow(winB, 'Projects').click({ button: 'right' })
  await expect(menuItem(winB, 'Paste 1 item')).toBeVisible()
  await shoot(winB, 'fileClipboard-01b-paste-label-in-b')
  await menuItem(winB, 'Paste 1 item').click()
  await expect(notice(winB)).toContainText('Pasted 1 item')

  const pasted = path.join(vaultB, 'Projects', 'Ideas.md')
  await expect.poll(() => exists(pasted)).toBe(true)
  expect(await md5(pasted)).toBe(await md5(path.join(vaultA, 'Ideas.md')))
  expect(await exists(path.join(vaultA, 'Ideas.md'))).toBe(true) // a copy leaves the source alone
  // The paste opens its target folder and refreshes the tree: the new row is on screen.
  await expect(rowAt(winB, pasted)).toBeVisible()
  await shoot(winB, 'fileClipboard-01c-pasted-in-b')
})

test('step 2 — ⌘V pastes into the SELECTED folder, again and again, under Finder\'s free names', async () => {
  // A plain click on the folder row selects it (D9; it also toggles the folder, which is fine —
  // the paste re-opens its target). ⌘V then targets THAT folder (`pasteTargetDir`).
  await dirRow(winB, 'Projects').click()
  await expect(dirRow(winB, 'Projects')).toHaveClass(/tree__row--selected/)

  // A copy pastes as often as you like (🔒 D2), and a clash takes the next free name (🔒 D3).
  const copy1 = path.join(vaultB, 'Projects', 'Ideas copy.md')
  await winB.keyboard.press('Meta+v')
  await expect.poll(() => exists(copy1)).toBe(true)
  await expect(rowAt(winB, copy1)).toBeVisible()

  const copy2 = path.join(vaultB, 'Projects', 'Ideas copy 2.md')
  await winB.keyboard.press('Meta+v')
  await expect.poll(() => exists(copy2)).toBe(true)
  await expect(rowAt(winB, copy2)).toBeVisible()

  const source = await md5(path.join(vaultA, 'Ideas.md'))
  expect(await md5(copy1)).toBe(source)
  expect(await md5(copy2)).toBe(source)
  await shoot(winB, 'fileClipboard-02-copy-copy2')
})

test('step 3 — Cut in A, Paste in B MOVES the file: source gone, bytes identical, clipboard spent', async () => {
  await fileRow(winA, 'Mover').click({ button: 'right' })
  await menuItem(winA, 'Cut').click()
  await expect(notice(winA)).toContainText('Cut 1 item')
  // Cut touches nothing on disk until the paste (🔒 D2): the file is still exactly where it was.
  expect(await exists(path.join(vaultA, MOVER))).toBe(true)

  await dirRow(winB, 'Projects').click({ button: 'right' })
  await menuItem(winB, 'Paste 1 item').click()
  await expect(notice(winB)).toContainText('Pasted 1 item')

  const moved = path.join(vaultB, 'Projects', MOVER)
  await expect.poll(() => exists(moved)).toBe(true)
  await expect.poll(() => exists(path.join(vaultA, MOVER))).toBe(false)
  expect(await md5(moved)).toBe(moverMd5)
  // Both trees follow: B shows the row, A's watcher took it away.
  await expect(rowAt(winB, moved)).toBeVisible()
  await expect(fileRow(winA, 'Mover')).toHaveCount(0)
  await shoot(winB, 'fileClipboard-03a-moved-into-b')
  await shoot(winA, 'fileClipboard-03b-gone-from-a')

  // A cut pastes ONCE: the clipboard cleared, so Paste is back to its disabled, bare label.
  await dirRow(winB, 'Projects').click({ button: 'right' })
  await expect(menuItem(winB, 'Paste')).toBeDisabled()
  await expect(menu(winB).getByRole('menuitem', { name: /^Paste \d/ })).toHaveCount(0)
  await winB.keyboard.press('Escape')
  await expect(menu(winB)).toHaveCount(0)
})
