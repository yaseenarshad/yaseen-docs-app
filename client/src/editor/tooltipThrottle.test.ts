/**
 * Crepe's floating toolbar is a `TooltipProvider` from `@milkdown/plugin-tooltip` (the pinned build,
 * `client/vendor/milkdown-plugin-tooltip-7.22.1-yaz2238.*`). Its updates are throttled (20 ms for the
 * toolbar), and a throttled update used to be skipped when the state had not changed since the
 * CALL's `prevState` — so an update that should hide the toolbar, followed within the window by a
 * transaction that changes nothing, left the toolbar showing over a selection that no longer
 * exists. YAZ-2238: a stale toolbar after ⌘Z covered the row above and blocked its block handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
})

/** The slice of an EditorView the provider reads: its state, focus, editability and a DOM to hang from. */
function fakeView(state: EditorState, parent: HTMLElement) {
  const dom = document.createElement('div')
  parent.appendChild(dom)
  const view = {
    state,
    dom,
    composing: false,
    editable: true,
    hasFocus: () => true,
    coordsAtPos: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  }
  return view as typeof view & EditorView
}

let root: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  root = document.createElement('div')
  document.body.appendChild(root)
})
afterEach(() => {
  vi.useRealTimers()
  root.remove()
})

describe('TooltipProvider throttled updates (YAZ-2238)', () => {
  it('hides when a selection-clearing update is followed within the throttle window by a no-op', () => {
    const content = document.createElement('div')
    const provider = new TooltipProvider({ content, debounce: 20, root })
    const empty = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello world')])]) })
    const selected = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 1, 6)))
    const view = fakeView(selected, root)

    provider.update(view, empty) // leading call: a real selection shows the toolbar
    expect(content.dataset.show).toBe('true')

    vi.advanceTimersByTime(100)
    const touched = selected.apply(selected.tr.setMeta('touch', true))
    view.state = touched
    provider.update(view, selected) // a fresh window's leading call: still selected, still shown

    vi.advanceTimersByTime(5)
    const cleared = touched.apply(touched.tr.setSelection(TextSelection.create(touched.doc, 1)))
    view.state = cleared
    provider.update(view, touched) // inside the window: held for the trailing call

    vi.advanceTimersByTime(5)
    const noop = cleared.apply(cleared.tr.setMeta('noop', true))
    view.state = noop
    provider.update(view, cleared) // a transaction that changes nothing replaces the held arguments

    vi.advanceTimersByTime(50)
    expect(content.dataset.show).toBe('false')
  })

  it('still skips an update when nothing changed since the last evaluated one', () => {
    const content = document.createElement('div')
    const provider = new TooltipProvider({ content, debounce: 20, root })
    const empty = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello world')])]) })
    const selected = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 1, 6)))
    const view = fakeView(selected, root)
    provider.update(view, empty)
    expect(content.dataset.show).toBe('true')

    // Something outside the state hides it (the toolbar's own buttons do); an unchanged state keeps it hidden.
    provider.hide()
    vi.advanceTimersByTime(100)
    const noop = selected.apply(selected.tr.setMeta('noop', true))
    view.state = noop
    provider.update(view, selected)
    vi.advanceTimersByTime(50)
    expect(content.dataset.show).toBe('false')
  })
})
