import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { buildViewOnlyCatalog, buildViewOnlyCatalogFromEntries } from './viewOnlyCatalog'

const file = (path: string, kind: 'markdown' | 'text' | 'pdf' | 'image'): TreeNode => ({
  type: 'file',
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind,
  size: 1,
  mtime: 1,
})

describe('view-only catalog (YAZ-1310)', () => {
  const tree: TreeNode[] = [
    file('/vault/Guide.md', 'markdown'),
    file('/vault/data.json', 'text'),
    file('/vault/photo.PNG', 'image'),
    { type: 'dir', name: 'deep', path: '/vault/deep', children: [
      file('/vault/deep/data.JSON', 'text'),
      file('/vault/deep/tool.PY', 'text'),
      file('/vault/deep/report.PDF', 'pdf'),
      { type: 'dir', name: 'nested', path: '/vault/deep/nested', children: [file('/vault/deep/nested/Outbound Lead Qualifier.json', 'text')] },
    ] },
    { type: 'dir', name: 'z', path: '/vault/z', children: [file('/vault/z/data.json', 'text')] },
  ]

  it('flattens every non-Markdown viewer kind in deterministic path order', () => {
    expect(buildViewOnlyCatalog('/vault', tree).entries).toEqual([
      { path: '/vault/data.json', name: 'data.json', kind: 'text' },
      { path: '/vault/deep/data.JSON', name: 'data.JSON', kind: 'text' },
      { path: '/vault/deep/nested/Outbound Lead Qualifier.json', name: 'Outbound Lead Qualifier.json', kind: 'text' },
      { path: '/vault/deep/report.PDF', name: 'report.PDF', kind: 'pdf' },
      { path: '/vault/deep/tool.PY', name: 'tool.PY', kind: 'text' },
      { path: '/vault/photo.PNG', name: 'photo.PNG', kind: 'image' },
      { path: '/vault/z/data.json', name: 'data.json', kind: 'text' },
    ])
  })

  it('resolves exact root-relative paths and case-insensitive basenames', () => {
    const catalog = buildViewOnlyCatalog('/vault', tree)
    expect(catalog.resolve('deep/tool.PY')).toBe('/vault/deep/tool.PY')
    expect(catalog.resolve('deep/TOOL.PY')).toBeNull() // pathed targets are exact
    expect(catalog.resolve('REPORT.pdf')).toBe('/vault/deep/report.PDF')
    expect(catalog.resolve('Outbound Lead Qualifier.JSON')).toBe('/vault/deep/nested/Outbound Lead Qualifier.json')
    expect(catalog.resolve('PHOTO.png')).toBe('/vault/photo.PNG')
    expect(catalog.resolve('Guide.md')).toBeNull()
  })

  it('gives a duplicate basename to the shallowest deterministic winner and spells every target unambiguously', () => {
    const catalog = buildViewOnlyCatalog('/vault', tree)
    expect(catalog.resolve('DATA.JSON')).toBe('/vault/data.json')
    expect(catalog.linkName('/vault/data.json')).toBe('data.json')
    expect(catalog.linkName('/vault/deep/data.JSON')).toBe('deep/data.JSON')
    expect(catalog.linkName('/vault/z/data.json')).toBe('z/data.json')
    expect(catalog.linkName('/vault/deep/nested/Outbound Lead Qualifier.json')).toBe('Outbound Lead Qualifier.json')
    expect(catalog.linkName('/vault/missing.json')).toBeNull()
    expect(catalog.candidates.map(({ insert, path }) => [insert, path])).toEqual([
      ['data.json', '/vault/data.json'],
      ['deep/data.JSON', '/vault/deep/data.JSON'],
      ['Outbound Lead Qualifier.json', '/vault/deep/nested/Outbound Lead Qualifier.json'],
      ['report.PDF', '/vault/deep/report.PDF'],
      ['tool.PY', '/vault/deep/tool.PY'],
      ['photo.PNG', '/vault/photo.PNG'],
      ['z/data.json', '/vault/z/data.json'],
    ])
  })

  it('breaks equal-depth duplicate ties by deterministic path order', () => {
    const catalog = buildViewOnlyCatalog('/vault', [
      { type: 'dir', name: 'z', path: '/vault/z', children: [file('/vault/z/same.json', 'text')] },
      { type: 'dir', name: 'a', path: '/vault/a', children: [file('/vault/a/SAME.JSON', 'text')] },
    ])
    expect(catalog.resolve('same.json')).toBe('/vault/a/SAME.JSON')
    expect(catalog.linkName('/vault/a/SAME.JSON')).toBe('SAME.JSON')
    expect(catalog.linkName('/vault/z/same.json')).toBe('z/same.json')
  })

  it('rebuilds the same deterministic lookup from an already-flattened rename snapshot', () => {
    const initial = buildViewOnlyCatalog('/vault', tree)
    const rebuilt = buildViewOnlyCatalogFromEntries('/vault', initial.entries.map((entry) =>
      entry.path === '/vault/data.json' ? { ...entry, path: '/vault/moved/data.json' } : entry,
    ))
    expect(rebuilt.resolve('data.json')).toBe('/vault/deep/data.JSON')
    expect(rebuilt.linkName('/vault/moved/data.json')).toBe('moved/data.json')
    expect(rebuilt.candidates.map((candidate) => candidate.path)).toContain('/vault/moved/data.json')
  })
})
