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
 *  - the row's menu says "Lock open", then "Unlock".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import type { MenuRow } from '../blockHandleMenu'
import type { HandleTarget } from '../blockHandleTarget'
import { foldAllRows } from './foldAllRows'
import { setAllDocumentFolds } from './foldAllHotkeys'
import { FOLD_LOCK_ATTR, type FoldLockOptions, isFoldLocked, toggleFoldLock } from './foldLock'
import { isHeadingCollapsed, setHeadingFoldSet } from './headingFolding'
import { isOutlineItemCollapsed, OUTLINE_TOGGLE_CLASS, setOutlineFoldSet } from './outlineFolding'

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
