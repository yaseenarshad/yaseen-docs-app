/**
 * The change list (YAZ-3704 D3–D9): mounted Crepe, as `mergeExternal.test.ts`. The "AI" is a new body
 * applied through `applyExternalMarkdown`; the user types through real transactions; the one-line note's
 * commands go through the channel exactly as `OutsideChangesBar` sends them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { OutsideChangeGlow } from '@shared/types'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { getHeadingFoldKey, HEADING_FOLDED_ATTR, undoLastHeadingFold } from '../outline/headingFolding'
import { OUTLINE_FOLDED_ATTR, undoLastFold } from '../outline/outlineFolding'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { getZoomedItemPos } from '../outline/zoom'
import { applyExternalMarkdown, EXTERNAL_EDIT_META, OUTSIDE_RANGES_META, type OutsideRange } from './applyExternalMarkdown'
import { MAX_CHANGES, OUTSIDE_ACTIVE_CLASS, OUTSIDE_CHANGE_CLASS, OUTSIDE_CHECKED_CLASS, OUTSIDE_REMOVED_CLASS, OUTSIDE_TIP_ATTR } from './outsideChanges'
import { mergeExternalMarkdown } from './mergeExternal'
import { createOutsideChangesChannel } from './outsideChangesChannel'

const BASE = `* Parent
  * Child
* Second
  * Kid
* Leaf tail
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(defaultValue: string, opts: Omit<CreateCrepeOptions, 'root' | 'outsideChanges' | 'defaultValue'> & { glow?: OutsideChangeGlow } = {}) {
  const zoomedOut = vi.fn()
  const channel = createOutsideChangesChannel(zoomedOut)
  if (opts.glow !== undefined) channel.setGlow(opts.glow)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue, outsideChanges: channel, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view, channel, zoomedOut }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Absolute position of the first `needle` in the doc. */
const posOf = (doc: ProseNode, needle: string): number => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(needle)) found = pos + (node.text?.indexOf(needle) ?? 0)
    return found === -1
  })
  if (found === -1) throw new Error(`no "${needle}" in the doc`)
  return found
}

/** The user types `text` right before the first `before`: a real, history-recorded transaction. */
const typeBefore = (view: EditorView, before: string, text: string): void => {
  view.dispatch(view.state.tr.insertText(text, posOf(view.state.doc, before)))
}

/** The AI's save: the live note with `edit` applied, landed as a diff. */
const outsideEdit = (crepe: Crepe, edit: (md: string) => string, quiet = false): void => {
  expect(applyExternalMarkdown(crepe, edit(getMarkdownForSave(crepe)), quiet)).toBe('applied')
}

const glowTexts = (root: HTMLElement): string[] => [...root.querySelectorAll(`.${OUTSIDE_CHANGE_CLASS}`)].map((el) => el.textContent ?? '')
const activeTexts = (root: HTMLElement): string[] => [...root.querySelectorAll(`.${OUTSIDE_ACTIVE_CLASS}`)].map((el) => el.textContent ?? '')
const removedMarks = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`.${OUTSIDE_REMOVED_CLASS}`)]
const foldedEls = (root: HTMLElement): Element[] => [...root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)]
const press = (view: EditorView, key: string, keyCode: number, mod = false): void => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, metaKey: mod, bubbles: true, cancelable: true }))
}

describe('the change list (D3, D4)', () => {
  it('an outside task tick and an outside heading level change glow and count (checker 4B)', async () => {
    const { crepe, channel } = await mount('## Section\n\n- [ ] task one\n- [ ] task two\n')
    outsideEdit(crepe, (md) => md.replace('[ ] task one', '[x] task one').replace('## Section', '### Section'))
    expect(channel.getState().count).toBe(2)
  })

  it('glows the changed words; the count is the changed textblocks, and two ranges in one line are one change', async () => {
    const { crepe, root, view, channel } = await mount('Alpha one\n\nBeta two\n\nGamma three\n')
    outsideEdit(crepe, (md) => md.replace('Alpha one', 'Alpha ONE').replace('Gamma three', 'Gamma THREE'))
    expect(glowTexts(root)).toEqual(['ONE', 'THREE'])
    expect(channel.getState()).toEqual({ count: 2, wholeNote: false })
    // Two ranges in one line ("Beta" and "two"), as one outside transaction says them.
    const beta = posOf(view.state.doc, 'Beta')
    const ranges: OutsideRange[] = [
      { from: beta, to: beta + 4, removed: '' },
      { from: beta + 5, to: beta + 8, removed: '' },
    ]
    view.dispatch(view.state.tr.setMeta(EXTERNAL_EDIT_META, true).setMeta(OUTSIDE_RANGES_META, ranges))
    expect(channel.getState().count).toBe(3)
    expect(glowTexts(root)).toEqual(['ONE', 'Beta', 'two', 'THREE'])
  })

  it('a merge over unsaved typing glows the outside words only, never the typing', async () => {
    const { crepe, root, view, channel } = await mount(BASE)
    typeBefore(view, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf tail EXTERNAL'))).toBe('merged')
    expect(getMarkdownForSave(crepe)).toContain('USER-Child')
    expect(glowTexts(root)).toEqual([' EXTERNAL'])
    expect(channel.getState().count).toBe(1)
  })

  it("an outside edit of a heading's text still glows and counts after Milkdown's heading-id sync (YAZ-3844)", async () => {
    const { crepe, root, view, channel } = await mount('## Title here\n\nBody text.\n')
    const idBefore = view.state.doc.firstChild?.attrs.id
    outsideEdit(crepe, (md) => md.replace('Title here', 'Title there'))
    // The sync ran: the heading's id follows its new text, in a transaction kept out of the history.
    expect(view.state.doc.firstChild?.attrs.id).not.toBe(idBefore)
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root).join('')).not.toBe('')
    expect(root.querySelector(`.${OUTSIDE_CHANGE_CLASS}`)?.closest('h2')?.textContent).toContain('Title there')
    // One more transaction (a caret move) checks nothing off either.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view.state.doc, 'Body'))))
    expect(channel.getState().count).toBe(1)
  })

  it('removed marks do not pile up: one for each place (the newest), at most five for each change (YAZ-3844)', async () => {
    const { crepe, root, view, channel } = await mount('The cat sat on the mat by the big red door.\n\nOther line.\n')
    for (const [from, to] of [['cat', 'dog'], ['dog', 'cow'], ['cow', 'pig'], ['pig', 'hen']]) outsideEdit(crepe, (md) => md.replace(from, to))
    expect(channel.getState().count).toBe(1)
    expect(removedMarks(root).map((mark) => mark.getAttribute(OUTSIDE_TIP_ATTR))).toEqual(['Removed: pig'])
    // Six removals at six places in one line: the newest five marks stay.
    const words = ['The', 'sat', 'mat', 'big', 'red', 'door']
    const ranges: OutsideRange[] = words.map((word) => {
      const at = posOf(view.state.doc, word)
      return { from: at, to: at, removed: `${word}!` }
    })
    for (const range of ranges) view.dispatch(view.state.tr.setMeta(EXTERNAL_EDIT_META, true).setMeta(OUTSIDE_RANGES_META, [range]))
    expect(channel.getState().count).toBe(1)
    expect(removedMarks(root).map((mark) => mark.getAttribute(OUTSIDE_TIP_ATTR))).toEqual(['Removed: sat!', 'Removed: mat!', 'Removed: big!', 'Removed: red!', 'Removed: door!'])
  })

  it('inserted bullets: one change for each inserted textblock', async () => {
    const { crepe, root, channel } = await mount(BASE)
    outsideEdit(crepe, (md) => md.replace('* Leaf tail', '* New one\n* New two\n* Leaf tail'))
    expect(channel.getState().count).toBe(2)
    expect(glowTexts(root)).toEqual(['New one', 'New two'])
  })

  it('removed text is one thin red mark with the tip "Removed: …", never part of the saved note', async () => {
    const { crepe, root, channel } = await mount('The cat sat on the mat.\n\nOther line.\n')
    outsideEdit(crepe, (md) => md.replace('cat ', ''))
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toEqual([])
    const marks = removedMarks(root)
    expect(marks).toHaveLength(1)
    expect(marks[0].getAttribute(OUTSIDE_TIP_ATTR)).toMatch(/^Removed: .*cat/)
    expect(marks[0].contentEditable).toBe('false')
    expect(getMarkdownForSave(crepe)).toBe('The sat on the mat.\n\nOther line.\n')
  })

  it('a removed bullet is a line between the blocks, and a long removed text is cut at 200 chars', async () => {
    const long = 'x'.repeat(250)
    // The kept text is longer than the removed one: one range over 80% of the note would be a rewrite.
    const { crepe, root } = await mount(`* Keep ${'k'.repeat(400)}\n* ${long}\n* Last\n`)
    outsideEdit(crepe, (md) => md.replace(`* ${long}\n`, ''))
    const [mark] = removedMarks(root)
    expect(mark.className).toContain(`${OUTSIDE_REMOVED_CLASS}--between`)
    expect(mark.getAttribute(OUTSIDE_TIP_ATTR)).toBe(`Removed: ${'x'.repeat(200)}…`)
    expect(getMarkdownForSave(crepe)).not.toContain('x')
  })

  it('typing ABOVE a change keeps the glow on the same words', async () => {
    const { crepe, root, view, channel } = await mount(BASE)
    outsideEdit(crepe, (md) => md.replace('Leaf tail', 'Leaf tail grown'))
    expect(glowTexts(root)).toEqual([' grown'])
    typeBefore(view, 'Parent', 'Typed above ')
    expect(glowTexts(root)).toEqual([' grown'])
    expect(channel.getState().count).toBe(1)
  })

  it('typing INSIDE a change checks it off; an undo puts nothing back and takes nothing else; a quiet apply adds nothing', async () => {
    const { crepe, root, view, channel } = await mount(BASE)
    outsideEdit(crepe, (md) => md.replace('Child', 'Child grown').replace('Leaf tail', 'Leaf tail grown'))
    expect(channel.getState().count).toBe(2)
    typeBefore(view, 'Leaf tail', 'mine ')
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toEqual([' grown'])
    expect(root.querySelector(`.${OUTSIDE_CHANGE_CLASS}`)?.closest('li')?.textContent).toContain('Child grown')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).not.toContain('mine ')
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toEqual([' grown'])
    outsideEdit(crepe, (md) => md.replace('Second', 'Second from my other tab'), true)
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toEqual([' grown'])
  })
})

describe('the Before hover (YAZ-3947)', () => {
  const glowTitles = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>(`.${OUTSIDE_CHANGE_CLASS}`)].map((el) => el.getAttribute(OUTSIDE_TIP_ATTR) ?? '')

  it('a glowing change shows its line as it was before the outside edit; a new line says so', async () => {
    const { crepe, root } = await mount('* Call the bank\n* Send the invoice to Sam\n* Book the room\n')
    outsideEdit(crepe, (md) => md.replace('Send the invoice', 'Send the signed invoice').replace('* Book the room', '* Charge the camera\n* Book the room'))
    expect(glowTexts(root)).toEqual(['signed ', 'Charge the camera'])
    expect(glowTitles(root)).toEqual(['Before: Send the invoice to Sam', 'New line'])
    // Shown at once by CSS on :hover, never as a native title (that waits about a second, and two would show).
    expect(root.querySelector(`.${OUTSIDE_CHANGE_CLASS}`)?.getAttribute('title')).toBeNull()
  })

  it('a merge shows the line as it was on screen; a second outside edit of the line keeps the first Before', async () => {
    const { crepe, root, view } = await mount(BASE)
    typeBefore(view, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf tail EXTERNAL'))).toBe('merged')
    expect(glowTitles(root)).toEqual(['Before: Leaf tail'])
    outsideEdit(crepe, (md) => md.replace('Leaf tail EXTERNAL', 'Leaf tail EXTERNAL AGAIN'))
    expect(glowTexts(root)).toEqual([' EXTERNAL', ' AGAIN'])
    expect(glowTitles(root)).toEqual(['Before: Leaf tail', 'Before: Leaf tail'])
  })

  it('an edit at the very START of a changed line keeps the change: its glow and its first Before (checker on YAZ-3947)', async () => {
    const { crepe, root, view, channel } = await mount('* Alpha one\n* Other line\n')
    outsideEdit(crepe, (md) => md.replace('Alpha one', 'Alpha one X'))
    outsideEdit(crepe, (md) => md.replace('Alpha one X', 'Beta one X'))
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toContain(' X')
    expect(glowTitles(root)).toEqual(glowTitles(root).map(() => 'Before: Alpha one'))
    // An undo of the user's own text at the start of a changed line checks nothing off; nor does a quiet apply there.
    typeBefore(view, 'Other', 'U-')
    outsideEdit(crepe, (md) => md.replace('U-Other line', 'U-Other line Y'))
    undo(view.state, view.dispatch)
    expect(glowTexts(root)).toContain(' Y')
    outsideEdit(crepe, (md) => md.replace('Other line Y', 'Mine Other line Y'), true)
    expect(glowTexts(root)).toContain(' Y')
    expect(channel.getState().count).toBe(2)
  })

  it('a task tick and a heading level show what they were, and a long line is cut at 200 chars', async () => {
    const long = 'y'.repeat(250)
    const { crepe, root } = await mount(`## Section\n\n- [ ] task one\n- [ ] task two\n\n${long}\n`)
    outsideEdit(crepe, (md) => md.replace('[ ] task one', '[x] task one').replace('## Section', '### Section').replace(long, `${long} z`))
    expect(glowTitles(root)).toEqual(['Before: ## Section', 'Before: [ ] task one', `Before: ${'y'.repeat(200)}…`])
  })
})

describe('checking off (D8)', () => {
  it('Checked on one change removes only that one, and keeps the caret; Mark all checked empties the list', async () => {
    const { crepe, root, view, channel } = await mount(BASE)
    outsideEdit(crepe, (md) => md.replace('Child', 'Child grown').replace('Kid', 'Kid big').replace('Leaf tail', 'Leaf tail long'))
    expect(channel.getState().count).toBe(3)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view.state.doc, 'Second') + 2)))
    const caret = view.state.selection.from
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTSIDE_CHECKED_CLASS}`)]
    expect(buttons.map((b) => b.textContent)).toEqual(['Checked', 'Checked', 'Checked'])
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    buttons[1].dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    buttons[1].click()
    expect(channel.getState().count).toBe(2)
    expect(glowTexts(root)).toEqual([' grown', ' long'])
    expect(view.state.selection.from).toBe(caret)
    channel.clear()
    expect(channel.getState()).toEqual({ count: 0, wholeNote: false })
    expect(glowTexts(root)).toEqual([])
    expect(root.querySelectorAll(`.${OUTSIDE_CHECKED_CLASS}`)).toHaveLength(0)
  })

  it(`more than ${MAX_CHANGES} changes: whole-note mode, with no glow; a rebuild says whole note too, and Dismiss clears it`, async () => {
    const lines = Array.from({ length: MAX_CHANGES + 1 }, (_, i) => `line ${i}`)
    const { crepe, root, channel } = await mount(`${lines.join('\n\n')}\n`)
    outsideEdit(crepe, (md) => md.replace(/line (\d+)/g, 'line $1 edited'))
    expect(channel.getState()).toEqual({ count: 0, wholeNote: true })
    expect(root.querySelectorAll(`.${OUTSIDE_CHANGE_CLASS}`)).toHaveLength(0)
    channel.clear()
    expect(channel.getState().wholeNote).toBe(false)
    // The host's word after a rebuild (`reload` got 'rebuilt').
    channel.markWholeNote()
    expect(channel.getState()).toEqual({ count: 0, wholeNote: true })
    channel.clear()
    expect(channel.getState().wholeNote).toBe(false)
  })
})

describe('the Glow setting (D5)', () => {
  it("'off' draws nothing and counts nothing; the merge still lands", async () => {
    const { crepe, root, channel } = await mount(BASE, { glow: 'off' })
    outsideEdit(crepe, (md) => md.replace('Child', 'Child grown'))
    expect(getMarkdownForSave(crepe)).toContain('Child grown')
    expect(channel.getState().count).toBe(0)
    expect(root.querySelectorAll(`.${OUTSIDE_CHANGE_CLASS}, .${OUTSIDE_CHECKED_CLASS}`)).toHaveLength(0)
    channel.markWholeNote()
    expect(channel.getState().wholeNote).toBe(false)
  })

  it("'10s': each change checks itself off when its own 10 s end; turning Off live clears the rest", async () => {
    const { crepe, root, channel } = await mount(BASE, { glow: '10s' })
    vi.useFakeTimers()
    outsideEdit(crepe, (md) => md.replace('Child', 'Child grown'))
    vi.advanceTimersByTime(4_000)
    outsideEdit(crepe, (md) => md.replace('Leaf tail', 'Leaf tail long'))
    expect(channel.getState().count).toBe(2)
    vi.advanceTimersByTime(5_999)
    expect(channel.getState().count).toBe(2)
    vi.advanceTimersByTime(1)
    expect(channel.getState().count).toBe(1)
    expect(glowTexts(root)).toEqual([' long'])
    channel.setGlow('off')
    expect(channel.getState().count).toBe(0)
    expect(glowTexts(root)).toEqual([])
  })
})

describe('whole-note mode and the Glow time (YAZ-3844)', () => {
  it("a timed Glow ends whole-note mode after that time; until checked keeps it until Dismiss; Off shows nothing", async () => {
    const { channel } = await mount(BASE, { glow: '10s' })
    vi.useFakeTimers()
    channel.markWholeNote()
    expect(channel.getState()).toEqual({ count: 0, wholeNote: true })
    vi.advanceTimersByTime(9_999)
    expect(channel.getState().wholeNote).toBe(true)
    vi.advanceTimersByTime(1)
    expect(channel.getState().wholeNote).toBe(false)

    channel.setGlow('until-checked')
    channel.markWholeNote()
    vi.advanceTimersByTime(120_000)
    expect(channel.getState().wholeNote).toBe(true)
    // A timed value picked while the line shows starts its time now.
    channel.setGlow('60s')
    vi.advanceTimersByTime(59_999)
    expect(channel.getState().wholeNote).toBe(true)
    vi.advanceTimersByTime(1)
    expect(channel.getState().wholeNote).toBe(false)

    channel.setGlow('off')
    channel.markWholeNote()
    expect(channel.getState().wholeNote).toBe(false)
  })
})

describe('Next change (D9)', () => {
  it('opens the collapsed bullet that hides the second change silently, rings it, and folds it again on the next Next', async () => {
    const doc = '* Top line\n* Parent\n  * Child\n* Leaf tail\n'
    const { crepe, root, view, channel } = await mount(doc, { folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) } })
    expect(foldedEls(root)).toHaveLength(1)
    typeBefore(view, 'Leaf tail', 'USER-')
    outsideEdit(crepe, (md) => md.replace('Top line', 'Top line grown').replace('Child', 'Child grown'))
    const selection = view.state.selection

    channel.next()
    expect(activeTexts(root)).toEqual([' grown'])
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('li')?.textContent).toContain('Top line')
    expect(foldedEls(root)).toHaveLength(1)

    channel.next()
    expect(foldedEls(root)).toHaveLength(0)
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('p')?.textContent).toContain('Child grown')
    expect(view.state.selection.eq(selection)).toBe(true)
    // Silent: ⌘Z still undoes the user's typing, never the unfold.
    expect(undoLastFold(view.state)).toBe(false)
    expect(undoLastHeadingFold(view.state)).toBe(false)
    press(view, 'z', 90, true)
    expect(getMarkdownForSave(crepe)).not.toContain('USER-')
    expect(foldedEls(root)).toHaveLength(0)

    channel.next()
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('li')?.textContent).toContain('Top line')
    expect(foldedEls(root)).toHaveLength(1)
  })

  it('Mark all checked keeps the landing open: the bullet Next opened for the active change stays open (YAZ-3844)', async () => {
    const doc = '* Top line\n* Parent\n  * Child\n* Fruit\n  * Kiwi\n* Leaf tail\n'
    const folds = new Set([getOutlineFoldKey('Parent', 0), getOutlineFoldKey('Fruit', 0)])
    const { crepe, root, channel } = await mount(doc, { folding: { seedCollapsedKeys: () => folds } })
    expect(foldedEls(root)).toHaveLength(2)
    outsideEdit(crepe, (md) => md.replace('Child', 'Child grown').replace('Kiwi', 'Kiwi ripe'))
    channel.next()
    expect(foldedEls(root)).toHaveLength(1)
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('p')?.textContent).toContain('Child grown')
    channel.clear()
    expect(channel.getState()).toEqual({ count: 0, wholeNote: false })
    // Parent (the landing) stays open; Fruit, which Next never opened, stays folded.
    const folded = foldedEls(root)
    expect(folded).toHaveLength(1)
    expect(folded[0].textContent).toContain('Kiwi')
    expect(folded[0].textContent).not.toContain('Child')
  })

  it('opens the folded heading that hides a change silently, and folds it again on the next Next', async () => {
    const doc = '# Summary\n\nTop line\n\n## Details\n\nWe fly on Monday.\n'
    const { crepe, root, view, channel } = await mount(doc, { headingFolding: { seedCollapsedKeys: () => new Set([getHeadingFoldKey('Details', 0)]) } })
    const headingFolded = () => root.querySelectorAll(`[${HEADING_FOLDED_ATTR}]`).length
    const foldedBefore = headingFolded()
    expect(foldedBefore).toBeGreaterThan(0)
    outsideEdit(crepe, (md) => md.replace('Top line', 'Top line grown').replace('Monday', 'Tuesday'))
    const selection = view.state.selection
    channel.next() // the first change, above the heading
    expect(headingFolded()).toBe(foldedBefore)
    channel.next() // the change under the folded heading
    expect(headingFolded()).toBe(0)
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('p')?.textContent).toContain('Tuesday')
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(undoLastHeadingFold(view.state)).toBe(false)
    channel.next() // back to the first: the heading folds again
    expect(headingFolded()).toBe(foldedBefore)
  })

  it('a change outside the zoomed bullet zooms out first, and the host hears it', async () => {
    const doc = '* Alpha\n  * Inside\n* Beta\n  * Outside\n'
    const { crepe, root, view, channel, zoomedOut } = await mount(doc, { zoom: { title: () => 'Note' } })
    outsideEdit(crepe, (md) => md.replace('Inside', 'Inside grown').replace('Outside', 'Outside grown'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view.state.doc, 'Alpha') + 1)))
    press(view, '.', 190, true) // Mod-. zooms into the caret's bullet
    expect(getZoomedItemPos(view.state)).not.toBeNull()

    channel.next()
    expect(getZoomedItemPos(view.state)).not.toBeNull()
    expect(zoomedOut).not.toHaveBeenCalled()

    channel.next()
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(zoomedOut).toHaveBeenCalledTimes(1)
    expect(root.querySelector(`.${OUTSIDE_ACTIVE_CLASS}`)?.closest('p')?.textContent).toContain('Outside grown')
  })
})
