import { afterEach, describe, expect, it } from 'vitest'
import type { PageView } from '@shared/types'
import { readPageView, registerPageView } from './pageView'

const view = (scrollTop: number): PageView => ({ scrollTop, zoomKey: null, folds: [], magnification: 100 })

/** A tab layer holding an editor scroller, as App and Editor draw them. */
function tabWithHost(id: string): HTMLElement {
  const layer = document.createElement('div')
  layer.dataset.tab = id
  const host = document.createElement('div')
  host.className = 'editor-host'
  layer.appendChild(host)
  document.body.appendChild(layer)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('pageView: each editor answers for its tab (YAZ-2951 D4)', () => {
  it('reads the registered reader of the tab, live at each read; a tab with no editor gives undefined', () => {
    const host = tabWithHost('t1')
    tabWithHost('t2') // a scroller with no reader yet
    let scrollTop = 10
    registerPageView(host, () => view(scrollTop))
    expect(readPageView('t1')).toEqual(view(10))
    scrollTop = 40
    expect(readPageView('t1')).toEqual(view(40))
    expect(readPageView('t2')).toBeUndefined()
    expect(readPageView('no-such-tab')).toBeUndefined()
  })

  it('off removes the reader; an old off does not remove a newer reader of the same host', () => {
    const host = tabWithHost('t1')
    const offOld = registerPageView(host, () => view(1))
    const offNew = registerPageView(host, () => view(2)) // a recreated editor in the same scroller
    offOld()
    expect(readPageView('t1')).toEqual(view(2))
    offNew()
    expect(readPageView('t1')).toBeUndefined()
  })
})
