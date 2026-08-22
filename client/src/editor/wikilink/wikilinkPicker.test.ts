/**
 * The `[[` link picker (Links B, GRO-2191): real editor (`createCrepe`), typing simulated with
 * insert transactions, keys dispatched through ProseMirror's `handleKeyDown` (so Crepe's + the
 * outliner's keymaps compete for real, in priority-and-addition order). Pinned here: open on
 * `[[`, filtering through the shared matcher (cap 8), ↑/↓ wraparound, Enter/click inserting
 * plain `[[name]]` text (valid markdown, A- decorations restyle it), the Create row, alias-`|`
 * close, Esc dismiss-and-stay-closed, code exclusion, live candidate updates, and — crucially —
 * that a CLOSED picker never swallows keys (the outliner keeps Enter in lists) while an OPEN
 * one wins the priority-100 Enter tie.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { WIKILINK_CLASS } from './wikilinkPlugin'
import {
  WIKILINK_PICKER_CLASS,
  WIKILINK_PICKER_CREATE_CLASS,
  createWikilinkCandidateSource,
  type MutableWikilinkCandidateSource,
} from './wikilinkPicker'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, candidates: MutableWikilinkCandidateSource) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinkCandidates: candidates })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

function source(...names: string[]): MutableWikilinkCandidateSource {
  const s = createWikilinkCandidateSource()
  s.update(names)
  return s
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

function posOf(crepe: Crepe, text: string, offset = 0): number {
  const doc = viewOf(crepe).state.doc
  let pos = -1
  doc.descendants((node, nodePos) => {
    if (pos >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) pos = nodePos + index + offset
    return pos < 0
  })
  if (pos < 0) throw new Error(`text not found: ${text}`)
  return pos
}

function caret(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** Insert at the caret (the selection maps to the end, like real typing). */
function type(crepe: Crepe, text: string): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.insertText(text))
}

const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 }

function press(crepe: Crepe, key: 'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown'): boolean {
  const view = viewOf(crepe)
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

function popup(): HTMLElement | null {
  return document.querySelector(`.${WIKILINK_PICKER_CLASS}`)
}

function rows(): string[] {
  return Array.from(document.querySelectorAll(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).map((el) => el.textContent ?? '')
}

function selectedRow(): string | null {
  return document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"][aria-selected="true"]`)?.textContent ?? null
}

/** Flush SlashProvider's debounce(0) positioning/show pass. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll(`.${WIKILINK_PICKER_CLASS}`).forEach((el) => el.remove())
})

describe('wikilink picker: open / filter (GRO-2191)', () => {
  it('typing [[ opens the picker over every candidate; typing filters through the shared matcher', async () => {
    const { crepe } = await mount('Intro here\n', source('Alpha', 'Beta', 'alphabet soup'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[')
    await tick()
    expect(popup()?.dataset.show).toBe('true')
    expect(rows()).toEqual(['Alpha', 'Beta', 'alphabet soup'])
    expect(popup()?.getAttribute('role')).toBe('listbox')
    type(crepe, 'al')
    expect(rows()).toEqual(['Alpha', 'alphabet soup'])
  })

  it('suggestions cap at 8', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `Note ${i}`)
    const { crepe } = await mount('X\n', source(...many))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(rows()).toHaveLength(8)
  })

  it('an empty vault and an empty fragment show nothing (no popup shell)', async () => {
    const { crepe } = await mount('X\n', source())
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })

  it('candidate updates while open refresh the rows live (index refetch)', async () => {
    const s = source('Alpha')
    const { crepe } = await mount('X\n', s)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(rows()).toEqual(['Alpha'])
    s.update(['Alpha', 'Beta'])
    expect(rows()).toEqual(['Alpha', 'Beta'])
  })

  it('no picker inside code blocks or inline code (mirrors the decoration exclusions)', async () => {
    const { crepe } = await mount('```\ncode here\n```\n\nA `span x` and text\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'code here', 'code here'.length))
    type(crepe, '[[')
    expect(rows()).toEqual([])
    caret(crepe, posOf(crepe, 'span x', 'span'.length)) // inside the `span x` code span
    type(crepe, '[[')
    expect(rows()).toEqual([])
    caret(crepe, posOf(crepe, 'and text', 'and text'.length))
    type(crepe, '[[')
    expect(rows()).toEqual(['Alpha'])
  })
})

describe('wikilink picker: navigate / insert', () => {
  it('ArrowDown/ArrowUp move the highlight with wraparound', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'Beta', 'Gamma'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(selectedRow()).toBe('Alpha')
    expect(press(crepe, 'ArrowDown')).toBe(true)
    expect(selectedRow()).toBe('Beta')
    expect(press(crepe, 'ArrowUp')).toBe(true)
    expect(selectedRow()).toBe('Alpha')
    expect(press(crepe, 'ArrowUp')).toBe(true)
    expect(selectedRow()).toBe('Gamma') // wraps
  })

  it('typing more resets the highlight to the first row', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'alphabet soup'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    press(crepe, 'ArrowDown')
    expect(selectedRow()).toBe('alphabet soup')
    type(crepe, 'a')
    expect(selectedRow()).toBe('Alpha')
  })

  it('Enter replaces the trigger with valid [[wiki link]] markdown and closes; the caret lands after ]]', async () => {
    const { crepe } = await mount('Intro here\n', source('Alpha', 'Beta'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[alp')
    expect(press(crepe, 'Enter')).toBe(true)
    await tick()
    expect(getMarkdownForSave(crepe)).toBe('Intro here[[Alpha]]\n')
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
    const view = viewOf(crepe)
    expect(view.state.selection.from).toBe(posOf(crepe, '[[Alpha]]') + '[[Alpha]]'.length)
  })

  it('the inserted text renders through the A- decorations once the caret moves away', async () => {
    const { crepe, root } = await mount('Intro here\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[alp')
    press(crepe, 'Enter')
    caret(crepe, posOf(crepe, 'Intro'))
    const links = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).map((el) => el.textContent)
    expect(links).toEqual(['Alpha'])
  })

  it('a click inserts too (mousedown is prevented so the editor never blurs)', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'Beta'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    await tick()
    const beta = Array.from(document.querySelectorAll(`.${WIKILINK_PICKER_CLASS} [role="option"]`))[1] as HTMLElement
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    beta.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    beta.click()
    expect(getMarkdownForSave(crepe)).toBe('X[[Beta]]\n')
    expect(rows()).toEqual([])
  })

  it('duplicate basenames insert their disambiguated folder form', async () => {
    const { crepe } = await mount('X\n', source('Note', 'sub/Note'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[note')
    expect(rows()).toEqual(['Note', 'sub/Note'])
    press(crepe, 'ArrowDown')
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[sub/Note]]\n')
  })

  it('mid-text triggers only replace [[fragment up to the caret; trailing text stays', async () => {
    const { crepe } = await mount('before after\n', source('Alpha'))
    caret(crepe, posOf(crepe, ' after'))
    type(crepe, '[[alp')
    expect(rows()).toEqual(['Alpha'])
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('before[[Alpha]] after\n')
  })
})

describe('wikilink picker: create-new row', () => {
  it('nothing matching offers one Create row that inserts the typed text as-is', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[New Page')
    const create = document.querySelector(`.${WIKILINK_PICKER_CREATE_CLASS}`)
    expect(rows()).toEqual(['Create "New Page"'])
    expect(create?.getAttribute('aria-selected')).toBe('true')
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[New Page]]\n')
  })

  it('a whitespace-only fragment offers nothing', async () => {
    const { crepe } = await mount('X\n', source())
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[  ')
    expect(rows()).toEqual([])
  })
})

describe('wikilink picker: alias and dismissal', () => {
  it('typing | closes the suggestions (alias entry continues as plain text)', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Alpha')
    expect(rows()).toEqual(['Alpha'])
    type(crepe, '|')
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
  })

  it('Esc dismisses leaving the typed text; the same [[ stays closed while typing continues', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Al')
    expect(rows()).toEqual(['Alpha'])
    expect(press(crepe, 'Escape')).toBe(true)
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
    type(crepe, 'p')
    expect(rows()).toEqual([]) // still the dismissed [[ — no reopen
    expect(getMarkdownForSave(crepe)).toContain('[[Alp') // plain text kept as typed
  })

  it('a fresh [[ after a dismissal opens again', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Al')
    press(crepe, 'Escape')
    type(crepe, ']] and [[')
    expect(rows()).toEqual(['Alpha'])
  })
})

describe('wikilink picker: a closed picker never swallows keys', () => {
  it('Escape / arrows fall through when the picker is closed', async () => {
    const { crepe } = await mount('Plain text\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'Plain text', 'Plain text'.length))
    expect(press(crepe, 'Escape')).toBe(false)
    const before = viewOf(crepe).state.doc
    press(crepe, 'ArrowDown') // whoever handles it, the picker must not: the doc is untouched
    expect(viewOf(crepe).state.doc).toBe(before)
  })

  it('the outliner keeps Enter in lists when closed; an OPEN picker wins the priority tie', async () => {
    const { crepe } = await mount('* item\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'item', 'item'.length))
    type(crepe, ' [[alp')
    expect(rows()).toEqual(['Alpha'])
    expect(press(crepe, 'Enter')).toBe(true)
    // The picker consumed Enter: ONE list item, with the link inserted — no new item.
    expect(getMarkdownForSave(crepe)).toBe('* item [[Alpha]]\n')
    // Closed now: Enter falls through to the outliner / Crepe and creates a second item.
    expect(press(crepe, 'Enter')).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toBe('* item [[Alpha]]\n')
  })
})
