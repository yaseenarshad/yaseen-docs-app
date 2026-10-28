/**
 * STICKY FOLDER ROWS, END TO END (YAZ-3440 D1, D2, D3; proven for YAZ-3469): in a long open folder, the
 * folder rows above the first visible row stay at the top of the list, one row per level, flush at its top
 * edge. A click on a stuck row's NAME scrolls the list back to that folder and leaves it open (D3, as in
 * VS Code); a click on its ARROW folds it, and the folder stays in view.
 *
 * The CSS contract (`client/src/stickyFoldersCss.test.ts`) pins the rules, and the headless check
 * (`tools/perf/sidebarLinesRecalc.mjs`) proves the stack and the paint order in real Chromium. Only the
 * real app can show the rest: the cap that `stickyFolders.ts` writes on the real list, and React's own
 * click handler on the stuck row.
 *
 * The list is scrolled through `scrollTop`, as a wheel would leave it. The clicks are Playwright's, sent
 * to the page: in the hidden run (`YASEEN_DOCS_E2E_HIDDEN=1`, the default) no window shows, and the Mac's
 * mouse and keyboard are never used.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `sticky-` step
 * screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, dirRow, expandDirs, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The long folder, inside its parent: 120 notes, far more than the list shows. */
const PARENT = 'Parent'
const LONG = path.join(PARENT, 'Long')
const NOTES = 120
const name = (k: number) => `Note ${String(k).padStart(3, '0')}`

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators and probes (client/src/sidebar/Tree.tsx) ----------

const itemOf = (dir: string) => win.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${path.join(vault, dir)}"])`)

/** The list's top edge, and the row and the li of each folder: screen px, so the sidebar zoom cancels out. */
async function rects(): Promise<{ list: number; listBottom: number; scrollTop: number; parent: { row: number; height: number; item: number }; long: { row: number; height: number; item: number } }> {
  return win.evaluate(
    ([parent, long]) => {
      const body = document.querySelector('.sidebar__body') as HTMLElement
      const of = (p: string) => {
        const row = document.querySelector(`.tree__row--dir[data-path="${CSS.escape(p)}"]`) as HTMLElement
        const r = row.getBoundingClientRect()
        return { row: r.top, height: r.height, item: (row.closest('[role="treeitem"]') as HTMLElement).getBoundingClientRect().top }
      }
      const b = body.getBoundingClientRect()
      return { list: b.top + body.clientTop, listBottom: b.bottom, scrollTop: body.scrollTop, parent: of(parent), long: of(long) }
    },
    [path.join(vault, PARENT), path.join(vault, LONG)],
  )
}

/** Scrolls the list so the note `k` of the long folder stands in the middle of it, and waits two frames. */
async function scrollToNote(k: number): Promise<void> {
  await win.evaluate((label) => {
    const body = document.querySelector('.sidebar__body') as HTMLElement
    const row = Array.from(body.querySelectorAll('.tree__row--file')).find((r) => r.textContent === label) as HTMLElement
    body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 2
  }, name(k))
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))))
}

/** Within 1px: the list's scroll offset snaps to whole px, and a row is 25.5px tall at 100%. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1

async function buildVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yaz3469-vault-'))
  await mkdir(path.join(root, LONG), { recursive: true })
  await writeFile(path.join(root, 'Intro.md'), '# Intro\n\nsticky-intro-body\n')
  await Promise.all(Array.from({ length: NOTES }, (_, k) => writeFile(path.join(root, LONG, `${name(k + 1)}.md`), `# ${name(k + 1)}\n\nsticky-note-${k + 1}\n`)))
  await Promise.all(['After one', 'After two'].map((n) => writeFile(path.join(root, PARENT, `${n}.md`), `# ${n}\n`)))
  return root
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3469-userdata-'))
  vault = await buildVault()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- stuck

test('step 1 — in the middle of a long open folder, its folder and the parent stick at the top of the list, one row per level', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Intro.md')) })
  win = await appWindow(app, 'w1')
  await expandDirs(win, [path.join(vault, PARENT), path.join(vault, LONG)])
  await expect(win.locator('.tree__row--file').filter({ hasText: new RegExp(`^${name(NOTES)}$`) })).toHaveCount(1)
  // D2: the cap is on the list. A 750px window holds 7 levels in 40% of its list: the setting's 7.
  await expect(win.locator('.sidebar__body')).toHaveAttribute('data-sticky-levels', '7')

  await scrollToNote(60)
  await expect.poll(async () => (await rects()).scrollTop).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const r = await rects()
      // Stuck: the row stands below its li's top (Tree.tsx's rule). The stack is flush at the list's top edge, and
      // the long folder's row sits right under its parent's.
      return r.parent.item < r.parent.row - 1 && r.long.item < r.long.row - 1 && near(r.parent.row, r.list) && near(r.long.row, r.parent.row + r.parent.height)
    })
    .toBe(true)
  await shoot(win, 'sticky-1-stuck')
})

// ---------------------------------------------------------------- D3: the name

test("step 2 — a click on the stuck folder row's name scrolls the list to that folder, and the folder stays open (D3)", async () => {
  const before = await rects()
  // Playwright clicks the label's centre only if the label is what is there: the stuck row is on top.
  await dirRow(win, 'Long').locator('.tree__label').click()
  await expect
    .poll(async () => {
      const r = await rects()
      // At its own place: its li's top and its row's top are one, right under the parent's stuck row.
      return r.scrollTop < before.scrollTop && near(r.long.item, r.long.row) && near(r.long.row, r.list + r.parent.height)
    })
    .toBe(true)
  await expect(itemOf(LONG)).toHaveAttribute('aria-expanded', 'true')
  await expect(itemOf(PARENT)).toHaveAttribute('aria-expanded', 'true')
  await shoot(win, 'sticky-2-landed')
})

// ---------------------------------------------------------------- D3: the arrow

test('step 3 — a click on the stuck folder row’s arrow folds the folder, and the folder stays in view (D3)', async () => {
  await scrollToNote(90)
  await expect.poll(async () => {
    const r = await rects()
    return r.long.item < r.long.row - 1
  }).toBe(true)
  await dirRow(win, 'Long').locator('.tree__chevron').click()
  await expect(itemOf(LONG)).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(async () => {
      const r = await rects()
      return r.long.row >= r.list - 1 && r.long.row + r.long.height <= r.listBottom + 1
    })
    .toBe(true)
  await expect(itemOf(PARENT)).toHaveAttribute('aria-expanded', 'true')
  await shoot(win, 'sticky-3-folded')
  await quitApp(app)
})
