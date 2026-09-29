/**
 * BIG-NOTE CORRECTNESS (YAZ-2171, the parity lock for the editor-speed work of YAZ-2131 4B/4C):
 * a 5,000-line mixed note and a 5,000-line heading-dense note, opened in the REAL app, must come up
 * exactly as they do today — the caret where the open leaves it, every fold chevron, the bullet
 * threading on the caret's path, and every wikilink decorated and resolved.
 *
 * Why only the real app can say this: the open is the whole Crepe stack at once — one Vue app per
 * list item, each scheduling its own caret restore (renderer-smoothness F1), the wikilink, fold and
 * threading plugins recomputing on each of those transactions (F2, F3), and the index snapshot
 * arriving to resolve the links. The speed work changes HOW OFTEN those run, never WHAT they end on;
 * this spec pins the end state, with every expected count derived from the generated markdown.
 *
 * The notes are the renderer-smoothness bench shape (`gen.py`'s `mixed`), written deterministically
 * here: `## Section` headings, paragraphs with `[[Note k]]` links, three-level bullets (the parent
 * and the middle child each own a chevron), task pairs, and a code block now and then. Every link
 * target exists, so every link must end up resolved.
 *
 * Today a 5k open freezes the renderer for ~20 s (F1), so the steps carry long timeouts. They pin
 * correctness, never time: the budgets live in the perf harness, not here.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, editorOf, launchApp, layer, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const WORDS = 'alpha beta gamma delta outline bullet heading vault note sync render frame layout paint budget typing latency editor tree'.split(' ')
const SENTINEL = 'END-SENTINEL'
const LINK_TARGETS = 200

/** What a generated note must render as — counted while it is written, never by reading the DOM. */
interface NoteShape {
  markdown: string
  headings: number
  listItems: number
  /** Items with nested children: the parent and its first child, per bullet group. */
  foldableItems: number
  links: number
}

/** A deterministic sentence: the same (i, n) always gives the same words. */
function sentence(i: number, n: number): string {
  const words = Array.from({ length: n }, (_, j) => WORDS[(i * 7 + j * 3) % WORDS.length])
  const text = words.join(' ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

/** `gen.py`'s `mixed`, deterministic: a section heading every `headingEvery` groups. */
function mixedNote(linesTarget: number, headingEvery: number): NoteShape {
  const out: string[] = []
  const shape = { headings: 0, listItems: 0, foldableItems: 0, links: 0 }
  for (let i = 0; out.length < linesTarget; i++) {
    if (i % headingEvery === 0) {
      shape.headings++
      out.push(`## Section ${shape.headings}`, '')
    }
    const kind = i % 6
    if (kind === 0) {
      const link = i % 7 === 0 ? ` See [[Note ${i % LINK_TARGETS}]] and **bold** text.` : ''
      if (link !== '') shape.links++
      out.push(sentence(i, 12) + link, '')
    } else if (kind <= 3) {
      out.push(`* Parent ${i} ${sentence(i, 6)}`, `  * Child ${i}a ${sentence(i, 5)}`, `    * Grandchild ${i} ${sentence(i, 4)}`, `  * Child ${i}b [[Note ${i % 50}]]`)
      shape.listItems += 4
      shape.foldableItems += 2
      shape.links++
    } else if (kind === 4) {
      out.push(`* [ ] Task ${i} ${sentence(i, 5)}`, `* [x] Done ${i} ${sentence(i, 4)}`)
      shape.listItems += 2
    } else if (i % 30 === 5) {
      out.push('```js', `const x${i} = ${i}`, '```', '')
    } else {
      out.push(sentence(i, 20), '')
    }
  }
  out.push(SENTINEL)
  return { markdown: `${out.join('\n')}\n`, ...shape }
}

const MIXED_FILE = 'doc-5k.md'
const HEADINGS_FILE = 'headings-5k.md'
const MIXED = mixedNote(5000, 25)
const HEADINGS = mixedNote(5000, 2)

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const listItems = (w: Page) => editorOf(w).locator('.milkdown-list-item-block')
/** A line by its leading text — a RegExp, because `hasText` trims and `Parent 1 ` would match `Parent 13`. */
const lineOf = (w: Page, start: RegExp) => editorOf(w).locator('p', { hasText: start })

/** The caret as the open leaves it: the editor focused, and the collapsed DOM selection's block + offset. */
const caretAtOpen = (w: Page) =>
  w.evaluate(() => {
    const active = document.activeElement
    const sel = document.getSelection()
    if (active === null || !active.classList.contains('ProseMirror') || sel === null || sel.anchorNode === null) return null
    const node = sel.anchorNode
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const block = el?.closest('h1, h2, h3, h4, h5, h6, p') ?? null
    if (block === null) return null
    const range = document.createRange()
    range.selectNodeContents(block)
    range.setEnd(node, sel.anchorOffset)
    return { tag: block.tagName, text: block.textContent ?? '', offset: range.toString().length, collapsed: sel.isCollapsed }
  })

/** Everything the open must end on, for a note of `shape` — the parity claim itself. */
async function expectRenderedAsToday(w: Page, shape: NoteShape): Promise<void> {
  await expect(editorOf(w)).toContainText(SENTINEL, { timeout: 180_000 })
  await expect(editorOf(w).locator('h2')).toHaveCount(shape.headings)
  await expect(listItems(w)).toHaveCount(shape.listItems)
  // Every H2 owns a non-empty section, so every one has a chevron; every item with children has one.
  await expect(editorOf(w).locator('.heading-toggle')).toHaveCount(shape.headings)
  await expect(editorOf(w).locator('.outline-toggle')).toHaveCount(shape.foldableItems)
  // Every link is decorated (the caret touches none of them) and, once the index lands, resolved.
  await expect(editorOf(w).locator('.wikilink')).toHaveCount(shape.links)
  await expect(editorOf(w).locator('.wikilink--unresolved')).toHaveCount(0, { timeout: 30_000 })
  // The open leaves the caret at the very start: the first heading, offset 0, so no bullet is threaded.
  await expect.poll(() => caretAtOpen(w)).toEqual({ tag: 'H2', text: 'Section 1', offset: 0, collapsed: true })
  await expect(editorOf(w).locator('.outline-thread-node')).toHaveCount(0)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'bignote-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'bignote-vault-'))
  await writeFile(path.join(vault, MIXED_FILE), MIXED.markdown)
  await writeFile(path.join(vault, HEADINGS_FILE), HEADINGS.markdown)
  await mkdir(path.join(vault, 'notes'))
  for (let k = 0; k < LINK_TARGETS; k++) await writeFile(path.join(vault, 'notes', `Note ${k}.md`), `# Note ${k}\n\n${sentence(k, 10)}\n`)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the 5k mixed note opens with every heading, bullet, chevron and resolved link, caret at the start', async () => {
  test.setTimeout(300_000)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, MIXED_FILE)) })
  win = await appWindow(app, 'w1')
  await expectRenderedAsToday(win, MIXED)
  // Opening is not an edit: the bytes on disk are what was written.
  expect(await readFile(path.join(vault, MIXED_FILE), 'utf8')).toBe(MIXED.markdown)
  await shoot(win, 'bignote-01-mixed-open')
})

test('step 2 — a caret in a grandchild threads its three-bullet path; folding a parent hides its branch and persists the key', async () => {
  test.setTimeout(120_000)
  await lineOf(win, /^Grandchild 1 /).click()
  const thread = editorOf(win).locator('.outline-thread-node')
  await expect(thread).toHaveCount(3)
  // Each threaded item's OWN line (its first paragraph; the rest of its text is its children's).
  await expect(thread.nth(0).locator('p').first()).toHaveText(/^Parent 1 /)
  await expect(thread.nth(1).locator('p').first()).toHaveText(/^Child 1a /)
  await expect(thread.nth(2).locator('p').first()).toHaveText(/^Grandchild 1 /)

  await editorOf(win).locator('button.outline-toggle[aria-label^="Collapse Parent 1 "]').click()
  await expect(editorOf(win).locator('button.outline-toggle[aria-label^="Expand Parent 1 "]')).toHaveAttribute('aria-expanded', 'false')
  await expect(lineOf(win, /^Child 1b /)).toBeHidden()
  await expect(lineOf(win, /^Parent 2 /)).toBeVisible()
  await expect
    .poll(async () => (await readState(userData)).folders[vault]?.folds[path.join(vault, MIXED_FILE)] ?? [], { timeout: 10_000 })
    .toHaveLength(1)
  await shoot(win, 'bignote-02-threaded-and-folded')
})

test('step 3 — quit → relaunch: the fold comes back on the same 5k note, and the rest renders exactly as before', async () => {
  test.setTimeout(300_000)
  await quitApp(app)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(SENTINEL, { timeout: 180_000 })
  await expect(editorOf(win).locator('button.outline-toggle[aria-label^="Expand Parent 1 "]')).toHaveAttribute('aria-expanded', 'false')
  await expect(lineOf(win, /^Child 1b /)).toBeHidden()
  await expect(editorOf(win).locator('.outline-toggle')).toHaveCount(MIXED.foldableItems)
  await expect(editorOf(win).locator('.wikilink')).toHaveCount(MIXED.links)
  await shoot(win, 'bignote-03-fold-restored')
})

test('step 4 — the 5k heading-dense note opens with a chevron per section; folding one hides exactly its body', async () => {
  test.setTimeout(300_000)
  await quitApp(app)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, HEADINGS_FILE)) })
  win = await appWindow(app, 'w1')
  await expectRenderedAsToday(win, HEADINGS)

  // A heading every two groups: Section 2 holds the bullet groups of Parents 2 and 3, and
  // Section 3 starts at group 4, the first task pair.
  await editorOf(win).locator('h2', { hasText: /^Section 2$/ }).hover()
  await editorOf(win).locator('.heading-toggle[aria-label="Collapse Section 2"]').click()
  await expect(lineOf(win, /^Parent 2 /)).toBeHidden()
  await expect(lineOf(win, /^Parent 3 /)).toBeHidden()
  await expect(editorOf(win).locator('h2', { hasText: /^Section 3$/ })).toBeVisible()
  await expect(lineOf(win, /^Task 4 /)).toBeVisible()
  await expect
    .poll(async () => (await readState(userData)).folders[vault]?.folds[path.join(vault, HEADINGS_FILE)] ?? [], { timeout: 10_000 })
    .toEqual([expect.stringMatching(/^h:/)])
  expect(await readFile(path.join(vault, HEADINGS_FILE), 'utf8')).toBe(HEADINGS.markdown)
  await shoot(win, 'bignote-04-headings-folded')
  await quitApp(app)
})
