/**
 * A page's convert door (YAZ-5037 phase 5): what its cards, its card embeds and its cog offer, and when. The writes
 * themselves are `review/cardConvert.test.ts`'s; here, which action runs, the ask before Put back, the vault's Read
 * only, and the one notice of a failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { useCardConvert, type CardConvertHost } from './useCardConvert'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const actions = vi.hoisted(() => ({
  moveCardToFile: vi.fn(async () => '/v/card.md'),
  putCardBackIntoPage: vi.fn(async () => undefined),
  turnIntoCardFile: vi.fn(async (path: string) => path),
}))
vi.mock('../review/cardConvert', () => ({ ...actions, convertFailure: (err: unknown) => (err instanceof Error ? err.message : String(err)) }))

const PAGE = '/v/plan.md'
const CARD_FILE = '/v/capital-geo-140.md'
const ONE_CARD = '---\nid: GEO-1\ntitle: Plan\n---\n```card\nCapital?\n```\n<!-- card: GEO-140 -->\n'

const rec = (path: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title: name, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}
const wikilinks = createWikilinkResolveSource()
const index = (embedders: number) =>
  wikilinks.update(
    () => null,
    [
      rec(CARD_FILE, { kind: 'card', cards: [{ id: 'GEO-140', off: false, next: false, reviews: [], title: 'Capital?' }] }),
      rec(PAGE, { embeds: ['GEO-140'] }),
      ...Array.from({ length: embedders }, (_, i) => rec(`/v/other-${i}.md`, { embeds: ['geo-140'] })),
    ],
    [],
    true,
    ['GEO'],
  )

let root: Root | null = null
let el: HTMLElement
let hook: ReturnType<typeof useCardConvert>
function Probe(props: CardConvertHost) {
  hook = useCardConvert(props)
  return <>{hook.sheet}</>
}
function mount(over: Partial<CardConvertHost> = {}) {
  const host: CardConvertHost = { root: '/v', path: PAGE, wikilinks, reviewOn: true, inFolderPage: false, disk: () => ONE_CARD, allowFileAction: vi.fn(async () => true), onNotice: vi.fn(), onReread: vi.fn(), ...over }
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  act(() => root!.render(<Probe {...host} />))
  return host
}

beforeEach(() => {
  index(0)
  Object.values(actions).forEach((fn) => fn.mockClear())
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

describe('Move to its own file', () => {
  it('offered while Review is on in a vault with IDs; it runs the move; a failure is one notice', async () => {
    const host = mount()
    expect(hook.door.canMove()).toBe(true)
    hook.door.move('GEO-140', 2)
    await vi.waitFor(() => expect(actions.moveCardToFile).toHaveBeenCalledWith(PAGE, 'GEO-140', 2))
    actions.moveCardToFile.mockRejectedValueOnce(new Error('the file changed on disk. Nothing changed; try again.'))
    hook.door.move('GEO-140', 2)
    await vi.waitFor(() => expect(host.onNotice).toHaveBeenCalledWith("Can't move the card: the file changed on disk. Nothing changed; try again."))
  })

  it('Review off: not offered. A read-only vault asks first, and Cancel runs nothing', async () => {
    mount({ reviewOn: false })
    expect(hook.door.canMove()).toBe(false)
    act(() => root?.unmount())
    const host = mount({ allowFileAction: vi.fn(async () => false) })
    hook.door.move('GEO-140', 0)
    await vi.waitFor(() => expect(host.allowFileAction).toHaveBeenCalledWith('/v'))
    await act(async () => undefined)
    expect(actions.moveCardToFile).not.toHaveBeenCalled()
  })
})

describe('Put back into this page', () => {
  it('no other page embeds it: it runs at once, with the embed\'s text and place', async () => {
    mount()
    hook.door.putBack({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 1)
    await vi.waitFor(() => expect(actions.putCardBackIntoPage).toHaveBeenCalledWith(PAGE, CARD_FILE, 'GEO-140', 'GEO-140', 1))
  })

  it('other pages embed it: it asks first ("2 other pages embed this card. They will show it from this page."); Cancel runs nothing', async () => {
    index(2)
    mount()
    act(() => hook.door.putBack({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 0))
    expect(document.querySelector('.confirm__text')?.textContent).toBe('2 other pages embed this card. They will show it from this page.')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!.click())
    expect(document.querySelector('.confirm')).toBeNull()
    expect(actions.putCardBackIntoPage).not.toHaveBeenCalled()
    act(() => hook.door.putBack({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 0))
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Put back')!.click())
    await vi.waitFor(() => expect(actions.putCardBackIntoPage).toHaveBeenCalled())
  })

  it('one other page: "1 other page embeds this card. It will show it from this page."', () => {
    index(1)
    mount()
    act(() => hook.door.putBack({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 0))
    expect(document.querySelector('.confirm__text')?.textContent).toBe('1 other page embeds this card. It will show it from this page.')
  })
})

describe('the cog: Turn into a card file', () => {
  it('a page with one card and no other text, Review on, IDs: the row runs the convert, then the tab reads the file again', async () => {
    const host = mount()
    const rows = hook.rows()
    expect(rows.map((r) => r.label)).toEqual(['Turn into a card file'])
    rows[0]!.onToggle!()
    await vi.waitFor(() => expect(host.onReread).toHaveBeenCalled())
    expect(actions.turnIntoCardFile).toHaveBeenCalledWith(PAGE)
  })

  it('other text, two cards, Review off or a folder page\'s Page tab: no row', () => {
    mount({ disk: () => `# Plan\n\n${ONE_CARD}` })
    expect(hook.rows()).toEqual([])
    act(() => root?.unmount())
    mount({ reviewOn: false })
    expect(hook.rows()).toEqual([])
    act(() => root?.unmount())
    mount({ inFolderPage: true })
    expect(hook.rows()).toEqual([])
  })
})
