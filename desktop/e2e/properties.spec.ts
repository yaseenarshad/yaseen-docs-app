/**
 * The properties panel (⚡ YAZ-883, typed rows ⚡ YAZ-884) end-to-end against the REAL app: block
 * ONE of the note's scroller, TYPED ROWS by default with the raw-YAML block as the fallback under
 * them, both written back without disturbing a byte they did not mean to.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the panel is collapsed with the key count; expanding shows one ROW per key, and the raw
 *     block is one click under them — a save there lands on disk byte-for-byte, the comment, the
 *     quoted spacing, the `aliases` list and the BODY all surviving a round trip that only meant
 *     to change one value
 *   2 the saved text is what the panel shows after reopening the page, and broken YAML is refused
 *     in place: an inline error, and not one byte written
 *   3 a TYPED ROW edits one value SURGICALLY (the comment and every other key stay put), and a
 *     type declared from that row lands in the vault-wide registry — where the same key's column
 *     in a folder page's table picks it up (the wider arc is YAZ-885's)
 *
 * Same harness as title.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `props-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/**
 * Messy ON PURPOSE — a comment, a quoted string carrying spacing no serialiser would keep, a
 * block `aliases` list. Every one of these is something a parse→reformat write would destroy.
 */
const MESSY = `---
# how this note is filed
title: "Deep   Work"
aliases:
  - DW
status: draft
---
# Deep Work

props-note-body
`
const INTERIOR = '# how this note is filed\ntitle: "Deep   Work"\naliases:\n  - DW\nstatus: draft'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** Block ONE of the open note's scroller: the header row, the typed rows, the raw textarea, the buttons. */
const panel = (w: Page) => layer(w).locator('.frontmatter-panel')
const panelHeader = (w: Page) => panel(w).locator('.frontmatter-panel__header')
const panelRows = (w: Page) => panel(w).locator('.frontmatter-panel__row')
const panelRow = (w: Page, key: string) => panel(w).locator(`.frontmatter-panel__row[data-key="${key}"]`)
/** The one control that flips typed rows ⇄ raw YAML; its label says which way it goes. */
const modeToggle = (w: Page) => panel(w).locator('.frontmatter-panel__mode')
const yaml = (w: Page) => panel(w).locator('.frontmatter-panel__text')
const panelBtn = (w: Page, label: string) => panel(w).locator('.frontmatter-panel__btn', { hasText: label })
/** The folder page's contents table (YAZ-819) — where a declared type has to show up too. */
const contents = (w: Page) => layer(w).locator('.folder-page-contents')

const NOTE = 'Deep Work.md'
const FOLDER_PAGE = 'Topics.md'
const read = () => readFile(path.join(vault, NOTE), 'utf8')

/**
 * A folder page whose table shows the member's `status` column and declares NOTHING about it —
 * so the only thing that can type that column is the vault-wide registry the panel writes.
 */
const TOPICS = `---
folder_page: true
folder_page_settings:
  views:
    - type: table
      name: Table
      order:
        - file.name
        - note.status
---
# Topics

props-topics-body
`

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'props-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, NOTE), MESSY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the raw block edits in place, and the save is byte-for-byte the user\'s own text', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('props-note-body')

  // Block ONE: after the title, before the Crepe mount — and quiet, collapsed, counting keys.
  const blocks = await layer(win)
    .locator('.editor-host')
    .evaluate((host) => Array.from(host.children).map((c) => c.className))
  expect(blocks.slice(0, 3)).toEqual(['page-title', 'frontmatter-panel', 'editor-mount'])
  await expect(panelHeader(win)).toHaveText('Properties (3)')
  await expect(yaml(win)).toHaveCount(0)
  await shoot(win, 'props-01-collapsed')

  // Expanded lands on TYPED ROWS (⚡ YAZ-884) — one per top-level key, in the file's own order.
  await panelHeader(win).click()
  await expect(panelRows(win)).toHaveCount(3)
  await expect(panelRows(win).locator('.frontmatter-panel__key')).toHaveText(['title', 'aliases', 'status'])
  await expect(yaml(win)).toHaveCount(0)
  await shoot(win, 'props-02-rows')

  // The raw block is the fallback ONE click under them: the file's OWN bytes, comment and all —
  // not a re-serialisation of them.
  await modeToggle(win).click()
  await expect(yaml(win)).toHaveValue(INTERIOR)
  await shoot(win, 'props-03-expanded')

  // Change ONE value, keep the comment. Nothing is offered until the text actually differs.
  const edited = INTERIOR.replace('status: draft', 'status: done')
  await yaml(win).fill(edited)
  await expect(panelBtn(win, 'Save')).toBeVisible()
  await panelBtn(win, 'Save').click()

  // 🔒 VERBATIM: the whole file, byte for byte — comment kept, quoted spacing kept, list kept,
  // body untouched. Only the one value the user typed moved.
  await expect.poll(read, { timeout: 10_000 }).toBe(MESSY.replace('status: draft', 'status: done'))
  await expect(panelBtn(win, 'Save')).toHaveCount(0)
  await shoot(win, 'props-04-saved')
})

test('step 2 — the panel shows the saved text after a reopen, and broken YAML is refused in place', async () => {
  // Away and back: the panel re-derives from the freshly loaded file.
  await fileRow(win, 'Ideas').click()
  await expect(editorOf(win)).toContainText('synthetic-idea-body')
  await fileRow(win, 'Deep Work').click()
  await expect(editorOf(win)).toContainText('props-note-body')

  await expect(panelHeader(win)).toHaveText('Properties (3)')
  await panelHeader(win).click()
  await modeToggle(win).click()
  await expect(yaml(win)).toHaveValue(INTERIOR.replace('status: draft', 'status: done'))

  // A block that will not parse would corrupt every index that reads it, so the save is BLOCKED
  // — one inline error under the textarea, and the file on disk does not move.
  const before = await read()
  await yaml(win).fill('tags: [a, b\nstatus: : :')
  await panelBtn(win, 'Save').click()
  await expect(panel(win).locator('.frontmatter-panel__error')).toContainText('Not valid YAML')
  await shoot(win, 'props-05-invalid')
  expect(await read()).toBe(before)

  // 🔒 A dirty raw draft holds the door to the rows shut — the toggle asks nothing and loses nothing.
  await expect(modeToggle(win)).toBeDisabled()

  // Esc gives the disk text back, and still nothing was written.
  await yaml(win).press('Escape')
  await expect(yaml(win)).toHaveValue(INTERIOR.replace('status: draft', 'status: done'))
  await expect(modeToggle(win)).toBeEnabled()
  expect(await read()).toBe(before)
  await quitApp(app)
})

test('step 3 — a typed row writes ONE key, and a type declared there types the same column in a folder page', async () => {
  // Deep Work joins a folder page whose table shows its `status` column and declares nothing
  // about it: the only thing that can type that column is the registry the panel writes.
  const joined = (await read()).replace('status: done\n', 'status: done\nfolder_pages: "[[Topics]]"\n')
  await writeFile(path.join(vault, NOTE), joined)
  await writeFile(path.join(vault, FOLDER_PAGE), TOPICS)

  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('props-note-body')

  await panelHeader(win).click()
  await expect(panelRows(win)).toHaveCount(4)

  // ONE key, surgically: the comment, the quoted spacing, the list and the body all stay put.
  await panelRow(win, 'status').locator('[data-edit]').click()
  const field = panelRow(win, 'status').locator('[aria-label="Edit status"]')
  await field.fill('shipped')
  await field.press('Enter')
  await expect.poll(read, { timeout: 10_000 }).toBe(joined.replace('status: done', 'status: shipped'))
  await shoot(win, 'props-06-typed-row')

  // Declared HERE, vault-wide: one key is one type everywhere.
  await panelRow(win, 'status').locator('[aria-label="Type of status"]').selectOption('list')
  const registry = () => readFile(path.join(vault, '.yaseendocs', 'properties.json'), 'utf8').catch(() => '')
  await expect.poll(registry, { timeout: 10_000 }).toContain('"status"')
  // The note itself was never touched by a DECLARATION.
  expect(await read()).toBe(joined.replace('status: done', 'status: shipped'))

  // …and the folder page's own table reads that very declaration for the same key: the cell now
  // opens the LIST editor it never had before.
  await fileRow(win, 'Topics').click()
  await expect(contents(win).locator('.view-table__link')).toHaveText([NOTE])
  await contents(win).locator('[data-cell="0:1"] [data-edit]').click()
  await expect(contents(win).locator('.view-cell-edit__chips')).toBeVisible()
  await shoot(win, 'props-07-declared-column')
  await quitApp(app)
})
