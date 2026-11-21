import { describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from '../../links/viewOnlyCatalog'
import { createViewOnlyLinkSource, viewOnlyLinkTarget } from './viewOnlyLinkSource'

const node = (path: string, kind: 'text' | 'pdf'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })

describe('ViewOnlyLinkSource (YAZ-1310)', () => {
  it('is explicitly unready before the first catalog and exposes no semantic records surface', () => {
    const source = createViewOnlyLinkSource()
    expect(source.ready).toBe(false)
    expect(source.resolve).toBeNull()
    expect(source.catalog).toBeNull()
    expect(source.targets).toEqual([])
    expect('records' in source).toBe(false)
  })

  it('swaps one immutable catalog boundary and notifies subscribers', () => {
    const source = createViewOnlyLinkSource()
    const wake = vi.fn()
    const unsubscribe = source.subscribe(wake)
    const catalog = buildViewOnlyCatalog('/vault', [node('/vault/data.JSON', 'text'), node('/vault/deep/report.pdf', 'pdf')])
    source.update(catalog)
    expect(source.ready).toBe(true)
    expect(source.catalog).toBe(catalog)
    expect(source.targets).toBe(catalog.entries)
    expect(source.resolve?.('DATA.json')).toBe('/vault/data.JSON')
    expect(wake).toHaveBeenCalledTimes(1)
    unsubscribe()
    source.update(buildViewOnlyCatalog('/vault', []))
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('resets resolver, targets and readiness synchronously and wakes subscribers once', () => {
    const source = createViewOnlyLinkSource()
    source.update(buildViewOnlyCatalog('/vault', [node('/vault/data.json', 'text')]))
    const wake = vi.fn()
    source.subscribe(wake)

    source.reset()

    expect(source.ready).toBe(false)
    expect(source.catalog).toBeNull()
    expect(source.resolve).toBeNull()
    expect(source.targets).toEqual([])
    expect(wake).toHaveBeenCalledTimes(1)
  })
})

describe('viewOnlyLinkTarget: the page side of the link (YAZ-4935)', () => {
  it('reads the page before the |, with its heading apart', () => {
    expect(viewOnlyLinkTarget('deep/report.pdf|the report')).toEqual({ page: 'deep/report.pdf', raw: 'deep/report.pdf', hasSubtarget: false })
    expect(viewOnlyLinkTarget(' report.pdf#p2 |the report')).toEqual({ page: 'report.pdf', raw: 'report.pdf#p2', hasSubtarget: true })
    expect(viewOnlyLinkTarget('Page|words')).toBeNull()
  })

  it('a view-only name is no ID, so words first keep the left side as the page: null, as for any name', () => {
    expect(viewOnlyLinkTarget('the report|report.pdf')).toBeNull()
  })
})
