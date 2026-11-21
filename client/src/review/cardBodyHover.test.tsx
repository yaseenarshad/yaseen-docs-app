/**
 * YAZ-6049: the hover preview of a pill in a drawn card anchors at the pill. A `.wikilink-group` is `display: contents`
 * (its own box is 0×0, which put the preview at the window's corner), so `rectOfLink` measures the union of its children.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { ExploreVault } from '../explore/ExplorePage'
import { CardBody } from './cardParts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect
const at = (target: Element, rect: DOMRect) => vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect)

function mount(onPillHover: (hit: unknown) => void) {
  const wikilinks = createWikilinkResolveSource()
  const vault: ExploreVault = { root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never }
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  act(() => root?.render(<CardBody text="plain" path="/v/p.md" vault={vault} doors={{ openLayer: vi.fn(), openTab: vi.fn(), onNotice: vi.fn() }} onPillHover={onPillHover} />))
  return el.querySelector<HTMLElement>('.card__body')!
}

const over = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))

describe('YAZ-6049: card pill hover anchor', () => {
  it('a `display: contents` .wikilink-group (own rect 0×0) anchors at the union of its child spans, not at (0, 0)', () => {
    const onHover = vi.fn()
    const body = mount(onHover)
    const group = document.createElement('span')
    group.className = 'wikilink-group'
    group.dataset.cardLink = 'Known'
    const name = document.createElement('span')
    name.className = 'wikilink'
    const tail = document.createElement('span')
    tail.className = 'wikilink link-pill__tail'
    group.append(name, tail)
    body.append(group)
    at(group, box(0, 0, 0, 0))
    at(name, box(100, 200, 150, 220))
    at(tail, box(150, 198, 180, 224))
    over(name)
    expect(onHover).toHaveBeenCalledExactlyOnceWith({ kind: 'wikilink', inner: 'Known', rect: { left: 100, top: 198, right: 180, bottom: 224 } })
  })

  it('zero-size children are skipped; a group with no box anywhere falls back to its own rect', () => {
    const onHover = vi.fn()
    const body = mount(onHover)
    const group = document.createElement('span')
    group.className = 'wikilink-group'
    group.dataset.cardLink = 'Known'
    const hidden = document.createElement('span')
    const shown = document.createElement('span')
    group.append(hidden, shown)
    body.append(group)
    at(group, box(0, 0, 0, 0))
    at(hidden, box(0, 0, 0, 0))
    at(shown, box(40, 50, 90, 70))
    over(shown)
    expect(onHover.mock.calls[0][0]).toMatchObject({ rect: { left: 40, top: 50, right: 90, bottom: 70 } })

    const lone = document.createElement('span')
    lone.dataset.cardLink = 'Other'
    body.append(lone)
    at(lone, box(0, 0, 0, 0))
    over(lone)
    expect(onHover.mock.calls[1][0]).toMatchObject({ inner: 'Other', rect: { left: 0, top: 0, right: 0, bottom: 0 } })
  })

  it('an element with its own box uses it as is', () => {
    const onHover = vi.fn()
    const body = mount(onHover)
    const pill = document.createElement('span')
    pill.dataset.cardLink = 'Known'
    body.append(pill)
    at(pill, box(10, 20, 60, 40))
    over(pill)
    expect(onHover.mock.calls[0][0]).toMatchObject({ rect: { left: 10, top: 20, right: 60, bottom: 40 } })
  })
})
