/**
 * `usePageSwitch` (YAZ-2950): the one hook of the page cog's saved switches. The store is a plain
 * map here; the store itself, its IPC and `storage` have their own tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { usePageSwitch } from './usePageSwitch'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('usePageSwitch', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  /** A store like `tocSwitches` read with the default On: no entry = on. */
  const makeStore = () => {
    const saved: Record<string, boolean> = {}
    return {
      saved,
      read: vi.fn((_root: string, path: string) => saved[path] !== false),
      write: vi.fn((_root: string, path: string, on: boolean) => void (saved[path] = on)),
    }
  }

  /** Each editor of a page is one `Probe`: it shows its switch and hands out its toggle. */
  function mountEditors(store: ReturnType<typeof makeStore>, editors: Array<{ root: string; path: string }>) {
    const toggles: Array<() => void> = []
    function Probe({ id, vault, path }: { id: number; vault: string; path: string }) {
      const [on, toggle] = usePageSwitch(vault, path, store.read, store.write)
      toggles[id] = toggle
      return <span data-id={id}>{on ? 'on' : 'off'}</span>
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = (list: typeof editors) => act(() => root!.render(<>{list.map((e, id) => <Probe key={id} id={id} vault={e.root} path={e.path} />)}</>))
    render(editors)
    const shown = () => [...host!.querySelectorAll('span')].map((span) => span.textContent)
    return { toggles, shown, render }
  }

  it('two editors open on one page each keep what they show until they mount again; a new editor reads the saved switch (D2)', () => {
    const store = makeStore()
    const a = mountEditors(store, [{ root: '/v', path: '/v/a.md' }, { root: '/v', path: '/v/a.md' }])
    expect(a.shown()).toEqual(['on', 'on'])
    act(() => a.toggles[0]())
    // The first editor is off and saved it; the second, open at the same time, is not followed.
    expect(a.shown()).toEqual(['off', 'on'])
    expect(store.write).toHaveBeenCalledExactlyOnceWith('/v', '/v/a.md', false)
    act(() => root!.unmount())
    host!.remove()
    // A new editor of the page — a duplicated tab, a new window, the app after a restart — starts off.
    const b = mountEditors(store, [{ root: '/v', path: '/v/a.md' }])
    expect(b.shown()).toEqual(['off'])
    expect(store.write).toHaveBeenCalledTimes(1)
  })

  it('another page in the same mount reads its own switch in the same render, and a toggle writes for that page', () => {
    const store = makeStore()
    store.saved['/v/a.md'] = false
    const m = mountEditors(store, [{ root: '/v', path: '/v/a.md' }])
    expect(m.shown()).toEqual(['off'])
    m.render([{ root: '/w', path: '/w/b.md' }])
    expect(m.shown()).toEqual(['on'])
    act(() => m.toggles[0]())
    expect(store.write).toHaveBeenLastCalledWith('/w', '/w/b.md', false)
    expect(store.saved).toEqual({ '/v/a.md': false, '/w/b.md': false })
  })

  it('a page with no choice is `fallback`, followed live and never written; a click stores the opposite of what shows, and that choice wins over each later fallback (YAZ-3558 D1)', () => {
    const saved: Record<string, boolean> = {}
    const read = (_root: string, path: string): boolean | undefined => saved[path]
    const write = vi.fn((_root: string, path: string, on: boolean) => void (saved[path] = on))
    let toggle = (): void => undefined
    function Probe({ fallback }: { fallback: boolean }) {
      const [on, flip] = usePageSwitch('/v', '/v/a.md', read, write, fallback)
      toggle = flip
      return <span>{on ? 'on' : 'off'}</span>
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = (fallback: boolean) => act(() => root!.render(<Probe fallback={fallback} />))
    render(false)
    expect(host.textContent).toBe('off')
    render(true)
    expect(host.textContent).toBe('on')
    expect(write).not.toHaveBeenCalled()
    // The default is Off; the page turns its own on, and keeps it through each fallback.
    render(false)
    act(() => toggle())
    expect(write).toHaveBeenCalledExactlyOnceWith('/v', '/v/a.md', true)
    for (const fallback of [true, false]) {
      render(fallback)
      expect(host.textContent).toBe('on')
    }
  })
})
