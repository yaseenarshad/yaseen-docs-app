/**
 * Text formatting and the table of contents down to H5, in the REAL app (YAZ-3047; decisions D1 to
 * D17 on the working log YAZ-3048):
 *  - THE SIZE OF A LEVEL (D6, D10, D12, D16): Settings › Appearance › Text formatting › "Heading 2
 *    larger", three clicks from the default 26 px, makes each H2 of the open note 29 px at once,
 *    and the vault's `.yaseendocs/text-formatting.json` holds only that change,
 *    `{ version: 1, h2: { size: 29 } }`. The app state file has no `headingStyles` key.
 *  - THE TEXT SIZE (D14, D17): "Text larger" twice makes the paragraphs 18 px; the H2 keeps its 29 px.
 *  - H4 AND H5 ROWS (D3): "TOC made from: Auto" lists the H1 to H5 of a note; an H6 is no row.
 *
 * Same harness as settings.spec.ts and tableOfContents.spec.ts: a temp `--user-data-dir`, a temp
 * vault, one seeded window. Serial: one launch, each step continuing the last.
 */
// Written for YAZ-3047 (4B, YAZ-3056), changed for YAZ-3068. Not yet run: the task did not allow a
// launch of the app, so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, editorOf, launchApp, layer, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** Enough paragraphs that each heading has a section. */
const filler = (tag: string, count: number): string => Array.from({ length: count }, (_, i) => `${tag} filler line ${i + 1}.`).join('\n\n')

/** A note of six heading levels, outside lists: Auto lists H1 to H5 of it. */
const LEVELS_NOTE = `# Level one

${filler('One', 3)}

## Level two

${filler('Two', 3)}

### Level three

${filler('Three', 3)}

#### Level four

${filler('Four', 3)}

##### Level five

${filler('Five', 3)}

###### Level six

${filler('Six', 3)}
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const settingsCog = (w: Page) => w.getByRole('button', { name: 'Settings', exact: true })
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const headingRow = (w: Page) => dialog(w).locator('[data-setting="textFormatting"]')
/** The vault's text formatting file (D10), or null while it is not there. */
const vaultFile = async (): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path.join(vault, '.yaseendocs', 'text-formatting.json'), 'utf8')) as unknown
  } catch {
    return null
  }
}
const toc = (w: Page) => layer(w).locator('nav.toc')
/** The rows of the table of contents: names when the window has room for them, else lines (the card is shut). */
const tocRows = (w: Page) => toc(w).locator(':is(.toc__name, .toc__line)')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'text-formatting-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'text-formatting-vault-'))
  notePath = path.join(vault, 'Levels.md')
  await writeFile(notePath, LEVELS_NOTE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "Heading 2 larger" three times: the H2 of the open note is 29px, and the vault file holds only { h2: { size: 29 } }', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  const h2 = editorOf(win).locator('h2', { hasText: 'Level two' })
  await expect(h2).toBeVisible()
  const fontSize = (): Promise<string> => h2.evaluate((el) => getComputedStyle(el).fontSize)
  expect(await fontSize()).not.toBe('29px')

  await settingsCog(win).click()
  await expect(dialog(win)).toBeVisible()
  // The dialog opens on Appearance, and the Text formatting group is on it; one vault, so no "Vault" dropdown.
  await expect(headingRow(win)).toBeVisible()
  await expect(headingRow(win).locator('select[aria-label="Vault"]')).toHaveCount(0)
  const h2Line = headingRow(win).locator('.heading-styles__line[data-level="h2"]')
  await expect(h2Line.locator('.heading-styles__size')).toHaveText('26 px')

  const larger = headingRow(win).getByRole('button', { name: 'Heading 2 larger', exact: true })
  for (let i = 0; i < 3; i++) await larger.click()
  await expect(h2Line.locator('.heading-styles__size')).toHaveText('29 px')

  // The note restyles at once, under the open dialog: no reload, no new editor.
  await expect.poll(fontSize).toBe('29px')
  // Only the changed level and field are stored, in the vault (D1, D10); the app state has no such key.
  await expect.poll(vaultFile).toEqual({ version: 1, h2: { size: 29 } })
  expect(Object.keys((await readState(userData)).settings)).not.toContain('headingStyles')
  await shoot(win, 'text-formatting-01-h2-29px')

  // The Text line (D14, D17): two steps make the paragraphs 18px; the H2 keeps the size the reader set.
  const paragraph = editorOf(win).locator('p', { hasText: 'Two filler line 1.' })
  const textLine = headingRow(win).locator('.heading-styles__line[data-level="text"]')
  await expect(textLine.locator('.heading-styles__size')).toHaveText('16 px')
  const textLarger = headingRow(win).getByRole('button', { name: 'Text larger', exact: true })
  for (let i = 0; i < 2; i++) await textLarger.click()
  await expect(textLine.locator('.heading-styles__size')).toHaveText('18 px')
  await expect.poll(() => paragraph.evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px')
  await expect.poll(vaultFile).toEqual({ version: 1, text: { size: 18 }, h2: { size: 29 } })
  expect(await fontSize()).toBe('29px')

  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
  expect(await fontSize()).toBe('29px')
})

test('step 2 — "TOC made from: Auto" lists the H4 and the H5 of the note, and no H6', async () => {
  await expect(toc(win)).toHaveAttribute('aria-label', 'Table of contents')
  await expect(tocRows(win)).toHaveCount(5)
  expect(await tocRows(win).evaluateAll((els) => els.map((el) => el.getAttribute('data-level')))).toEqual(['1', '2', '3', '4', '5'])
  await expect(toc(win).locator('[data-level="6"]')).toHaveCount(0)
  await shoot(win, 'text-formatting-02-toc-h4-h5')
})
