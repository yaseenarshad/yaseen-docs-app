// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { FOLDS_KEY, foldSpot, readFolds, writeFolds, type FoldStorage } from '../store/folderFolds'
import { forgetFolderTabs } from './FolderBody'
import { openFolder, waitFor } from './folderTesting'

/**
 * YAZ-5598: a grouped folder table folds on the phone as on the Mac: each group row's ⌄ (a 44 px tap) folds its group,
 * turned › while folded, its count kept; the toolbar's toggle after the count collapses or expands every group. The
 * Mac keeps its folds in its own store (not the folder page file), so the phone keeps its own in this browser, per
 * vault, folder and view; they hold after a reload. Made-up vault (`Projects`, its "By status" view).
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetFolderTabs()
  document.body.replaceChildren()
  localStorage.clear()
})

const byStatus = async () => {
  h = await openFolder('Projects')
  await act(async () => [...h!.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === 'By status')!.click())
  await h.settle()
  await waitFor(h, () => h!.host.querySelector('.folder-table tr.folder-table__group') !== null)
}
const groups = () => [...h!.host.querySelectorAll<HTMLTableRowElement>('.folder-table tr.folder-table__group')]
const rowsOf = (g: HTMLTableRowElement) => {
  const out: HTMLTableRowElement[] = []
  for (let tr = g.nextElementSibling as HTMLTableRowElement | null; tr !== null && !tr.classList.contains('folder-table__group'); tr = tr.nextElementSibling as HTMLTableRowElement | null) out.push(tr)
  return out
}
const name = (g: HTMLTableRowElement) => g.querySelector('.folder-table__label')!.textContent
const count = (g: HTMLTableRowElement) => g.querySelector('.folder-table__count')!.textContent!.trim()
const tap = async (el: Element) => {
  await act(async () => (el as HTMLElement).click())
  await h!.settle()
}
const toggleAll = () => h!.host.querySelector<HTMLButtonElement>('.folder-view__fold')

describe('a grouped folder table folds, as the Mac (YAZ-5598)', () => {
  it("a group's ⌄ folds its rows away and back; the arrow turns, the count stays; the # restarts per group", async () => {
    await byStatus()
    const first = groups()[0]!
    const label = name(first)
    const n = count(first)
    expect(rowsOf(first).length).toBe(Number(n))
    const arrow = first.querySelector<HTMLButtonElement>('.folder-table__fold')!
    expect(arrow.getAttribute('aria-expanded')).toBe('true')
    expect(arrow.getAttribute('aria-label')).toBe(`Toggle group ${label}`)
    await tap(arrow)
    const shut = groups().find((g) => name(g) === label)!
    expect(rowsOf(shut)).toEqual([])
    expect(count(shut)).toBe(n)
    expect(shut.querySelector('.folder-table__fold')!.getAttribute('aria-expanded')).toBe('false')
    expect(shut.dataset.folded).toBe('')
    // The other groups keep their rows; numbered from 1.
    const other = groups().find((g) => name(g) !== label)!
    expect(rowsOf(other).map((tr) => tr.cells[0]!.textContent)[0]).toBe('1')
    await tap(shut.querySelector('.folder-table__fold')!)
    expect(rowsOf(groups().find((g) => name(g) === label)!).length).toBe(Number(n))
  })

  it('the toolbar toggle collapses every group, then expands them all', async () => {
    await byStatus()
    expect(toggleAll()!.getAttribute('aria-label')).toBe('Collapse all groups')
    await tap(toggleAll()!)
    expect(groups().length).toBeGreaterThan(1)
    expect(groups().every((g) => rowsOf(g).length === 0 && g.dataset.folded === '')).toBe(true)
    expect(h!.host.querySelectorAll('.folder-table tr[data-row]').length).toBe(0)
    expect(toggleAll()!.getAttribute('aria-label')).toBe('Expand all groups')
    await tap(toggleAll()!)
    expect(groups().every((g) => rowsOf(g).length === Number(count(g)))).toBe(true)
    expect(toggleAll()!.getAttribute('aria-label')).toBe('Collapse all groups')
  })

  it('the folds hold after a reload; a view with no groups has no toggle', async () => {
    await byStatus()
    const label = name(groups()[0]!)
    await tap(groups()[0]!.querySelector('.folder-table__fold')!)
    expect(localStorage.getItem(FOLDS_KEY)).toContain('By status')
    await act(async () => closeAll())
    h!.unmount()
    forgetSearch()
    forgetFolderTabs()
    document.body.replaceChildren()
    await byStatus()
    const again = groups().find((g) => name(g) === label)!
    expect(rowsOf(again)).toEqual([])
    expect(groups().filter((g) => g !== again).every((g) => rowsOf(g).length === Number(count(g)))).toBe(true)
    // The Table view is not grouped: no toggle.
    await act(async () => [...h!.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === 'Table')!.click())
    await h!.settle()
    expect(toggleAll()).toBeNull()
  })

  it('the store: per vault, folder and view; a broken or missing storage reads none and writes nothing', () => {
    const map = new Map<string, string>()
    const storage: FoldStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
    const a = foldSpot('demo', 'Projects', 'By status')
    const b = foldSpot('demo', 'Projects', 'Other')
    writeFolds(a, ['v:Idea'], storage)
    expect(readFolds(a, storage)).toEqual(['v:Idea'])
    expect(readFolds(b, storage)).toEqual([])
    writeFolds(a, [], storage)
    expect(JSON.parse(map.get(FOLDS_KEY)!)).toEqual({})
    map.set(FOLDS_KEY, '{not json')
    expect(readFolds(a, storage)).toEqual([])
    const broken: FoldStorage = { getItem: () => { throw new Error('private') }, setItem: () => { throw new Error('full') } }
    expect(readFolds(a, broken)).toEqual([])
    expect(() => writeFolds(a, ['v:Idea'], broken)).not.toThrow()
    expect(readFolds(a, null)).toEqual([])
  })

  it('the arrow is a 44 px tap; the group row a tap tall; folded it turns right; none in the full-screen copy', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'folders.css'), 'utf8')
    expect(css).toMatch(/\.folder-table__fold \{[^}]*width: var\(--tap\);[^}]*height: var\(--tap\);/)
    expect(css).toMatch(/\.folder-table__fold\[aria-expanded='false'\] svg \{\s*transform: rotate\(-90deg\);/)
    expect(css).toMatch(/\.table-view \.folder-table__fold \{\s*display: none;/)
    expect(css).toMatch(/\.folder-view__fold \{[^}]*width: var\(--tap\);[^}]*height: var\(--tap\);/)
  })
})
