// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { NavAction } from '../app/nav'
import { DEFAULT_LINK_CLICK, setLinkClick } from '../explore/openFile'
import { closeAll, sheetStack } from '../explore/sheets'
import type { VaultData } from '../search/vaultData'
import { linkRoute, openLink } from './openLink'
import { tapOf } from './pageDom'

/** The reader's ONE link door goes through the app's ONE door to open a file (`openFile`, YAZ-5472). Made-up paths only. */
afterEach(() => closeAll())

const door = (click?: 'open' | 'explore', vaultKey: string | null = 'v') => {
  const went: NavAction[] = []
  return { went, door: { go: (a: NavAction) => void went.push(a), vaultKey, click } }
}

describe('the link door (YAZ-5455, YAZ-5472, YAZ-5473)', () => {
  it('the default is the Mac\'s: a link opens full screen', () => {
    expect(DEFAULT_LINK_CLICK).toBe('open')
    const d = door(undefined, 'unknown-vault')
    openLink(d.door, { kind: 'page', path: 'a.md', heading: 'Part' })
    expect(d.went).toEqual([{ type: 'open', route: { kind: 'page', path: 'a.md', heading: 'Part' } }])
    expect(sheetStack()).toHaveLength(0)
  })

  it('"explore" (the reader\'s read, or the app\'s copy when the reader has not read it yet): a sheet', () => {
    const d = door('explore')
    openLink(d.door, { kind: 'card', path: 'c.md', id: 'DEMO-1' })
    expect(d.went).toEqual([])
    expect(sheetStack().map((s) => s.route)).toEqual([{ kind: 'card', path: 'c.md', id: 'DEMO-1' }])
    setLinkClick('v2', 'explore')
    openLink(door(undefined, 'v2').door, { kind: 'page', path: 'b.md' })
    expect(sheetStack()).toHaveLength(2)
  })

  it('a link to a drawing file opens the drawing (its own route), not the file', () => {
    expect(linkRoute({ kind: 'drawing', path: 'art/Plan.excalidraw' })).toEqual({ kind: 'drawing', path: 'art/Plan.excalidraw' })
    const a = Object.assign(document.createElement('a'), { href: '#' })
    a.dataset.open = 'file'
    a.dataset.path = 'art/Flow.drawio.svg'
    expect(tapOf(a, {} as VaultData)).toEqual({ kind: 'go', target: { kind: 'drawing', path: 'art/Flow.drawio.svg' } })
    a.dataset.path = 'docs/manual.pdf'
    expect(tapOf(a, {} as VaultData)).toEqual({ kind: 'file', path: 'docs/manual.pdf' })
    const d = door('explore')
    openLink(d.door, { kind: 'drawing', path: 'art/Plan.excalidraw' })
    expect(sheetStack().at(-1)?.route).toEqual({ kind: 'drawing', path: 'art/Plan.excalidraw' })
  })
})
