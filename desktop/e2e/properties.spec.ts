/**
 * The properties panel (⚡ YAZ-883) end-to-end against the REAL app: a page's frontmatter shown as
 * raw YAML in block ONE of the note's scroller, and written back VERBATIM.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the panel is collapsed with the key count; expanding shows the file's own bytes, and a save
 *     lands on disk byte-for-byte — the comment, the quoted spacing, the `aliases` list and the
 *     BODY all survive a round trip that only meant to change one value
 *   2 the saved text is what the panel shows after reopening the page, and broken YAML is refused
 *     in place: an inline error, and not one byte written
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
/** Block ONE of the open note's scroller: the header row, the raw textarea and its two buttons. */
const panel = (w: Page) => layer(w).locator('.frontmatter-panel')
const panelHeader = (w: Page) => panel(w).locator('.frontmatter-panel__header')
const yaml = (w: Page) => panel(w).locator('.frontmatter-panel__text')
const panelBtn = (w: Page, label: string) => panel(w).locator('.frontmatter-panel__btn', { hasText: label })

const NOTE = 'Deep Work.md'
const read = () => readFile(path.join(vault, NOTE), 'utf8')

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

  // Expanded: the file's OWN bytes, comment and all — not a re-serialisation of them.
  await panelHeader(win).click()
  await expect(yaml(win)).toHaveValue(INTERIOR)
  await shoot(win, 'props-02-expanded')

  // Change ONE value, keep the comment. Nothing is offered until the text actually differs.
  const edited = INTERIOR.replace('status: draft', 'status: done')
  await yaml(win).fill(edited)
  await expect(panelBtn(win, 'Save')).toBeVisible()
  await panelBtn(win, 'Save').click()

  // 🔒 VERBATIM: the whole file, byte for byte — comment kept, quoted spacing kept, list kept,
  // body untouched. Only the one value the user typed moved.
  await expect.poll(read, { timeout: 10_000 }).toBe(MESSY.replace('status: draft', 'status: done'))
  await expect(panelBtn(win, 'Save')).toHaveCount(0)
  await shoot(win, 'props-03-saved')
})

test('step 2 — the panel shows the saved text after a reopen, and broken YAML is refused in place', async () => {
  // Away and back: the panel re-derives from the freshly loaded file.
  await fileRow(win, 'Ideas').click()
  await expect(editorOf(win)).toContainText('synthetic-idea-body')
  await fileRow(win, 'Deep Work').click()
  await expect(editorOf(win)).toContainText('props-note-body')

  await expect(panelHeader(win)).toHaveText('Properties (3)')
  await panelHeader(win).click()
  await expect(yaml(win)).toHaveValue(INTERIOR.replace('status: draft', 'status: done'))

  // A block that will not parse would corrupt every index that reads it, so the save is BLOCKED
  // — one inline error under the textarea, and the file on disk does not move.
  const before = await read()
  await yaml(win).fill('tags: [a, b\nstatus: : :')
  await panelBtn(win, 'Save').click()
  await expect(panel(win).locator('.frontmatter-panel__error')).toContainText('Not valid YAML')
  await shoot(win, 'props-04-invalid')
  expect(await read()).toBe(before)

  // Esc gives the disk text back, and still nothing was written.
  await yaml(win).press('Escape')
  await expect(yaml(win)).toHaveValue(INTERIOR.replace('status: draft', 'status: done'))
  expect(await read()).toBe(before)
  await quitApp(app)
})
