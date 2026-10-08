/**
 * The page settings cog and the line numbers of a note, in the REAL app (YAZ-2643):
 *  - THE COG is the first chip of a Markdown note. Its menu has one switch, "Line numbers", and the
 *    word and character count of the note body.
 *  - A LINE NUMBER is a line of the file ON DISK, frontmatter included. The numbers are built when
 *    the switch turns on, when an outside change lands, and when a save settles. This is the one
 *    place the web worker is proved to load from the built app: no unit suite has a real `Worker`.
 *  - NOTHING IS STORED: the switch is state of the mounted editor. It never reaches the state file,
 *    and a note opened again starts with the numbers off.
 *
 * Every expected number was counted by hand in the file text. The second check cannot be fooled by
 * a wrong count: the line of the file on disk at each number holds that block's first word.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, clickMenuItem, editorOf, fileRow, launchApp, layer, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Skill.md'
/** What an AI writes: frontmatter, `-` bullets, a run of blank lines. */
const BODY = [
  '---', //                    1
  'status: draft', //          2
  'owner: e2e', //             3
  '---', //                    4
  '', //                       5
  '# Heading one', //          6
  '', //                       7
  '', //                       8
  'First paragraph.', //       9
  '', //                       10
  '- Alpha bullet', //         11
  '  - Nested bullet', //      12
  '- Beta bullet', //          13
  '', //                       14
  '```js', //                  15
  'const answer = 42', //      16
  '```', //                    17
  '', //                       18
  'Last paragraph.', //        19
  '',
].join('\n')
/** The same note after an agent's edit: one more property, and a paragraph under the heading. */
const ADDED = 'agent-added-line-e2e'
const EDITED = [
  '---', //                    1
  'status: done', //           2
  'owner: e2e', //             3
  'reviewed: true', //         4
  '---', //                    5
  '', //                       6
  '# Heading one', //          7
  '', //                       8
  `${ADDED} here.`, //         9
  '', //                       10
  '', //                       11
  'First paragraph.', //       12
  '', //                       13
  '- Alpha bullet', //         14
  '  - Nested bullet', //      15
  '- Beta bullet', //          16
  '', //                       17
  '```js', //                  18
  'const answer = 42', //      19
  '```', //                    20
  '', //                       21
  'Last paragraph.', //        22
  '',
].join('\n')
const TYPED = 'typed-line-e2e'

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
const lineSwitch = (w: Page) => menu(w).locator('button[aria-pressed]')
const host = (w: Page) => layer(w).locator('.editor-host')

/** Each numbered block of the visible note, in page order: its number, its tag, the first word of its text. */
const numbered = (w: Page) =>
  editorOf(w)
    .locator('[data-line]')
    .evaluateAll((blocks) =>
      blocks.map((block) => ({
        line: Number((block as HTMLElement).dataset.line),
        tag: block.tagName,
        word: document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode()?.textContent?.trim().split(/\s+/)[0] ?? '',
      })),
    )
const numbers = async (w: Page): Promise<number[]> => (await numbered(w)).map(({ line }) => line)

/** The first word of each numbered paragraph and heading must be on the line of the file ON DISK that its number names. */
async function expectWordsOnTheirDiskLines(w: Page): Promise<void> {
  const disk = (await readFile(notePath, 'utf8')).split('\n')
  const blocks = (await numbered(w)).filter(({ tag, word }) => /^(P|H[1-6])$/.test(tag) && word !== '')
  expect(blocks.length).toBeGreaterThan(0)
  for (const { line, word } of blocks) expect(disk[line - 1], `line ${line} should hold "${word}"`).toContain(word)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'pagesettings-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'pagesettings-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the cog opens the menu; "Line numbers" shows each block’s line in the file, frontmatter counted', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win).locator('p:text-is("Last paragraph.")')).toBeVisible()

  // The cog is the first chip of the row, left of the zoom pill, and the numbers start off.
  await expect(layer(win).locator('.status-chips > :first-child')).toHaveClass(/page-settings/)
  await expect(layer(win).locator('.status-chips > .page-settings + .document-zoom')).toHaveCount(1)
  await expect(editorOf(win).locator('[data-line]')).toHaveCount(0)

  await cog(win).click()
  await expect(menu(win)).toBeVisible()
  await expect(lineSwitch(win)).toHaveText(/Line numbers/)
  await expect(lineSwitch(win)).toHaveAttribute('aria-pressed', 'false')
  // The body only: 16 words in 7 blocks, 95 characters and the 6 breaks between the blocks.
  await expect(menu(win)).toContainText('16 words')
  await expect(menu(win)).toContainText('101 characters')

  await lineSwitch(win).click()
  await expect(menu(win)).toBeVisible() // the menu stays open, so the check mark shows
  await expect(lineSwitch(win)).toHaveAttribute('aria-pressed', 'true')
  await expect(host(win)).toHaveAttribute('data-line-numbers', 'true')
  // The first build starts the worker: the numbers on the page prove the built chunk loads and answers.
  await expect.poll(() => numbers(win), { timeout: 15_000 }).toEqual([6, 9, 11, 12, 13, 15, 19])
  await expectWordsOnTheirDiskLines(win)
  expect(await readFile(notePath, 'utf8')).toBe(BODY)
  await shoot(win, 'line-numbers-01-on')

  // Esc closes the menu and gives the focus back to the cog.
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  await expect(cog(win)).toBeFocused()
  expect(await numbers(win)).toEqual([6, 9, 11, 12, 13, 15, 19])
})

test('step 2 — an agent edits the file on disk; the numbers follow the new file', async () => {
  await writeFile(notePath, EDITED)

  await expect(editorOf(win)).toContainText(ADDED, { timeout: 15_000 })
  await expect.poll(() => numbers(win), { timeout: 15_000 }).toEqual([7, 9, 12, 14, 15, 16, 18, 22])
  await expectWordsOnTheirDiskLines(win)
  await expect(win.locator('.conflict-bar')).toHaveCount(0)
  expect(await readFile(notePath, 'utf8')).toBe(EDITED)
  await shoot(win, 'line-numbers-02-outside-change')
})

test('step 3 — a typed block gets its number when the save settles, from the file the save wrote', async () => {
  await editorOf(win).locator('p:text-is("Last paragraph.")').click()
  await win.keyboard.press('Meta+ArrowRight') // `End` does not move the caret on macOS (helpers.ts, typeMarkerAtLastBullet)
  await win.keyboard.press('Enter')
  await win.keyboard.type(TYPED, { delay: 5 })

  await expect.poll(async () => readFile(notePath, 'utf8'), { timeout: 10_000 }).toContain(TYPED)
  const saved = await readFile(notePath, 'utf8')
  expect(saved.startsWith('---\nstatus: done\nowner: e2e\nreviewed: true\n---\n'), saved.slice(0, 200)).toBe(true)
  // The editor wrote the body again in its own style, so the expected line comes from the saved bytes.
  const typedLine = saved.split('\n').findIndex((text) => text.includes(TYPED)) + 1
  await expect(editorOf(win).locator(`p:text-is("${TYPED}")`)).toHaveAttribute('data-line', String(typedLine), { timeout: 10_000 })
  expect(await numbers(win)).toHaveLength(9)
  await expectWordsOnTheirDiskLines(win)
  await shoot(win, 'line-numbers-03-after-save')
})

test('step 4 — the switch turns the numbers off; a second click on the cog closes the menu', async () => {
  await cog(win).click()
  await expect(lineSwitch(win)).toHaveAttribute('aria-pressed', 'true')
  await lineSwitch(win).click()
  await expect(lineSwitch(win)).toHaveAttribute('aria-pressed', 'false')
  await expect(editorOf(win).locator('[data-line]')).toHaveCount(0)
  await expect(layer(win).locator('.editor-host[data-line-numbers]')).toHaveCount(0)

  await cog(win).click()
  await expect(menu(win)).toHaveCount(0)
  expect(await readFile(notePath, 'utf8')).toContain(TYPED)
})

test('step 5 — the switch is never stored: a note closed with the numbers on opens again with them off', async () => {
  await cog(win).click()
  await lineSwitch(win).click()
  await cog(win).click()
  await expect.poll(async () => (await numbers(win)).length, { timeout: 10_000 }).toBe(9)

  // Nothing of the switch in the state file (the vault's own temp name aside; the note is `Skill.md`).
  expect(JSON.stringify(await readState(userData)).replaceAll(vault, '')).not.toMatch(/line.?numbers|page.?settings/i)

  await clickMenuItem(app, 'menu.file.close-tab', 'w1')
  await expect(layer(win).locator('.page-settings')).toHaveCount(0)
  await fileRow(win, 'Skill').click()
  await expect(editorOf(win).locator(`p:text-is("${TYPED}")`)).toBeVisible()
  await expect(layer(win).locator('.editor-host[data-line-numbers]')).toHaveCount(0)
  await expect(editorOf(win).locator('[data-line]')).toHaveCount(0)
  await cog(win).click()
  await expect(lineSwitch(win)).toHaveAttribute('aria-pressed', 'false')
  expect(JSON.stringify(await readState(userData)).replaceAll(vault, '')).not.toMatch(/line.?numbers|page.?settings/i)
})
