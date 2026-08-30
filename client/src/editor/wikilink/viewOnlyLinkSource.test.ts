import { describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from '../../links/viewOnlyCatalog'
import { createViewOnlyLinkSource } from './viewOnlyLinkSource'

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
    expect(source.linkName('/vault/deep/report.pdf')).toBe('report.pdf')
    expect(wake).toHaveBeenCalledTimes(1)
    unsubscribe()
    source.update(buildViewOnlyCatalog('/vault', []))
    expect(wake).toHaveBeenCalledTimes(1)
  })
})
