/**
 * The find bar (YAZ-969): CMD+F claim rules, live counter, Enter/Shift+Enter cycling, Esc —
 * driven against REAL `createCrepe()` editors through the same FindChannel the hosts wire
 * (findInPage.test.ts proves the engine; this file proves the bar and the keyboard surface).
 *
 * Claim rule under test (locked in YAZ-967): CMD+F is a window capture-phase listener per bar.
 * A `folder` bar (a folder's Page tab, YAZ-4584) claims only while focus is inside its own host element; the `page` bar
 * claims whenever focus is NOT inside any `.folder-page-doc`. At most one of each is
 * mounted, so exactly one bar answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, type CreateCrepeOptions } from '../createCrepe'
import { createFindChannel, type FindChannel } from './findChannel'
import { FindBar, type FindBarProps } from './FindBar'
import { useEscapeLast } from '../../lib/escapeOrder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ crepe: Crepe; el: HTMLElement }> = []
const roots: Array<{ root: Root; el: HTMLElement }> = []

async function mountEditor(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const crepe = createCrepe({ root: el, defaultValue: markdown, ...opts })
  await crepe.create()
  mounted.push({ crepe, el })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return { crepe, el, view: view as EditorView }
}

function renderBar(channel: FindChannel, scope: 'page' | 'folder', host: HTMLElement, folds?: FindBarProps['folds']) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => {
    root.render(<FindBar channel={channel} scope={scope} hostRef={{ current: host }} folds={folds} />)
  })
  roots.push({ root, el })
  return el
}

afterEach(async () => {
  for (const r of roots.splice(0)) {
    act(() => r.root.unmount())
    r.el.remove()
  }
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.el.remove()
  }
})

/** CMD+F as the window capture listener sees it: dispatched from wherever focus stands. */
const pressCmdF = (target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

const barInput = (barEl: HTMLElement): HTMLInputElement => {
  const input = barEl.querySelector<HTMLInputElement>('.find-bar__input')
  if (!input) throw new Error('no find bar input')
  return input
}

const counterText = (barEl: HTMLElement): string | null => barEl.querySelector('.find-bar__count')?.textContent ?? null

/** React's controlled-input dance: set through the native setter, then fire `input`. */
const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const keyOn = (input: HTMLInputElement, key: string, shift = false) => {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }))
  })
}

describe('opening', () => {
  it('CMD+F opens the page bar, focuses its input, and consumes the key', async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    expect(barEl.querySelector('.find-bar-dock--page')).not.toBeNull()
    expect(barEl.querySelector('.find-bar')).toBeNull()
    view.dom.focus()
    const event = pressCmdF(view.dom)
    expect(event.defaultPrevented).toBe(true)
    expect(channel.getState().open).toBe(true)
    expect(barEl.querySelector('.find-bar-dock--page > .find-bar')).not.toBeNull()
    expect(barEl.querySelector('.find-bar')).not.toBeNull()
    expect(document.activeElement).toBe(barInput(barEl))
  })

  it('CMD+F while already open refocuses the input', async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    pressCmdF()
    view.dom.focus()
    expect(document.activeElement).not.toBe(barInput(barEl))
    pressCmdF(view.dom)
    expect(channel.getState().open).toBe(true)
    expect(document.activeElement).toBe(barInput(barEl))
  })
})

describe('claim rule with a page editor and the folder\'s Page tab (once the outline view) mounted together', () => {
  it('routes CMD+F to the page bar only while focus is inside the page host', async () => {
    const pageChannel = createFindChannel()
    const page = await mountEditor('page apple', { find: pageChannel })
    // The production DOM detail the claim reads: CrepeHost mounts the page editor inside
    // `.editor-mount`.
    const pageMount = document.createElement('div')
    pageMount.className = 'editor-mount'
    document.body.appendChild(pageMount)
    pageMount.appendChild(page.el)
    const outlineChannel = createFindChannel()
    const outlineHost = document.createElement('div')
    outlineHost.className = 'folder-page-doc'
    document.body.appendChild(outlineHost)
    const outline = await mountEditor('* outline apple', { find: outlineChannel })
    outlineHost.appendChild(outline.el)
    renderBar(pageChannel, 'page', page.el)
    const outlineBarEl = renderBar(outlineChannel, 'folder', outlineHost)

    outline.view.dom.focus()
    pressCmdF(outline.view.dom)
    expect(outlineChannel.getState().open).toBe(true)
    expect(outlineBarEl.querySelector('.find-bar-dock--folder > .find-bar')).not.toBeNull()
    expect(pageChannel.getState().open).toBe(false)

    act(() => outlineChannel.close())
    page.view.dom.focus()
    pressCmdF(page.view.dom)
    expect(pageChannel.getState().open).toBe(true)
    expect(outlineChannel.getState().open).toBe(false)
    outlineHost.remove()
  })
})

describe('claim rule beside a code tab (YAZ-3451)', () => {
  it("a page's bar leaves CMD+F alone while the focus is in a code tab, so Monaco's find box gets it", async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('page apple', { find: channel })
    renderBar(channel, 'page', el)
    const codeTab = document.createElement('section')
    codeTab.className = 'editor editor--code'
    const monacoInput = document.createElement('textarea')
    codeTab.appendChild(monacoInput)
    document.body.appendChild(codeTab)
    monacoInput.focus()
    const event = pressCmdF(monacoInput)
    expect(event.defaultPrevented).toBe(false)
    expect(channel.getState().open).toBe(false)
    // The page still claims it from its own body.
    view.dom.focus()
    pressCmdF(view.dom)
    expect(channel.getState().open).toBe(true)
    codeTab.remove()
  })

  it("an outline view's bar leaves CMD+F alone while the focus is in a code tab (YAZ-3464)", () => {
    const outlineChannel = createFindChannel()
    const outlineHost = document.createElement('div')
    outlineHost.className = 'folder-page-doc'
    const outlineInput = document.createElement('div')
    outlineInput.tabIndex = 0
    outlineHost.appendChild(outlineInput)
    document.body.appendChild(outlineHost)
    renderBar(outlineChannel, 'folder', outlineHost)
    const codeTab = document.createElement('section')
    codeTab.className = 'editor editor--code'
    const monacoInput = document.createElement('textarea')
    codeTab.appendChild(monacoInput)
    document.body.appendChild(codeTab)
    monacoInput.focus()
    const event = pressCmdF(monacoInput)
    expect(event.defaultPrevented).toBe(false)
    expect(outlineChannel.getState().open).toBe(false)
    // The outline still claims it from its own view, and from outside a code tab when no page shows.
    outlineInput.focus()
    pressCmdF(outlineInput)
    expect(outlineChannel.getState().open).toBe(true)
    act(() => outlineChannel.close())
    document.body.focus()
    const outside = pressCmdF(document.body)
    expect(outside.defaultPrevented).toBe(true)
    expect(outlineChannel.getState().open).toBe(true)
    act(() => outlineChannel.close())
    codeTab.remove()
    outlineHost.remove()
  })
})

describe('the counter and cycling', () => {
  it('shows N of M live, wraps with Enter, walks back with Shift+Enter', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple one apple two apple three', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    pressCmdF()
    const input = barInput(barEl)
    type(input, 'apple')
    expect(counterText(barEl)).toBe('1 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('2 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('3 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('1 of 3')
    keyOn(input, 'Enter', true)
    expect(counterText(barEl)).toBe('3 of 3')
  })

  it('shows the zero state for a query with no matches, and no counter for an empty query', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    pressCmdF()
    const input = barInput(barEl)
    expect(counterText(barEl)).toBeNull()
    type(input, 'zzz')
    expect(counterText(barEl)).toBe('0 of 0')
  })
})

describe('closing', () => {
  it('Esc in the input closes the bar and clears the highlights', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    pressCmdF()
    type(barInput(barEl), 'apple')
    keyOn(barInput(barEl), 'Escape')
    expect(channel.getState().open).toBe(false)
    expect(barEl.querySelector('.find-bar')).toBeNull()
    expect(el.querySelector('.find-match')).toBeNull()
  })

  it('the close button does the same', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    pressCmdF()
    const close = barEl.querySelector<HTMLButtonElement>('button[aria-label="Close find"]')
    if (!close) throw new Error('no close button')
    act(() => close.click())
    expect(channel.getState().open).toBe(false)
    expect(barEl.querySelector('.find-bar')).toBeNull()
  })
})

describe('YAZ-5378 round 2: hidden words take the Underline look while find has a query', () => {
  it('the searched view carries `data-find-query` while the bar is open with a query; a cleared query, a close or an unmount take it off', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'page', el)
    expect(el.hasAttribute('data-find-query')).toBe(false)
    pressCmdF()
    // An open bar with nothing typed searches nothing: the hidden words keep their look.
    expect(el.hasAttribute('data-find-query')).toBe(false)
    type(barInput(barEl), 'apple')
    expect(el.hasAttribute('data-find-query')).toBe(true)
    type(barInput(barEl), '')
    expect(el.hasAttribute('data-find-query')).toBe(false)
    type(barInput(barEl), 'apple')
    keyOn(barInput(barEl), 'Escape')
    // Close keeps the query for the next ⌘F, but the page is not searched any more.
    expect(channel.getState().query).toBe('apple')
    expect(el.hasAttribute('data-find-query')).toBe(false)
    pressCmdF()
    expect(el.hasAttribute('data-find-query')).toBe(true)
    const { root } = roots.splice(0)[0]!
    act(() => root.unmount())
    expect(el.hasAttribute('data-find-query')).toBe(false)
  })
})

describe('YAZ-6341: claim rule while DrawingModal is open', () => {
  it('ignores ⌘F when .drawing-modal-overlay is in the DOM and resumes claiming it once closed', async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('apple', { find: channel })
    renderBar(channel, 'page', el)
    const overlay = document.createElement('div')
    overlay.className = 'drawing-modal-overlay'
    document.body.appendChild(overlay)
    try {
      view.dom.focus()
      const blocked = pressCmdF(view.dom)
      expect(blocked.defaultPrevented).toBe(false)
      expect(channel.getState().open).toBe(false)
    } finally {
      overlay.remove()
    }
    const allowed = pressCmdF(view.dom)
    expect(allowed.defaultPrevented).toBe(true)
    expect(channel.getState().open).toBe(true)
  })
})

describe('YAZ-6492: Read-only page and fold menu Esc order with FindBar + sidebar', () => {
  function mountEscapeLast(aside: HTMLElement) {
    const onStep = vi.fn()
    function Probe() {
      useEscapeLast(() => ({ aside, searchShown: false, canClose: true }), onStep)
      return null
    }
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(<Probe />))
    roots.push({ root, el })
    return onStep
  }

  const pressEscOn = (target: EventTarget) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('Read-only page body focused with FindBar open: 1st Esc closes FindBar only, 2nd Esc closes the sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)
    const channel = createFindChannel()
    const { crepe, el, view } = await mountEditor('apple pie', { find: channel, readOnlyKeys: true })
    el.className = 'editor-instance'
    crepe.setReadonly(true)
    renderBar(channel, 'page', el)

    try {
      pressCmdF(view.dom)
      expect(channel.getState().open).toBe(true)
      // Move focus out of the FindBar input back into the Read-only page body
      act(() => view.dom.focus())
      expect(document.activeElement).toBe(view.dom)

      // 1st Esc closes FindBar and does NOT close sidebar
      const first = pressEscOn(view.dom)
      expect(first.defaultPrevented).toBe(true)
      expect(channel.getState().open).toBe(false)
      expect(onStep).not.toHaveBeenCalled()

      // 2nd Esc closes sidebar
      const second = pressEscOn(view.dom)
      expect(second.defaultPrevented).toBe(true)
      expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    } finally {
      aside.remove()
    }
  })

  it('Read-only page margin clicked (body focus) with FindBar open: 1st Esc closes FindBar, 2nd Esc closes sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)
    const channel = createFindChannel()
    const { crepe, el } = await mountEditor('apple pie', { find: channel, readOnlyKeys: true })
    el.className = 'editor-instance'
    crepe.setReadonly(true)
    renderBar(channel, 'page', el)

    try {
      pressCmdF()
      expect(channel.getState().open).toBe(true)
      act(() => (document.activeElement as HTMLElement | null)?.blur())

      const first = pressEscOn(document.body)
      expect(first.defaultPrevented).toBe(true)
      expect(channel.getState().open).toBe(false)
      expect(onStep).not.toHaveBeenCalled()

      const second = pressEscOn(document.body)
      expect(second.defaultPrevented).toBe(true)
      expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    } finally {
      aside.remove()
    }
  })

  it('FindBar fold menu open: 1st Esc closes only fold menu, 2nd Esc closes FindBar, 3rd Esc closes sidebar', async () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const onStep = mountEscapeLast(aside)
    const channel = createFindChannel()
    const { crepe, el, view } = await mountEditor('apple pie', { find: channel, readOnlyKeys: true })
    el.className = 'editor-instance'
    crepe.setReadonly(true)
    const barEl = renderBar(channel, 'page', el, { own: null, app: 'current', onChange: vi.fn() })

    try {
      pressCmdF(view.dom)
      act(() => view.dom.focus())
      const foldBtn = barEl.querySelector<HTMLButtonElement>('.find-bar__btn--folds')!
      act(() => foldBtn.click())
      expect(barEl.querySelector('[role="menu"]')).not.toBeNull()

      // 1st Esc closes ONLY the fold menu
      expect(pressEscOn(view.dom).defaultPrevented).toBe(true)
      expect(barEl.querySelector('[role="menu"]')).toBeNull()
      expect(channel.getState().open).toBe(true)
      expect(onStep).not.toHaveBeenCalled()

      // 2nd Esc closes FindBar
      expect(pressEscOn(view.dom).defaultPrevented).toBe(true)
      expect(channel.getState().open).toBe(false)
      expect(onStep).not.toHaveBeenCalled()

      // 3rd Esc closes sidebar
      expect(pressEscOn(view.dom).defaultPrevented).toBe(true)
      expect(onStep).toHaveBeenCalledExactlyOnceWith('closeSidebar')
    } finally {
      aside.remove()
    }
  })
})
