/**
 * Links E1 (GRO-2194): in-app rename with automatic link updates, against the REAL app —
 * the sidebar context menu's "Rename" → inline input → Enter → the name-change confirm sheet
 * (⚡ YAZ-888, which every NAME change below now passes). The vault is plain (YAZ-2523 🔒 V3),
 * the default: the file takes the typed name and nothing is written inside it,
 * every referencing note is rewritten (bare, aliased and embed forms, alias
 * preserved), the open tab follows in place (label + window title), the summary notice
 * shows, and clicking the rewritten link navigates to the renamed file. A rename onto an
 * existing name is refused with a notice, as Finder would: nothing is overwritten.
 *
 * YAZ-1553 (step 3b): LEAVING the inline box commits — click another row with a changed name
 * and the sheet asks and SURVIVES that click (the row's mousedown landed before the sheet
 * existed, and its click lands on the body, so the row does not open); Escape is the only
 * discard; the unchanged name leaves silently.
 *
 * Links E1b (GRO-2241, steps 5+): folder rename via the folder row's context menu — the
 * PATHED link in a referencing note rewrites on disk while the bare link stays
 * BYTE-IDENTICAL (the LOCKED rule), and the open tab under the folder follows by prefix;
 * drag-a-file-row-onto-a-folder moves it (bare link unchanged, pathed link rewritten);
 * a folder and a 2-row selection drag onto a folder, and ⌘Z puts each back with its links (YAZ-3247);
 * a folder rename onto an existing folder is DECLINED with a passive notice.
 *
 * A row drag to move is the OS drag (YAZ-3254 D4). The suite runs in the hidden mode
 * (`YASEEN_DOCS_E2E_HIDDEN=1`, helpers.ts), where main starts NO OS drag — it would take the real
 * mouse of the person at the Mac — and records the paths on `globalThis.e2eDragOuts` (YAZ-3258).
 *
 * Same harness as links.spec.ts (temp `--user-data-dir`, COPY of a generated fixture
 * vault, `rename-` step screenshots); serial by design — each step continues the last.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  activeTab,
  appWindow,
  buildFixtureVault,
  confirmSheet,
  copyVault,
  dirRow,
  editorOf,
  fileRow,
  launchApp,
  layer,
  quitApp,
  seededState,
  shoot,
  tabsOf,
  LINK_HERE,
  openLinksHere,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** Seeded on top of the fixture vault: A references B three ways; C blocks a rename onto it. */
const A_BODY = 'a-hub-body'
const B_BODY = 'b-note-body'
/** YAZ-1553 seed: D is linked by nobody, so its click-away rename asks with the "no other notes" count. */
const D_BODY = 'd-note-body'
/** E1b seeds: Docs/N is referenced by R (pathed + bare); Target/M by S (pathed + bare). */
const N_BODY = 'n-note-body'
const M_BODY = 'm-note-body'
/** YAZ-3247 seeds: Box/inner is linked by Q by path; P1 and P2 move as a selection; Dest takes them. */
const INNER_BODY = 'inner-note-body'
/** YAZ-3262 seeds, written in step 6c at the top of the tree: Aa/Out goes out to "Finder"; Aa/Zz1 and Aa/<long name> move onto Ab, which holds the long name already, so the toast wraps. */
const LONG = 'Zz2 a note whose name is long enough to wrap the toast onto three lines'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page


/** Right-click `label`'s row and drive the context menu's Rename into the inline input. */
async function startRename(w: Page, label: string): Promise<void> {
  await fileRow(w, label).click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(w.locator('.create-inline__input')).toHaveValue(label)
}

/**
 * A row drag as the app takes it (YAZ-3254 D4): the press and the first moves fire the row's
 * `dragstart`, which stops the page's own drag; the move LIFT_PX from the press (YAZ-3467 D1) asks
 * main for the OS drag (recorded, not started, in the hidden mode). The drop then lands on `target` as a drop in the window does, and the button
 * comes up there, so no row takes a click.
 */
async function dragRow(w: Page, row: Locator, target: Locator): Promise<void> {
  const from = await row.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('a row of the drag is not on screen')
  await w.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await w.mouse.down()
  await w.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 })
  await target.dispatchEvent('dragover')
  await target.dispatchEvent('drop')
  await w.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  await w.mouse.up()
}

/**
 * A row drag that leaves the window (YAZ-3254 S26), as the sidebar sees one: the row's `dragstart`,
 * then a `dragleave` with no `relatedTarget`, then the first pointer move with no button down. The
 * button comes up over the empty editor, so no row takes a click.
 */
async function dragOutOfWindow(w: Page, row: Locator): Promise<void> {
  const from = await row.boundingBox()
  const rest = await layer(w).boundingBox()
  if (from === null || rest === null) throw new Error('the row or the editor is not on screen')
  await w.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await w.mouse.down()
  await w.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 })
  await w.evaluate(() => void document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null })))
  await w.mouse.move(rest.x + rest.width / 2, rest.y + rest.height - 20)
  await w.mouse.up()
  await w.mouse.move(rest.x + rest.width / 2 + 4, rest.y + rest.height - 24)
}

/** The paths of each row drag main was asked to start, in the hidden mode (YAZ-3258). */
const dragOuts = (): Promise<string[][]> => app.evaluate(() => (globalThis as { e2eDragOuts?: string[][] }).e2eDragOuts ?? [])

/** The folder-row variant (E1b): prefilled with the folder's title. */
async function startRenameDir(w: Page, label: string): Promise<void> {
  await dirRow(w, label).click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(w.locator('.create-inline__input')).toHaveValue(label)
}


/**
 * The name-change confirm (⚡ YAZ-888, amending decision E / GRO-2096): since the one door in App
 * asks before any NAME change, every rename below passes this sheet — with the honest count —
 * and only a drag-MOVE still runs silently (step 6 pins that).
 */
async function confirmRename(w: Page, message?: string): Promise<void> {
  if (message !== undefined) await expect(confirmSheet(w).locator('.confirm__text')).toHaveText(message)
  await expect(confirmSheet(w)).toBeVisible()
  await confirmSheet(w).locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(confirmSheet(w)).toHaveCount(0)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'rename-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, 'Docs'), { recursive: true })
  await mkdir(path.join(vault, 'Target'), { recursive: true })
  await mkdir(path.join(vault, 'Box'), { recursive: true })
  await mkdir(path.join(vault, 'Dest'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, 'A.md'), `# A\n\n${A_BODY}\n\nSee [[B]] and [[B|Bee]] here.\n\n![[B]]\n`),
    writeFile(path.join(vault, 'B.md'), `# B\n\n${B_BODY}\n`),
    writeFile(path.join(vault, 'C.md'), '# C\n\nc-note-body\n'),
    writeFile(path.join(vault, 'D.md'), `# D\n\n${D_BODY}\n`),
    writeFile(path.join(vault, 'Docs', 'N.md'), `# N\n\n${N_BODY}\n`),
    writeFile(path.join(vault, 'R.md'), '# R\n\nSee [[Docs/N]] and [[N]] here.\n'),
    writeFile(path.join(vault, 'Target', 'M.md'), `# M\n\n${M_BODY}\n`),
    writeFile(path.join(vault, 'S.md'), '# S\n\nSee [[Target/M]] and [[M]] here.\n'),
    writeFile(path.join(vault, 'Box', 'inner.md'), `# inner\n\n${INNER_BODY}\n`),
    writeFile(path.join(vault, 'Q.md'), '# Q\n\nSee [[Box/inner]] here.\n'),
    writeFile(path.join(vault, 'P1.md'), '# P1\n\np-one\n'),
    writeFile(path.join(vault, 'P2.md'), '# P2\n\np-two\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

/**
 * Poll-friendly read: `expect.poll` ABORTS on a thrown error (no retry), and right after
 * Enter the rename pipeline (flush → index+tree snapshots → fs:rename → rewrites) is still
 * in flight — so a not-yet-existing file must read as '' and keep the poll polling.
 */
const readWhenReady = (p: string) => readFile(p, 'utf8').catch(() => '')

test('step 1 — rename B via the context menu: disk file renamed, tab and title follow, summary notice shows', async () => {
  app = await launchApp({ userData, seedState: openLinksHere(seededState(vault, path.join(vault, 'B.md'))) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect(tabsOf(win)).toHaveText(['B'])

  await startRename(win, 'B')
  await shoot(win, 'rename-01-inline-input')
  await win.locator('.create-inline__input').fill('B2')
  await win.keyboard.press('Enter')
  // ⚡ YAZ-888: the name changed, so the sheet asks first — with the honest count (A is the one
  // note that links to B, however many times it does).
  await expect(confirmSheet(win)).toBeVisible()
  await shoot(win, 'rename-01b-confirm-sheet')
  await confirmRename(win, "Rename 'B' to 'B2'? Links in 1 note will be updated.")

  // Disk: the file takes the typed name, its bytes as they were (YAZ-2523 🔒 V3); nothing
  // remains at the old path.
  await expect.poll(() => readWhenReady(path.join(vault, 'B2.md'))).toBe(`# B\n\n${B_BODY}\n`)
  await expect(readFile(path.join(vault, 'B.md'), 'utf8')).rejects.toThrow()
  // The open tab follows IN PLACE — label, editor content and the window title.
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect.poll(() => win.title()).toContain('B2')
  // ONE passive summary notice: exactly one referencing note was rewritten.
  await expect(win.locator('.link-notice__text')).toHaveText('Renamed to "B2". Updated links in 1 note') // with Undo (YAZ-3268 D18)
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
  await expect(link).not.toHaveClass(/wikilink--unresolved/)
  await link.click({ modifiers: LINK_HERE }) // an open gesture (YAZ-3936): a plain click puts the caret
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await shoot(win, 'rename-03-link-navigates')
})

test('step 3b — leaving the inline box commits (YAZ-1553): click another row and the sheet asks and survives; Escape discards; unchanged is silent', async () => {
  await startRename(win, 'D')
  await win.locator('.create-inline__input').fill('D2')
  // No Enter: clicking row A is the leave. Its mousedown lands BEFORE the sheet exists, so the
  // sheet's own click-away-cancels does not fire — and A's click lands on the body, not the row.
  await fileRow(win, 'A').click()
  await expect(confirmSheet(win)).toBeVisible()
  await shoot(win, 'rename-03b-clickaway-sheet')
  await expect(activeTab(win)).toHaveText('B2')
  await confirmRename(win, "Rename 'D' to 'D2'? No other notes link to it.")
  const d2 = path.join(vault, 'D2.md')
  await expect.poll(() => readWhenReady(d2)).toBe(`# D\n\n${D_BODY}\n`)
  await expect(readFile(path.join(vault, 'D.md'), 'utf8')).rejects.toThrow()
  await expect(fileRow(win, 'D2')).toBeVisible()

  // Escape is the only discard: the box closes, no sheet, nothing moves.
  await startRename(win, 'D2')
  await win.locator('.create-inline__input').fill('Discarded')
  await win.keyboard.press('Escape')
  await expect(win.locator('.create-inline__input')).toHaveCount(0)
  await expect(confirmSheet(win)).toHaveCount(0)
  await expect(fileRow(win, 'D2')).toBeVisible()
  expect(await readFile(d2, 'utf8')).toBe(`# D\n\n${D_BODY}\n`)

  // Leaving with the unchanged name is silent: the parent's same-name no-op, no sheet.
  await startRename(win, 'D2')
  await fileRow(win, 'A').click()
  await expect(win.locator('.create-inline__input')).toHaveCount(0)
  await expect(confirmSheet(win)).toHaveCount(0)
  await expect(fileRow(win, 'D2')).toBeVisible()
})

test('step 4 — renaming onto an existing name is refused in a plain vault: a notice, and nothing is overwritten', async () => {
  await startRename(win, 'A')
  await win.locator('.create-inline__input').fill('C')
  await win.keyboard.press('Enter')
  await confirmRename(win, "Rename 'A' to 'C'? No other notes link to it.")
  // A plain vault names a note by its file only (YAZ-2523 🔒 V3), so C.md holds the name: the
  // rename is refused, as Finder would. In a vault that uses IDs two notes may share a title
  // (YAZ-2420, table B); `names.spec.ts` walks that kind.
  await expect(win.locator('.link-notice')).toHaveText('Can\'t rename: "C" already exists')
  expect(await readFile(path.join(vault, 'A.md'), 'utf8')).toContain(A_BODY)
  expect(await readFile(path.join(vault, 'C.md'), 'utf8')).toBe('# C\n\nc-note-body\n')
  await expect(fileRow(win, 'C')).toHaveCount(1)
  await expect(fileRow(win, 'A')).toBeVisible()
  await shoot(win, 'rename-04-name-taken')
  await quitApp(app)
})

// ---------- E1b (GRO-2241): folder rename + drag-move, fresh launch on the same vault ----------

test('step 5 — folder rename via its context menu: disk moves, PATHED link rewritten, bare link BYTE-IDENTICAL, open tab follows', async () => {
  app = await launchApp({ userData, seedState: openLinksHere(seededState(vault, path.join(vault, 'Docs', 'N.md'))) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(N_BODY)
  await expect(tabsOf(win)).toHaveText(['N'])

  await startRenameDir(win, 'Docs')
  await shoot(win, 'rename-05-folder-inline-input')
  await win.locator('.create-inline__input').fill('Notes')
  await win.keyboard.press('Enter')
  // A FOLDER name is a name too (⚡ YAZ-888), and its count is the DIR-mode one: R's PATHED
  // link is what the rewrite would touch — the bare [[N]] keeps resolving and is not counted.
  await confirmRename(win, "Rename 'Docs' to 'Notes'? Links in 1 note will be updated.")

  // Disk: the folder takes the typed name and gets no `.folder.md` (YAZ-2523 🔒 V3); it moved
  // with its file, whose own name is untouched; nothing remains at the old path.
  await expect.poll(() => readWhenReady(path.join(vault, 'Notes', 'N.md'))).toContain(N_BODY)
  await expect(readFile(path.join(vault, 'Notes', '.folder.md'), 'utf8')).rejects.toThrow()
  await expect(readFile(path.join(vault, 'Docs', 'N.md'), 'utf8')).rejects.toThrow()
  // R.md pinned WHOLE: the pathed link rewrote to the path on disk, the bare [[N]] is byte-identical (LOCKED).
  await expect.poll(() => readWhenReady(path.join(vault, 'R.md'))).toBe('# R\n\nSee [[Notes/N]] and [[N]] here.\n')
  // The open tab under the folder followed by prefix — same label, NEW path — and the
  // window still works (editor alive, title tracks the active tab).
  await expect(activeTab(win)).toHaveText('N')
  await expect(activeTab(win)).toHaveAttribute('title', path.join(vault, 'Notes', 'N.md'))
  await expect(editorOf(win)).toContainText(N_BODY)
  await expect.poll(() => win.title()).toContain('N')
  await expect(win.locator('.link-notice__text')).toHaveText('Renamed to "Notes". Updated links in 1 note') // with Undo (YAZ-3268 D18)
  await shoot(win, 'rename-06-folder-renamed')
})

test('step 6 — drag a file row onto a folder row: the file moves there, bare link unchanged, pathed link rewritten', async () => {
  await dirRow(win, 'Target').click() // expand to reveal M
  await expect(fileRow(win, 'M')).toBeVisible()
  // A 6 px slip lifts nothing (YAZ-3467 D1): main is asked for no OS drag, and nothing moves.
  const before = (await dragOuts()).length
  const m = await fileRow(win, 'M').boundingBox()
  if (m === null) throw new Error('M is not on screen')
  await win.mouse.move(m.x + m.width / 2, m.y + m.height / 2)
  await win.mouse.down()
  await win.mouse.move(m.x + m.width / 2 + 6, m.y + m.height / 2, { steps: 3 })
  await win.mouse.up()
  expect(await dragOuts()).toHaveLength(before)
  await dragRow(win, fileRow(win, 'M'), dirRow(win, 'Notes'))
  // Main was asked for the OS drag of the one row, and in the hidden mode started none.
  expect((await dragOuts()).at(-1)).toEqual([path.join(vault, 'Target', 'M.md')])

  // A MOVE keeps the name, so it stays SILENT (⚡ YAZ-888): no sheet, ever, on a drag.
  await expect(confirmSheet(win)).toHaveCount(0)
  await expect.poll(() => readWhenReady(path.join(vault, 'Notes', 'M.md'))).toContain(M_BODY)
  await expect(readFile(path.join(vault, 'Target', 'M.md'), 'utf8')).rejects.toThrow()
  // S.md pinned WHOLE: [[Target/M]] → [[Notes/M]]; the bare [[M]] still resolves — unchanged.
  await expect.poll(() => readWhenReady(path.join(vault, 'S.md'))).toBe('# S\n\nSee [[Notes/M]] and [[M]] here.\n')
  // A move says itself, then the links that followed it (YAZ-3250 D1).
  await expect(win.locator('.link-notice__text')).toHaveText('Moved 1 file (M.md). Updated links in 1 note') // the toast has Undo now (YAZ-3255 D11)
  await shoot(win, 'rename-07-drag-move')
})

test('step 6b — drag a folder, then a 2-row selection, onto a folder; ⌘Z puts each back, and the links follow back (YAZ-3247 S2, S3, S33)', async () => {
  await dragRow(win, dirRow(win, 'Box'), dirRow(win, 'Dest'))
  await expect.poll(() => readWhenReady(path.join(vault, 'Dest', 'Box', 'inner.md'))).toContain(INNER_BODY)
  await expect.poll(() => readWhenReady(path.join(vault, 'Q.md'))).toBe('# Q\n\nSee [[Dest/Box/inner]] here.\n')
  await expect(win.locator('.link-notice__text')).toHaveText('Moved 1 folder (Box). Updated links in 1 note')
  // The tree has caught up: the dragged folder (still selected, S4) is no row at its old path, so the
  // Shift-clicks below do not add a path that is gone, which the next drag out refuses (NOT_FOUND).
  await expect(win.locator(`.tree__row[data-path="${path.join(vault, 'Box')}"]`)).toHaveCount(0)

  await fileRow(win, 'P1').click({ modifiers: ['Shift'] })
  await fileRow(win, 'P2').click({ modifiers: ['Shift'] })
  await dragRow(win, fileRow(win, 'P1'), dirRow(win, 'Dest'))
  expect((await dragOuts()).at(-1)).toEqual([path.join(vault, 'P1.md'), path.join(vault, 'P2.md')])
  await expect.poll(() => readWhenReady(path.join(vault, 'Dest', 'P2.md'))).toContain('p-two')
  await expect(win.locator('.link-notice__text')).toHaveText('Moved 2 files (P1.md, P2.md)')
  await expect(readFile(path.join(vault, 'Dest', 'P1.md'), 'utf8')).resolves.toContain('p-one')
  // A drop inside the window: no box asks (S30).
  await expect(win.locator('.drag-out-ask')).toHaveCount(0)

  // ⌘Z at once, before the watcher has caught up: the newest gesture goes back first.
  await win.keyboard.press('Meta+z')
  await expect.poll(() => readWhenReady(path.join(vault, 'P1.md'))).toContain('p-one')
  await expect(win.locator('.link-notice__text')).toHaveText('Moved back 2 files (P1.md, P2.md)')
  await expect(readFile(path.join(vault, 'P2.md'), 'utf8')).resolves.toContain('p-two')
  await win.keyboard.press('Meta+z')
  await expect.poll(() => readWhenReady(path.join(vault, 'Box', 'inner.md'))).toContain(INNER_BODY)
  // Q's link follows the folder back: the index already held the rewritten link (YAZ-3258).
  await expect.poll(() => readWhenReady(path.join(vault, 'Q.md'))).toBe('# Q\n\nSee [[Box/inner]] here.\n')
  // The undo says the links that followed, as the move's own toast does (YAZ-3337).
  await expect(win.locator('.link-notice__text')).toHaveText('Moved back 1 folder (Box). Updated links in 1 note')
  await shoot(win, 'rename-07b-drag-undo')
})

test('step 6c — the box after a drag out stands above a toast of three lines, in light and dark (YAZ-3262)', async () => {
  await mkdir(path.join(vault, 'Aa'))
  await mkdir(path.join(vault, 'Ab'))
  await Promise.all([
    writeFile(path.join(vault, 'Aa', 'Out.md'), '# Out\n\nout-body\n'),
    writeFile(path.join(vault, 'Aa', 'Zz1.md'), '# Zz1\n\nz-one\n'),
    writeFile(path.join(vault, 'Aa', `${LONG}.md`), `# ${LONG}\n\nlong-aa\n`),
    writeFile(path.join(vault, 'Ab', `${LONG}.md`), `# ${LONG}\n\nlong-ab\n`),
  ])
  await dirRow(win, 'Aa').click() // expand: its rows stand at the top, clear of the toast's corner
  await expect(fileRow(win, LONG)).toBeVisible()
  await dragOutOfWindow(win, fileRow(win, 'Out'))
  expect((await dragOuts()).at(-1)).toEqual([path.join(vault, 'Aa', 'Out.md')])
  const ask = win.locator('.drag-out-ask')
  await expect(ask).toHaveText(/^Copied 1 file \(Out\.md\) to Finder\?/)

  // Zz1 moves; the long name is taken on Ab, so it stays, and the toast names it with Undo.
  await fileRow(win, 'Zz1').click()
  await fileRow(win, LONG).click({ modifiers: ['Shift'] })
  await dragRow(win, fileRow(win, 'Zz1'), dirRow(win, 'Ab'))
  const toast = win.locator('.link-notice')
  await expect(toast.locator('.link-notice__text')).toHaveText(`Moved 1 file (Zz1.md), skipped 1: ${LONG} already exists`)
  await expect(ask).toBeVisible() // a later toast does not hide the box (S32)
  for (const colorScheme of ['light', 'dark'] as const) {
    await win.emulateMedia({ colorScheme })
    const above = await ask.boundingBox()
    const below = await toast.boundingBox()
    if (above === null || below === null) throw new Error('the box or the toast is not on screen')
    expect(below.height).toBeGreaterThan(55) // two lines or more: the case the fixed places broke
    expect(above.y + above.height).toBeLessThanOrEqual(below.y)
    await shoot(win, `rename-07c-box-above-toast-${colorScheme}`)
  }
  await win.emulateMedia({ colorScheme: null })
  await ask.getByRole('button', { name: 'Keep in vault' }).click()
  await expect(ask).toHaveCount(0)
  await expect(readFile(path.join(vault, 'Aa', 'Out.md'), 'utf8')).resolves.toContain('out-body')
})

test('step 7 — renaming a folder onto an EXISTING folder is DECLINED with a passive notice; nothing moves', async () => {
  await startRenameDir(win, 'Target')
  await win.locator('.create-inline__input').fill('Notes')
  await win.keyboard.press('Enter')
  // The sheet stands in the way of this one too. Only the NAMES are pinned here: N is read off
  // whatever index snapshot the window holds at that instant, and step 6 moved a file moments
  // ago — the counted set depends on how far the 300ms-debounced refetch has caught up.
  await expect(confirmSheet(win).locator('.confirm__text')).toContainText("Rename 'Target' to 'Notes'?")
  await confirmRename(win)
  await expect(win.locator('.link-notice')).toHaveText('Can\'t rename: "Notes" already exists')
  // Both folders untouched.
  expect((await stat(path.join(vault, 'Target'))).isDirectory()).toBe(true)
  expect(await readFile(path.join(vault, 'Notes', 'N.md'), 'utf8')).toContain(N_BODY)
  await expect(dirRow(win, 'Target')).toBeVisible()
  await shoot(win, 'rename-08-folder-decline')
  await quitApp(app)
})
