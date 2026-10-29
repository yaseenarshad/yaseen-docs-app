/**
 * A file's icon outside the tree (YAZ-3440 D11, YAZ-3471): the one resolver (`rowIcon`) through `fileIconAttrs`,
 * App's icons through `IconsContext`, and the tab bar, which draws again on each keystroke and hover of App: its
 * icons do not (`FileIcon` is memoised on its path).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IconRule, VaultIcons } from '@shared/vaultIcons'
import { TabBar, type TabBarProps } from '../tabs/TabBar'
import { FileIcon, IconsContext, fileIconAttrs, type IconsHere } from './FileIcon'
import { buildRowIcons, rowIcon } from './rowIcons'

// Count the resolver's calls: each is one icon drawn.
vi.mock('./rowIcons', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rowIcons')>()
  return { ...real, rowIcon: vi.fn(real.rowIcon) }
})
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: { tree: vi.fn(async (root: string) => ({ root, tree: [], generatedAt: 1 })) } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const RULES: IconRule[] = [{ match: '*.py', kind: 'file', icon: 'lua' }]
const here = (paths: VaultIcons['paths'] = {}, rules: IconRule[] = RULES): IconsHere => ({ rowIcons: buildRowIcons({ '/v': { paths } }, ['/v'], rules, true), roots: ['/v'] })

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.mocked(rowIcon).mockClear()
})
function draw(node: ReactNode): HTMLElement {
  container ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(container)
  act(() => root?.render(node))
  return container
}

describe('a file\'s icon outside the tree (YAZ-3440 D11)', () => {
  it("is the tree row's: a pick, then a rule, then Material; a folder's closed icon; the Line set's kind", () => {
    const h = here({ '/v/mine.md': 'python' })
    expect(fileIconAttrs(h, '/v/mine.md', false)).toEqual({ 'data-kind': 'markdown', 'data-icon': 'python', 'data-icon-custom': '', style: { '--icon': 'url(/material-icons/python.svg)' } })
    expect(fileIconAttrs(h, '/v/a.py', false)['data-icon']).toBe('lua')
    expect(fileIconAttrs(h, '/v/a.ts', false)).toMatchObject({ 'data-kind': 'text', 'data-icon': 'typescript' })
    expect(fileIconAttrs(h, '/v/a.ts', false)['data-icon-custom']).toBeUndefined()
    expect(fileIconAttrs(h, '/v/a.zip', false)['data-kind']).toBe('other')
    expect(fileIconAttrs(h, '/v/src', true)).toMatchObject({ 'data-kind': 'folder', 'data-icon': 'folder-src' })
    expect(fileIconAttrs(h, '/v/notes.md', false)['data-icon']).toBe(rowIcon(h.rowIcons, '/v/notes.md', 'notes.md', 'file').id)
  })

  it("a path outside the window's vaults gets Material's icon: no pick and no rule; so does a mount with no App", () => {
    const h = here({ '/elsewhere/a.py': 'json' })
    expect(fileIconAttrs(h, '/elsewhere/a.py', false)).toMatchObject({ 'data-icon': 'python' })
    expect(fileIconAttrs(h, '/elsewhere/a.py', false)['data-icon-custom']).toBeUndefined()
    expect(fileIconAttrs(null, '/v/a.py', false)['data-icon']).toBe('python')
  })

  it('Folder icons "Plain" (YAZ-3554 S8, S9): a folder in a vault and one outside both get the default folder; a pick in the vault still wins', () => {
    const plain: IconsHere = { rowIcons: buildRowIcons({ '/v': { paths: { '/v/trips': 'folder-images' } } }, ['/v'], [], false), roots: ['/v'] }
    expect(fileIconAttrs(plain, '/v/src', true)['data-icon']).toBe('folder')
    expect(fileIconAttrs(plain, '/elsewhere/src', true)['data-icon']).toBe('folder')
    expect(fileIconAttrs(plain, '/v/trips', true)).toMatchObject({ 'data-icon': 'folder-images', 'data-icon-custom': '' })
    expect(fileIconAttrs(plain, '/v/a.ts', false)['data-icon']).toBe('typescript')
  })

  it('draws one aria-hidden span with the attributes; a new pick from App draws it again', () => {
    const el = draw(<IconsContext.Provider value={here()}><FileIcon path="/v/a.md" /></IconsContext.Provider>)
    const span = el.querySelector<HTMLElement>('.file-icon')!
    expect(span.className).toBe('file-icon file-icon--file')
    expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(span.dataset.icon).toBe('markdown')
    expect(span.style.getPropertyValue('--icon')).toBe('url(/material-icons/markdown.svg)')
    draw(<IconsContext.Provider value={here({ '/v/a.md': 'lua' })}><FileIcon path="/v/a.md" /></IconsContext.Provider>)
    expect(el.querySelector<HTMLElement>('.file-icon')!.dataset.icon).toBe('lua')
    expect(el.querySelector<HTMLElement>('.file-icon')!.hasAttribute('data-icon-custom')).toBe(true)
  })

  it('the tab bar: a re-render (a keystroke, a new title, another active tab) and a hover draw no icon again', () => {
    const h = here()
    const props: TabBarProps = { roots: ['/v'], titles: new Map(), windowId: 'w1', tabs: [{ id: 'a', path: '/v/a.ts' }, { id: 'b', path: '/v/b.md' }], active: 'a', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), canBack: false, canForward: false, onBack: vi.fn(), onForward: vi.fn() }
    const el = draw(<IconsContext.Provider value={h}><TabBar {...props} /></IconsContext.Provider>)
    expect([...el.querySelectorAll<HTMLElement>('.tabbar__label .file-icon')].map((s) => s.dataset.icon)).toEqual(['typescript', 'markdown'])
    const drawn = vi.mocked(rowIcon).mock.calls.length
    expect(drawn).toBe(2)
    draw(<IconsContext.Provider value={h}><TabBar {...props} titles={new Map([['/v/b.md', 'Bee']])} active="b" /></IconsContext.Provider>)
    act(() => void el.querySelector('[data-tab="a"]')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(el.querySelector('[data-tab="b"] .tabbar__label')?.textContent).toBe('Bee')
    expect(vi.mocked(rowIcon).mock.calls.length).toBe(drawn)
  })
})
