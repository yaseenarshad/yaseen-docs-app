/**
 * The merge of an outside edit into unsaved typing (YAZ-3704 D1, D2). Mounted Crepe, as the
 * external-apply contract tests: the base is the body as last saved, the user types through real
 * transactions, and the "AI" is a new body for the same file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { Transaction } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from '../outline/outlineFolding'
import { applyExternalMarkdown, OUTSIDE_RANGES_META, type OutsideRange } from './applyExternalMarkdown'
import { mergeExternalMarkdown } from './mergeExternal'

const BASE = `* Parent
  * Child
* Second
  * Kid
* Leaf tail
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(defaultValue = BASE): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The user types `text` right before the first `before` in the doc: a real, history-recorded transaction. */
const typeBefore = (crepe: Crepe, before: string, text: string): void => {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let target = -1
    view.state.doc.descendants((node, pos) => {
      if (target === -1 && node.isText && node.text?.includes(before)) target = pos + (node.text?.indexOf(before) ?? 0)
      return target === -1
    })
    if (target === -1) throw new Error(`no "${before}" in the doc`)
    view.dispatch(view.state.tr.insertText(text, target))
  })
}

/** Every transaction the view dispatches from now on. */
const spyDispatch = (crepe: Crepe): Transaction[] => {
  const seen: Transaction[] = []
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const real = view.dispatch.bind(view)
    vi.spyOn(view, 'dispatch').mockImplementation((tr: Transaction) => {
      seen.push(tr)
      real(tr)
    })
  })
  return seen
}

describe('mergeExternalMarkdown (YAZ-3704 D1)', () => {
  it('merges a paragraph the outside edit adds right before a heading while the typing is elsewhere (checker 4A)', async () => {
    const base = 'Intro line\n\n## Section\n\nBody line\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Body line', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, base.replace('## Section', 'New para\n\n## Section'))).toBe('merged')
    expect(getMarkdownForSave(crepe)).toContain('USER-Body line')
    expect(getMarkdownForSave(crepe)).toContain('New para')
  })

  it('lands nothing when the new file equals the live note, also when the note has a heading (checker 4A)', async () => {
    const base = '# Title\n\nAlpha\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Alpha', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, getMarkdownForSave(crepe))).toBe('unchanged')
  })

  it('a task the outside edit ticks is a conflict when you type in it, and merges when you type in another (D2, checker 4D)', async () => {
    const base = '- [ ] task one\n- [ ] task two\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'task one', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, base.replace('[ ] task one', '[x] task one'))).toBe('conflict')
    expect(mergeExternalMarkdown(crepe, base, base.replace('[ ] task two', '[x] task two'))).toBe('merged')
    expect(getMarkdownForSave(crepe)).toContain('USER-task one')
    expect(getMarkdownForSave(crepe)).toContain('[x] task two')
  })

  it('a heading level the outside edit changes is a conflict when you type in that heading (D2, checker 4D)', async () => {
    const base = '## Plan\n\nBody\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Plan', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, base.replace('## Plan', '### Plan'))).toBe('conflict')
  })

  it('merges an outside edit of another line: both edits stay', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf tail EXTERNAL'))).toBe('merged')
    const md = getMarkdownForSave(crepe)
    expect(md).toContain('USER-Child')
    expect(md).toContain('Leaf tail EXTERNAL')
  })

  it('merges an outside edit ABOVE the typing: the typing moves down with its text', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Leaf tail', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('* Parent\n', '* Parent with a much longer name\n'))).toBe('merged')
    const md = getMarkdownForSave(crepe)
    expect(md).toContain('Parent with a much longer name')
    expect(md).toContain('USER-Leaf tail')
  })

  it('merges a bullet the outside edit added right after the line being typed in', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('  * Child\n', '  * Child\n  * New kid\n'))).toBe('merged')
    const md = getMarkdownForSave(crepe)
    expect(md).toContain('USER-Child')
    expect(md).toContain('New kid')
  })

  it('refuses an outside edit of the SAME line (D2): nothing changes, the caller shows the bar', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    const before = getMarkdownForSave(crepe)
    // The edit is at the other end of the line: characters never overlap, the block does.
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('  * Child', '  * Child changed'))).toBe('conflict')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('refuses a rewrite of the line the typing ends: "The cat sat" + " on the mat" vs "A dog ran"', async () => {
    const base = 'The cat sat.\n\nAnother paragraph.\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, '.', ' on the mat')
    expect(mergeExternalMarkdown(crepe, base, 'A dog ran.\n\nAnother paragraph.\n')).toBe('conflict')
    expect(getMarkdownForSave(crepe)).toContain('The cat sat on the mat.')
  })

  it('refuses a whole-note rewrite while there is typing', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, '# Entirely different\n\nNothing in common.\n')).toBe('conflict')
    expect(getMarkdownForSave(crepe)).toContain('USER-Child')
  })

  it('refuses a rewrite even when the typing sits in a block the rewrite left alone', async () => {
    const long = 'The first paragraph says many things about the project and its plan. '.repeat(12).trim()
    const base = `${long}\n\nShort tail.\n`
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Short tail', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, `${'An entirely different text written by someone else. '.repeat(12).trim()}\n\nShort tail.\n`)).toBe('conflict')
    expect(getMarkdownForSave(crepe)).toContain('USER-Short tail')
  })

  it('merges an item added at the top of an ordered list while the typing sits in a lower item', async () => {
    const base = '1. Alpha\n2. Beta\n3. Gamma\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Gamma', 'USER-')
    expect(mergeExternalMarkdown(crepe, base, '1. New first\n2. Alpha\n3. Beta\n4. Gamma\n')).toBe('merged')
    const md = getMarkdownForSave(crepe)
    expect(md).toContain('New first')
    expect(md).toContain('USER-Gamma')
  })

  it('a changed heading glows only the words that changed', async () => {
    const base = '# Plan for May\n\nSome text.\n'
    const { crepe } = await mount(base)
    typeBefore(crepe, 'Some text', 'USER-')
    const seen = spyDispatch(crepe)
    expect(mergeExternalMarkdown(crepe, base, '# Plan for early May\n\nSome text.\n')).toBe('merged')
    const ranges = seen[0].getMeta(OUTSIDE_RANGES_META) as OutsideRange[]
    expect(ranges.map((r) => seen[0].doc.textBetween(r.from, r.to)).join('|')).toBe('early ')
    expect(ranges.every((r) => r.removed === '')).toBe(true)
  })

  it('lands nothing when the new file already equals the live note', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    const seen = spyDispatch(crepe)
    expect(mergeExternalMarkdown(crepe, BASE, getMarkdownForSave(crepe))).toBe('unchanged')
    expect(seen).toHaveLength(0)
  })

  it('⌘Z after a merge undoes the typing, never the outside edit', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Child', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf tail EXTERNAL'))).toBe('merged')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      undo(view.state, view.dispatch)
    })
    const md = getMarkdownForSave(crepe)
    expect(md).not.toContain('USER-')
    expect(md).toContain('Leaf tail EXTERNAL')
  })

  it('keeps a folded bullet folded across a merge', async () => {
    const { crepe, root } = await mount()
    const toggle = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) => b.getAttribute('aria-label')?.endsWith(' Parent'))
    if (!toggle) throw new Error('no toggle for Parent')
    toggle.click()
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}]`)).toHaveLength(1)
    typeBefore(crepe, 'Kid', 'USER-')
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf tail EXTERNAL'))).toBe('merged')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}]`)).toHaveLength(1)
  })

  it('tells the change list where the outside text landed, and says nothing when quiet', async () => {
    const { crepe } = await mount()
    typeBefore(crepe, 'Parent', 'USER-')
    const seen = spyDispatch(crepe)
    expect(mergeExternalMarkdown(crepe, BASE, BASE.replace('Leaf tail', 'Leaf EXTERNAL tail').replace('  * Kid\n', ''))).toBe('merged')
    const ranges = seen[0].getMeta(OUTSIDE_RANGES_META) as OutsideRange[]
    const doc = seen[0].doc
    expect(ranges.map((r) => doc.textBetween(r.from, r.to)).join('|')).toContain('EXTERNAL ')
    expect(ranges.some((r) => r.removed.includes('Kid'))).toBe(true)

    typeBefore(crepe, 'Second', 'MORE-')
    expect(mergeExternalMarkdown(crepe, getMarkdownForSave(crepe).replace('MORE-', ''), getMarkdownForSave(crepe).replace('MORE-', '').replace('Leaf', 'Leaf again'), true)).toBe('merged')
    expect(seen[seen.length - 1].getMeta(OUTSIDE_RANGES_META)).toBeUndefined()
  })
})

describe('applyExternalMarkdown tells the change list too (YAZ-3704 D3)', () => {
  it('stamps the landed ranges on an apply with no typing; a quiet apply stamps none', async () => {
    const { crepe } = await mount()
    const seen = spyDispatch(crepe)
    expect(applyExternalMarkdown(crepe, BASE.replace('Kid', 'Kid grown'))).toBe('applied')
    const ranges = seen[0].getMeta(OUTSIDE_RANGES_META) as OutsideRange[]
    expect(ranges.map((r) => seen[0].doc.textBetween(r.from, r.to)).join('')).toContain('grown')
    expect(applyExternalMarkdown(crepe, BASE, true)).toBe('applied')
    expect(seen[1].getMeta(OUTSIDE_RANGES_META)).toBeUndefined()
  })
})
