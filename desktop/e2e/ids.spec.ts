/**
 * Number IDs (YAZ-2677) end-to-end against the REAL app, on a vault that starts with two plain
 * files and no answer on IDs: the vault opens with no question, IDs are a switch in Settings that
 * asks first, and a note's ID is the vault's letters and its next number.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a vault with no answer opens with no box, and nothing is written (D1, S1)
 *   2 Settings › On opens a box; "Give IDs" does nothing until the ID letters are typed; then the
 *     notes get their numbers (D2, S5 to S7)
 *   3 a note made in the app is born with the next number, in its `id:` line and its file name (D3, D4, S14)
 *   4 a file from outside gets the next number at once, and a link typed in lowercase opens its note (S17, S59)
 *   5 the `[[` picker's Create row: the number first, then the link by that ID, then the note (S35)
 *   6 the search box finds the note by its bare number, and the row shows the full ID (D9, S69 to S72)
 *   7 "Change letters": each ID, link and file name follows, and a link with the old letters still opens (D5, S81, S82)
 *
 * Same harness as names.spec.ts (temp `--user-data-dir`, a temp vault, `ids-` step screenshots).
 * The two-Mac cases (a clash, the 10-minute wait) are not here: one app is one Mac, and
 * `desktop/src/main/vaultIndex/twoMacs.test.ts` proves them on two vault folders.
 */
// Written for YAZ-2677 and typechecked only. Not yet run: Playwright was off limits, so every
// selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, confirmSheet, editorOf, fileRow, idOf, launchApp, lensTab, linkPicker, menuItem, only, quitApp, searchBar, seededState, shoot, showSearchTab } from './helpers'

test.describe.configure({ mode: 'serial' })

const HUB_BODY = 'ids-hub-body'
const HUB = `# Hub\n\n${HUB_BODY}\n`
const PLAN = '# Plan\n\nids-plan-body\n'
/** The letters the user types in step 2, and the letters step 7 changes them to. */
const LETTERS = 'YAZ'
const NEW_LETTERS = 'DOC'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- the parts, by role and stable class only (never position) ----------

const cog = (w: Page) => w.getByRole('button', { name: 'Settings', exact: true })
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const closeSettings = (w: Page) => dialog(w).getByRole('button', { name: 'Close settings', exact: true })
/** A row of the dialog by its registry id (`data-setting`, registry.tsx). */
const row = (w: Page, id: 'ids' | 'duplicates' | 'idLetters' | 'oldIds') => dialog(w).locator(`[data-setting="${id}"]`)
const rowButton = (w: Page, id: Parameters<typeof row>[1], name: string) => row(w, id).getByRole('button', { name, exact: true })
/** The typed-confirm box (`TypedConfirmSheet`): its text field, and a button by its exact label. */
const field = (w: Page) => confirmSheet(w).locator('.confirm__input')
const sheetButton = (w: Page, label: string) => confirmSheet(w).locator('.confirm__btn', { hasText: new RegExp(`^${label}$`) })
const inline = (w: Page) => w.locator('.create-inline__input')
/** A search result is a row of the search tree (YAZ-2620). */
const results = (w: Page) => w.locator('.sidebar__body .tree__row--file')
const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()

const read = (p: string) => readFile(p, 'utf8').catch(() => '')
const idsFile = () => path.join(vault, '.yaseendocs', 'ids.json')
/** The vault's `ids.json` as an object, or null while there is none (or it does not parse). */
const idsConfig = async (): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(await readFile(idsFile(), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
/** The number of a number ID with these letters, or 0 for anything else. */
const numberOf = (id: string, letters: string): number => Number(new RegExp(`^${letters}-([1-9]\\d*)$`).exec(id)?.[1] ?? 0)
/** `last` of each Mac's count file in the vault (`.yaseendocs/ids/<mac id>.json`): one file here, this Mac's. */
const counts = async (): Promise<number[]> => {
  const dir = path.join(vault, '.yaseendocs', 'ids')
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'))
  return Promise.all(names.map(async (name) => (JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { last: number }).last))
}

async function openSettings(w: Page): Promise<void> {
  await cog(w).click()
  await expect(dialog(w)).toBeVisible()
  await expect(row(w, 'ids')).toBeVisible()
}

/** "New note" from the sidebar's blank-space menu, typed and committed (the idiom of names.spec.ts). */
async function newNote(w: Page, typed: string): Promise<void> {
  await w.locator('.sidebar__body').click({ button: 'right', position: { x: 40, y: 500 } })
  await menuItem(w, 'New note').click()
  await inline(w).fill(typed)
  await w.keyboard.press('Enter')
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'ids-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'ids-vault-'))
  // Made outside the app, with no `.yaseendocs/`: a vault that has no answer on IDs.
  await writeFile(path.join(vault, 'Hub.md'), HUB)
  await writeFile(path.join(vault, 'Plan.md'), PLAN)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

let hubId = ''
let guideId = ''
let freshId = ''

test('step 1 — a vault with no answer on IDs opens with no box, and nothing is written', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Hub')).toBeVisible()
  await expect(fileRow(win, 'Plan')).toBeVisible()

  // The index has landed (the rows read the files). No sheet of any kind asks about IDs.
  await fileRow(win, 'Hub').click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  await expect(confirmSheet(win)).toHaveCount(0)
  expect(await idsConfig()).toBeNull()
  expect(await read(path.join(vault, 'Hub.md'))).toBe(HUB)
  expect(await read(path.join(vault, 'Plan.md'))).toBe(PLAN)
  await shoot(win, 'ids-01-no-box')
})

test('step 2 — Settings › On opens the box; "Give IDs" does nothing until the letters are typed; then the notes get their numbers', async () => {
  await openSettings(win)
  // A vault with no answer reads Off, and the rows that need IDs are not there yet.
  await expect(rowButton(win, 'ids', 'Off')).toHaveAttribute('aria-pressed', 'true')
  await expect(row(win, 'idLetters')).toHaveCount(0)
  await expect(row(win, 'duplicates')).toHaveCount(0)

  await rowButton(win, 'ids', 'On').click()
  const box = confirmSheet(win)
  await expect(box).toBeVisible()
  // What an ID is, what a yes would write (counted), and how to undo it. A click on On wrote nothing.
  await expect(box).toContainText('Give the notes in this vault IDs?')
  await expect(box).toContainText('write an ID into 2 notes')
  await expect(box).toContainText('To undo, turn it off.')
  await expect(box).toContainText('Type the ID letters for this vault: 2 to 5 letters, like BUS.')
  await expect(field(win)).toBeFocused()
  await expect(sheetButton(win, 'Give IDs')).toBeDisabled()
  expect(await idsConfig()).toBeNull()
  await shoot(win, 'ids-02a-box')

  // The button and Enter do nothing while the field is empty or holds what is not 2 to 5 letters.
  for (const typed of ['', 'Y', 'ABCDEF', 'YA1', 'YA Z']) {
    await field(win).fill(typed)
    await expect(sheetButton(win, 'Give IDs')).toBeDisabled()
    await field(win).press('Enter')
    await expect(box).toBeVisible()
  }
  expect(await idsConfig()).toBeNull()
  expect(await read(path.join(vault, 'Hub.md'))).toBe(HUB)

  // Valid letters, in any case: the button works, and the letters are saved in capitals.
  await field(win).fill(LETTERS.toLowerCase())
  await expect(sheetButton(win, 'Give IDs')).toBeEnabled()
  await sheetButton(win, 'Give IDs').click()
  await expect(box).toHaveCount(0)
  await expect(dialog(win)).toBeVisible() // the box's keys and clicks stay inside it
  await expect.poll(idsConfig).toMatchObject({ enabled: true, letters: LETTERS })
  await expect(rowButton(win, 'ids', 'On')).toHaveAttribute('aria-pressed', 'true')

  // This Mac gives the numbers at once (R32): each note holds one, and neither file was renamed.
  await expect.poll(async () => numberOf(idOf(await read(path.join(vault, 'Hub.md'))), LETTERS)).toBeGreaterThan(0)
  await expect.poll(async () => numberOf(idOf(await read(path.join(vault, 'Plan.md'))), LETTERS)).toBeGreaterThan(0)
  hubId = idOf(await read(path.join(vault, 'Hub.md')))
  const planId = idOf(await read(path.join(vault, 'Plan.md')))
  expect([numberOf(hubId, LETTERS), numberOf(planId, LETTERS)].sort()).toEqual([1, 2]) // a new vault starts at 1
  expect(await counts()).toEqual([2]) // one count file, this Mac's

  // The rows that need IDs are there now.
  await expect(row(win, 'duplicates')).toBeVisible()
  await expect(row(win, 'idLetters').getByRole('status')).toHaveText(`This vault's ID letters are ${LETTERS}.`)
  await expect(row(win, 'oldIds')).toHaveCount(0) // no note holds an old 12-character ID
  await shoot(win, 'ids-02b-on')
  await closeSettings(win).click()
  await expect(dialog(win)).toHaveCount(0)
})

test('step 3 — a note made in the app is born with the next number, in its `id:` line and in its file name', async () => {
  await newNote(win, 'Guide')
  await expect.poll(() => only(vault, /^guide-yaz-[1-9]\d*\.md$/)).not.toBe('')
  const guide = await only(vault, /^guide-yaz-[1-9]\d*\.md$/)
  guideId = idOf(await read(path.join(vault, guide)))
  expect(guideId).toBe(`${LETTERS}-3`) // the highest number in the vault plus 1
  expect(guide).toBe('guide-yaz-3.md') // the file name holds the ID in lowercase
  expect(await counts()).toEqual([3]) // the count was saved before the note was written
  await expect(fileRow(win, 'Guide')).toBeVisible()
  await shoot(win, 'ids-03-born')
})

test('step 4 — a file from outside gets the next number at once, and a link typed in lowercase opens its note', async () => {
  // Made outside the app, as an agent would: no ID of its own, and a link in lowercase.
  await writeFile(path.join(vault, 'Typed.md'), `See [[${guideId.toLowerCase()}]] here.\n`)
  await expect(fileRow(win, 'Typed')).toBeVisible()
  // This Mac made the vault's one count file, so it is the first Mac: the file has its number in a moment.
  await expect.poll(async () => numberOf(idOf(await read(path.join(vault, 'Typed.md'))), LETTERS)).toBe(4)
  // The sweep set the one key: the link is as it was typed.
  expect(await read(path.join(vault, 'Typed.md'))).toContain(`[[${guideId.toLowerCase()}]]`)

  await fileRow(win, 'Typed').click()
  await expect(linkIn(win, 'Guide')).toBeVisible() // the app shows the title, not the ID
  await linkIn(win, 'Guide').click()
  await expect(activeTab(win)).toHaveText('Guide')
})

test('step 5 — the picker’s Create row takes the number first, links by that ID, and makes the note', async () => {
  await fileRow(win, 'Hub').click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  // Type at the end of the hub's paragraph (never Enter — see smoke.spec step 3).
  await editorOf(win).getByText(HUB_BODY).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' [[Fresh idea', { delay: 15 })
  await expect(linkPicker(win).locator('[role="option"]')).toHaveText(['Create "Fresh idea"'])
  await shoot(win, 'ids-05a-create-row')
  await win.keyboard.press('Enter')
  // Typed at once, during the short wait for the number: no character is lost (S36).
  await win.keyboard.type(' tail', { delay: 15 })

  await expect.poll(() => only(vault, /^fresh-idea-yaz-[1-9]\d*\.md$/)).not.toBe('')
  const fresh = await only(vault, /^fresh-idea-yaz-[1-9]\d*\.md$/)
  freshId = idOf(await read(path.join(vault, fresh)))
  expect(freshId).toBe(`${LETTERS}-5`)
  expect(fresh).toBe('fresh-idea-yaz-5.md')
  // On disk the link is the ID, where the `[[` text was, and the typed text follows it.
  await expect.poll(async () => await read(path.join(vault, 'Hub.md')), { timeout: 10_000 }).toContain(`${HUB_BODY} [[${freshId}]] tail`)
  expect(idOf(await read(path.join(vault, 'Hub.md')))).toBe(hubId) // the hub keeps its own ID
  // The page was born at the pick, and the editor stayed on the hub.
  await expect(fileRow(win, 'Fresh idea')).toBeVisible()
  await expect(activeTab(win)).toHaveText('Hub')
  await editorOf(win).locator('h1').first().click() // a link stays raw while the caret touches it; the heading is clear of it
  await expect(linkIn(win, 'Fresh idea')).toBeVisible()
  await shoot(win, 'ids-05b-linked')
})

test('step 6 — the search box finds the note by its bare number, and the row shows the full ID', async () => {
  const bare = String(numberOf(freshId, LETTERS))
  await showSearchTab(win)
  // A bare number: the note of that number, its full ID in front of its title. No title holds "5".
  await searchBar(win).fill(bare)
  await expect(results(win)).toHaveText([`${freshId} — Fresh idea`])
  await shoot(win, 'ids-06-search-by-number')
  // With the letters, in any case, with a hyphen, a space or nothing between.
  for (const typed of [freshId, freshId.toLowerCase(), `yaz${bare}`, `yaz ${bare}`]) {
    await searchBar(win).fill(typed)
    await expect(results(win)).toHaveText([`${freshId} — Fresh idea`])
  }
  // An ID matches whole: a longer number is another note's, and no note has it.
  await searchBar(win).fill(`yaz-${bare}0`)
  await expect(results(win)).toHaveCount(0)
  // Found by its title, the row reads as the title alone.
  await searchBar(win).fill('fresh')
  await expect(results(win)).toHaveText(['Fresh idea'])
  // Esc goes back to the lens the window last showed, Files. The text would stay in the Search tab, so it is emptied first.
  await searchBar(win).fill('')
  await searchBar(win).press('Escape')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
})

test('step 7 — "Change letters": each ID, link and file name follows, and a link with the old letters still opens', async () => {
  const number = numberOf(freshId, LETTERS)
  const next = `${NEW_LETTERS}-${number}`
  await openSettings(win)
  await rowButton(win, 'idLetters', 'Change letters').click()
  const box = confirmSheet(win)
  await expect(box).toContainText(`Change the ID letters of this vault? They are ${LETTERS} now.`)
  // Bad input, and the letters the vault already has, do nothing.
  for (const typed of ['D', 'DO1', LETTERS]) {
    await field(win).fill(typed)
    await expect(sheetButton(win, 'Change letters')).toBeDisabled()
  }
  await field(win).fill(NEW_LETTERS.toLowerCase())
  await sheetButton(win, 'Change letters').click()
  await expect(box).toHaveCount(0)
  // The row waits for the main process, then shows what the vault holds: the new letters, and no note left behind.
  await expect(row(win, 'idLetters').getByRole('status')).toHaveText(`This vault's ID letters are ${NEW_LETTERS}.`)
  await shoot(win, 'ids-07a-letters-changed')

  // `ids.json` has the new letters and remembers the old ones.
  expect(await idsConfig()).toMatchObject({ enabled: true, letters: NEW_LETTERS, was: [LETTERS] })
  // The `id:` line, the link and the built file name all follow; the number stays.
  expect(await only(vault, /^fresh-idea-.*\.md$/)).toBe(`fresh-idea-doc-${number}.md`)
  expect(idOf(await read(path.join(vault, `fresh-idea-doc-${number}.md`)))).toBe(next)
  expect(await read(path.join(vault, 'Hub.md'))).toContain(`[[${next}]]`)
  expect(await only(vault, /^guide-.*\.md$/)).toBe('guide-doc-3.md')
  // A file the app did not name keeps its name, and takes the new letters in its `id:` line.
  expect(idOf(await read(path.join(vault, 'Hub.md')))).toBe(`${NEW_LETTERS}-${numberOf(hubId, LETTERS)}`)
  await closeSettings(win).click()
  await expect(dialog(win)).toHaveCount(0)

  // A file that comes later, with a link the change did not reach: it still opens the note (S82).
  await writeFile(path.join(vault, 'Late.md'), `See [[${freshId}]] here.\n`)
  await expect(fileRow(win, 'Late')).toBeVisible()
  await fileRow(win, 'Late').click()
  await expect(linkIn(win, 'Fresh idea')).toBeVisible()
  await linkIn(win, 'Fresh idea').click()
  await expect(activeTab(win)).toHaveText('Fresh idea')
  expect(await read(path.join(vault, 'Late.md'))).toContain(`[[${freshId}]]`) // the old link is still on disk
  await shoot(win, 'ids-07b-old-link-opens')
  await quitApp(app)
})
