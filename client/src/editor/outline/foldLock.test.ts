/**
 * Lock one row open (YAZ-4094 4A), against the REAL `createCrepe()` editor.
 *
 * The contract under test:
 *  - a locked row does not fold, nor a row inside it, by any fold path (the fold set, Collapse
 *    all); a row that holds the locked row still folds (user, 4A: "lock trevors parent instead");
 *  - locking a folded row opens it and the folds inside it;
 *  - the same for a heading and the rows of its section;
 *  - a lock is no edit: ⌘Z does not undo it, it moves with an edit above it, and the row carries
 *    `data-fold-locked`;
 *  - the keys: `onLockedKeysChange` reports `lock:` + the row's fold key, and an editor seeded with
 *    them has the same lock; a press on a blocked chevron calls `onBlocked`;
 *  - the row's menu says "Lock open", then "Unlock";
 *  - a heading's lock survives a reopen and typing in the heading (YAZ-4131); a rename by typing
 *    reports the new key, so the lock is kept after a reopen, as a fold is (YAZ-4155);
 *  - a fold the lock blocks entirely never happens: the fold-all button then offers Expand all
 *    (YAZ-4132), and ⌘Z is not spent on it (YAZ-4133), nor on undoing a fold that a lock then opened (YAZ-4135);
 *  - a heading's lock stays when Enter splits the heading at its end (YAZ-4136).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import type { MenuRow } from '../blockHandleMenu'
import type { HandleTarget } from '../blockHandleTarget'
import { foldAllRows } from './foldAllRows'
import { nextDocumentFold, setAllDocumentFolds } from './foldAllHotkeys'
import { FOLD_LOCK_ATTR, type FoldLockOptions, isFoldLocked, toggleFoldLock } from './foldLock'
import { isHeadingCollapsed, setHeadingFoldSet, undoLastHeadingFold } from './headingFolding'
import { setFoldingOn } from './foldingSwitch'
import { hasOutlineFoldMeta, isOutlineItemCollapsed, outlineCollapsedPositions, OUTLINE_TOGGLE_CLASS, setOutlineFoldAtSelection, setOutlineFoldSet, undoLastFold } from './outlineFolding'

const DOC = `# Plan

* Lookback
  * Trevor
    * Calls
      * Rhino
    * Ads
  * Yaseen
    * Leads

## Other

Text.

### Deep

Deep text.

# Next

End.
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(foldLock: FoldLockOptions = {}): Promise<EditorView> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: DOC, foldLock })
  await crepe.create()
  mounted.push({ crepe, root })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return view
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The position of the bullet whose label is `label`. */
const item = (view: EditorView, label: string): number => {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
    return found === -1
  })
  if (found === -1) throw new Error(`no bullet "${label}"`)
  return found
}

/** The position of the heading whose text is `text`. */
const heading = (view: EditorView, text: string): number => {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'heading' && node.textContent === text) found = pos
    return found === -1
  })
  if (found === -1) throw new Error(`no heading "${text}"`)
  return found
}

const lock = (view: EditorView, pos: number): void => {
  toggleFoldLock(pos)(view.state, view.dispatch)
}

describe('a locked bullet', () => {
  it('does not fold, nor a bullet inside it; the bullet that holds it still folds, by the fold set and by Collapse all', async () => {
    const view = await mount()
    lock(view, item(view, 'Trevor'))
    setOutlineFoldSet([item(view, 'Trevor'), item(view, 'Calls')], true)(view.state, view.dispatch)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Trevor'))).toBe(false)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Calls'))).toBe(false)
    setOutlineFoldSet([item(view, 'Lookback')], true)(view.state, view.dispatch)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Lookback'))).toBe(true)
    setOutlineFoldSet([item(view, 'Lookback')], false)(view.state, view.dispatch)
    setAllDocumentFolds(true)(view.state, view.dispatch)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Lookback'))).toBe(true)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Yaseen'))).toBe(true)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Trevor'))).toBe(false)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Calls'))).toBe(false)
  })

  it('opens when it is locked folded, and so do the folds inside it', async () => {
    const view = await mount()
    setOutlineFoldSet([item(view, 'Trevor'), item(view, 'Calls')], true)(view.state, view.dispatch)
    lock(view, item(view, 'Trevor'))
    expect(isOutlineItemCollapsed(view.state, item(view, 'Trevor'))).toBe(false)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Calls'))).toBe(false)
  })
})

describe('a locked heading', () => {
  it('does not fold its section, nor a heading inside it; the heading that holds it still folds', async () => {
    const view = await mount()
    lock(view, heading(view, 'Other'))
    setHeadingFoldSet([heading(view, 'Other'), heading(view, 'Deep')], true)(view.state, view.dispatch)
    expect(isHeadingCollapsed(view.state, heading(view, 'Other'))).toBe(false)
    expect(isHeadingCollapsed(view.state, heading(view, 'Deep'))).toBe(false)
    setHeadingFoldSet([heading(view, 'Plan')], true)(view.state, view.dispatch)
    expect(isHeadingCollapsed(view.state, heading(view, 'Plan'))).toBe(true)
  })
})

describe('a lock is no edit', () => {
  it('⌘Z does not undo it; it moves with an edit above it; the row carries the attribute', async () => {
    const view = await mount()
    lock(view, item(view, 'Trevor'))
    undo(view.state, view.dispatch)
    expect(isFoldLocked(view.state, item(view, 'Trevor'))).toBe(true)
    view.dispatch(view.state.tr.insertText('New ', heading(view, 'Plan') + 1))
    expect(isFoldLocked(view.state, item(view, 'Trevor'))).toBe(true)
    const row = view.nodeDOM(item(view, 'Trevor')) as HTMLElement
    expect(row.getAttribute(FOLD_LOCK_ATTR)).toBe('true')
    lock(view, item(view, 'Trevor'))
    expect(isFoldLocked(view.state, item(view, 'Trevor'))).toBe(false)
    expect((view.nodeDOM(item(view, 'Trevor')) as HTMLElement).hasAttribute(FOLD_LOCK_ATTR)).toBe(false)
  })
})

describe('the keys and the host', () => {
  it('reports the lock keys; an editor seeded with them has the same lock; unlock reports none', async () => {
    const onLockedKeysChange = vi.fn()
    const view = await mount({ onLockedKeysChange })
    // The first report is the seed's: the host hears only changes.
    expect(onLockedKeysChange).not.toHaveBeenCalled()
    lock(view, item(view, 'Trevor'))
    const keys: string[] = onLockedKeysChange.mock.lastCall?.[0]
    expect(keys).toHaveLength(1)
    expect(keys[0].startsWith('lock:')).toBe(true)
    const seeded = await mount({ seedLockedKeys: () => new Set(keys) })
    expect(isFoldLocked(seeded.state, item(seeded, 'Trevor'))).toBe(true)
    lock(view, item(view, 'Trevor'))
    expect(onLockedKeysChange).toHaveBeenLastCalledWith([])
  })

  it('a press on a chevron that a lock blocks tells the host; a free chevron does not', async () => {
    const onBlocked = vi.fn()
    const view = await mount({ onBlocked })
    lock(view, item(view, 'Trevor'))
    const chevron = (label: string): Element => {
      const element = (view.nodeDOM(item(view, label)) as HTMLElement).querySelector(`.${OUTLINE_TOGGLE_CLASS}`)
      if (element === null) throw new Error(`no chevron on "${label}"`)
      return element
    }
    chevron('Calls').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onBlocked).toHaveBeenCalledTimes(1)
    chevron('Yaseen').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('the row menu says "Lock open", then "Unlock", and its row locks and unlocks', async () => {
    const view = await mount()
    const target = { inside: item(view, 'Trevor') } as HandleTarget
    const lockRow = () => {
      const row = foldAllRows(view, target, {} as Ctx).find((each) => 'label' in each && /lock/i.test(each.label))
      return row as MenuRow | undefined
    }
    expect(lockRow()?.label).toBe('Lock open')
    lockRow()?.run()
    expect(isFoldLocked(view.state, item(view, 'Trevor'))).toBe(true)
    expect(lockRow()?.label).toBe('Unlock')
    lockRow()?.run()
    expect(isFoldLocked(view.state, item(view, 'Trevor'))).toBe(false)
  })
})

describe('a heading lock is kept (YAZ-4131)', () => {
  it('survives a reopen: an editor seeded with the heading lock key has the lock', async () => {
    let lockKeys: readonly string[] = []
    const first = await mount({ onLockedKeysChange: (keys) => (lockKeys = keys) })
    lock(first, heading(first, 'Other'))
    expect(lockKeys).toHaveLength(1)
    const reopened = await mount({ seedLockedKeys: () => new Set(lockKeys) })
    expect(isFoldLocked(reopened.state, heading(reopened, 'Other'))).toBe(true)
  })

  it('stays while the reader types in the locked heading, as a bullet lock stays while its label changes', async () => {
    const view = await mount()
    lock(view, heading(view, 'Other'))
    view.dispatch(view.state.tr.insertText('X', heading(view, 'Other') + 2))
    expect(isFoldLocked(view.state, heading(view, 'OXther'))).toBe(true)
    lock(view, item(view, 'Trevor'))
    view.dispatch(view.state.tr.insertText('X', item(view, 'Trevor') + 3))
    expect(isFoldLocked(view.state, item(view, 'TXrevor'))).toBe(true)
  })
})

describe('a lock follows a rename by typing, as a fold does (YAZ-4155)', () => {
  const reopenLocked = async (lockKeys: readonly string[], markdown: string): Promise<EditorView> => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: markdown, foldLock: { seedLockedKeys: () => new Set(lockKeys) } })
    await crepe.create()
    mounted.push({ crepe, root })
    return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  }

  it('a heading: the reopened page with the new text has the lock', async () => {
    let lockKeys: readonly string[] = []
    const view = await mount({ onLockedKeysChange: (keys) => (lockKeys = keys) })
    lock(view, heading(view, 'Other'))
    view.dispatch(view.state.tr.insertText('Y', heading(view, 'Other') + 2))
    const reopened = await reopenLocked(lockKeys, DOC.replace('## Other', '## OYther'))
    expect(isFoldLocked(reopened.state, heading(reopened, 'OYther'))).toBe(true)
  })

  it('a bullet: the reopened page with the new text has the lock', async () => {
    let lockKeys: readonly string[] = []
    const view = await mount({ onLockedKeysChange: (keys) => (lockKeys = keys) })
    lock(view, item(view, 'Trevor'))
    view.dispatch(view.state.tr.insertText('Y', item(view, 'Trevor') + 3))
    const reopened = await reopenLocked(lockKeys, DOC.replace('* Trevor', '* TYrevor'))
    expect(isFoldLocked(reopened.state, item(reopened, 'TYrevor'))).toBe(true)
  })
})

describe('a fold the lock blocks entirely never happens', () => {
  it('after Collapse all, the fold-all button offers Expand all (YAZ-4132)', async () => {
    const view = await mount()
    lock(view, item(view, 'Trevor'))
    setAllDocumentFolds(true)(view.state, view.dispatch)
    // Each row that can fold is folded now; only the held rows are open.
    expect(nextDocumentFold(view.state)).toBe('expand')
    setAllDocumentFolds(false)(view.state, view.dispatch)
    expect(nextDocumentFold(view.state)).toBe('collapse')
  })

  it('⌘Z is not spent on a fold the lock blocked (YAZ-4133)', async () => {
    const view = await mount()
    setOutlineFoldSet([item(view, 'Yaseen')], true)(view.state, view.dispatch)
    lock(view, item(view, 'Trevor'))
    const trevor = item(view, 'Trevor')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, trevor + 3)))
    setOutlineFoldAtSelection(true)(view.state, view.dispatch)
    expect(isOutlineItemCollapsed(view.state, trevor)).toBe(false)
    // ⌘Z goes to what the reader did before the blocked press: it opens "Yaseen" again.
    expect(undoLastFold(view.state, view.dispatch)).toBe(true)
    expect(isOutlineItemCollapsed(view.state, item(view, 'Yaseen'))).toBe(false)
  })

  it('⌘Z after a fold that a lock then opened goes to the text undo, for a bullet and a heading (YAZ-4135)', async () => {
    const view = await mount()
    view.dispatch(view.state.tr.insertText('New ', heading(view, 'Plan') + 1))
    const trevor = item(view, 'Trevor')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, trevor + 3)))
    setOutlineFoldAtSelection(true)(view.state, view.dispatch)
    expect(isOutlineItemCollapsed(view.state, trevor)).toBe(true)
    lock(view, trevor)
    expect(isOutlineItemCollapsed(view.state, trevor)).toBe(false)
    // The fold's undo would fold only the locked row, which the lock refuses: ⌘Z passes on to the text undo.
    expect(undoLastFold(view.state, view.dispatch)).toBe(false)
    setHeadingFoldSet([heading(view, 'Other')], true)(view.state, view.dispatch)
    lock(view, heading(view, 'Other'))
    expect(undoLastHeadingFold(view.state, view.dispatch)).toBe(false)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.firstChild?.textContent).toBe('Plan')
  })
})

describe('a heading lock and Enter (YAZ-4136)', () => {
  it('stays on the heading when Enter at its end adds a paragraph under it', async () => {
    const view = await mount()
    const other = heading(view, 'Other')
    lock(view, other)
    const end = other + 1 + 'Other'.length
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(view.state.doc.nodeAt(other)?.textContent).toBe('Other')
    expect(isFoldLocked(view.state, other)).toBe(true)
  })

  it('is lost when the heading is deleted', async () => {
    const view = await mount()
    const other = heading(view, 'Other')
    lock(view, other)
    view.dispatch(view.state.tr.delete(other, other + view.state.doc.nodeAt(other)!.nodeSize))
    expect(isFoldLocked(view.state, other)).toBe(false)
  })
})

describe('with folding off', () => {
  it('the lock waits: an edit adds no unfold; turning folding on opens the saved folds it holds', async () => {
    const view = await mount()
    setOutlineFoldSet([item(view, 'Calls')], true)(view.state, view.dispatch)
    view.dispatch(setFoldingOn(view.state.tr, false))
    lock(view, item(view, 'Trevor'))
    // The saved fold is kept while folding is off, as every saved fold is.
    expect(outlineCollapsedPositions(view.state).has(item(view, 'Calls'))).toBe(true)
    const { transactions } = view.state.applyTransaction(view.state.tr.insertText('New ', heading(view, 'Plan') + 1))
    expect(transactions.filter(hasOutlineFoldMeta)).toHaveLength(0)
    view.dispatch(setFoldingOn(view.state.tr, true))
    expect(isOutlineItemCollapsed(view.state, item(view, 'Calls'))).toBe(false)
  })
})
