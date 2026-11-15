// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { treeIconsOf } from '../search/treeIcons'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5488: the Search tree shows the vault's own icons (`.yaseendocs/icons.json` version 2: a row's pick, then the
 * first name rule of its kind) as Material's file, and its icon colours as the Mac's `--kind-<kind>`. No file, or no
 * rules and colours: the look before. Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(files: typeof READER_FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  return x
}
const iconOf = (x: Harness, label: string) => [...x.host.querySelectorAll<HTMLElement>('.tree .tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === label)?.querySelector<HTMLElement>('.file-icon')

describe('treeIconsOf (YAZ-5488)', () => {
  it('a pick wins over a rule; a rule matches the name and kind in any case; colours become the Mac variables; a bad file is the look before', () => {
    const icons = treeIconsOf({ version: 2, paths: { 'Trip plan.md': 'lua' }, rules: [{ match: '*.MD', kind: 'file', icon: 'python' }, { match: 'git', kind: 'folder', icon: 'folder-git' }], colors: { card: '#aa00ff', nope: '#000000' } })
    expect(icons.pick('Trip plan.md', 'Trip plan.md', 'file')).toBe('lua')
    expect(icons.pick('Café notes.md', 'Café notes.md', 'file')).toBe('python')
    expect(icons.pick('git', 'git', 'folder')).toBe('folder-git')
    expect(icons.pick('git', 'git', 'file')).toBeNull()
    expect(icons.style).toEqual({ '--kind-card': '#aa00ff' })
    expect(icons.colored).toBe('card')
    expect(treeIconsOf('nope').pick('a.md', 'a.md', 'file')).toBeNull()
    expect(treeIconsOf({ version: 1, paths: {} }).style).toEqual({})
  })
})

describe('the Search tree draws the vault\'s own icons and colours (YAZ-5488)', () => {
  it('rules and picks as Material\'s file; a folder\'s open twin while open; colours on the tree; an icon that does not load is the kind\'s glyph', async () => {
    const icons = { version: 2, paths: { 'Trip plan.md': 'lua' }, rules: [{ match: '*.md', kind: 'file', icon: 'python' }, { match: 'git', kind: 'folder', icon: 'folder-git' }], colors: { page: '#123456', card: '#aa00ff' } }
    h = await openSearch({ ...READER_FILES, '.yaseendocs/icons.json': JSON.stringify(icons) })
    await waitFor(h, () => iconOf(h!, 'Trip plan')?.tagName === 'IMG')
    expect(iconOf(h, 'Trip plan')?.getAttribute('src')).toBe('/material-icons/lua.svg')
    expect(iconOf(h, 'Café notes')?.getAttribute('src')).toBe('/material-icons/python.svg')
    expect(iconOf(h, 'git')?.getAttribute('src')).toBe('/material-icons/folder-git.svg')
    // A folder without a rule keeps the phone's glyph.
    expect(iconOf(h, 'cards')?.getAttribute('data-kind')).toBe('folder')
    const tree = h.host.querySelector<HTMLElement>('.tree')!
    expect(tree.style.getPropertyValue('--kind-page')).toBe('#123456')
    expect(tree.style.getPropertyValue('--kind-card')).toBe('#aa00ff')
    expect(tree.getAttribute('data-icon-colors')).toBe('page card')
    await h.click(/^git, folder/)
    expect(iconOf(h, 'git')?.getAttribute('src')).toBe('/material-icons/folder-git-open.svg')
    // The open twin does not load: the icon; then its clone file; then the folder glyph.
    await act(async () => void iconOf(h!, 'git')!.dispatchEvent(new Event('error')))
    expect(iconOf(h, 'git')?.getAttribute('src')).toBe('/material-icons/folder-git.svg')
    await act(async () => void iconOf(h!, 'git')!.dispatchEvent(new Event('error')))
    expect(iconOf(h, 'git')?.getAttribute('src')).toBe('/material-icons/folder-git.clone.svg')
    await act(async () => void iconOf(h!, 'git')!.dispatchEvent(new Event('error')))
    expect(iconOf(h, 'git')?.tagName).toBe('SPAN')
    expect(iconOf(h, 'git')?.getAttribute('data-kind')).toBe('folder')
  })

  it('no icons.json: the look before', async () => {
    h = await openSearch(READER_FILES)
    await h.settle()
    expect(iconOf(h, 'Trip plan')?.tagName).toBe('SPAN')
    expect(h.host.querySelector('.tree')?.hasAttribute('data-icon-colors')).toBe(false)
  })
})
