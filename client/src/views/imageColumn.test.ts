/**
 * The Image column (YAZ-4802 demo), its data side: what `.folder.md` holds for one (`kind: image`, `size` 12–240 with
 * the default 18 never written, `shape`), the kind switch dropping the look, the filter offering only empty / not
 * empty, and a sort that goes by the picture's file name, not the folder the picture is in.
 */
import { describe, expect, it, vi } from 'vitest'
import { IMAGE_SIZE_DEFAULT, IMAGE_SIZE_MAX, IMAGE_SIZE_MIN, type IndexRecord } from '@shared/types'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(async () => ({ mtime: 1 })), transformFile: vi.fn() }))
import { writeProperty } from './writeProperty'
import { folderSettings, writeFolderSettings } from './folderSettings'
import { declarationForKind } from './view/declarationForKind'
import { OPERATORS_BY_TYPE, operatorsFor } from './view/filterRows'
import { runView } from './engine'
import { TEST_RECORDS } from './testRecords'

const FOLDER = '/vault/Tools/.folder.md'
const rec = (path: string, properties: Record<string, unknown>): IndexRecord =>
  ({ ...TEST_RECORDS[0], path, name: path.slice(path.lastIndexOf('/') + 1), basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), folder: 'Tools', properties }) as IndexRecord
const settingsOf = (columns: unknown) => folderSettings(rec(FOLDER, { folder_settings: { columns } }), true)

describe('YAZ-4802 demo: folderSettings reads an Image column', () => {
  it('YAZ-4802 demo: `kind: image` reads as an Image column, with no size or shape when none is written', () => {
    const s = settingsOf({ Logo: { kind: 'image' } })
    expect(s.columns.Logo).toEqual({ kind: 'image' })
    expect(s.problems).toEqual([])
  })

  it('YAZ-4802 demo: a size from 12 to 240 and a shape read back; the default 18 is never kept (absent is 18)', () => {
    expect(settingsOf({ Logo: { kind: 'image', size: 32, shape: 'rounded' } }).columns.Logo).toEqual({ kind: 'image', size: 32, shape: 'rounded' })
    expect(settingsOf({ Logo: { kind: 'image', size: IMAGE_SIZE_MIN, shape: 'circle' } }).columns.Logo).toEqual({ kind: 'image', size: 12, shape: 'circle' })
    expect(settingsOf({ Logo: { kind: 'image', size: IMAGE_SIZE_MAX } }).columns.Logo).toEqual({ kind: 'image', size: 240 })
    const dflt = settingsOf({ Logo: { kind: 'image', size: IMAGE_SIZE_DEFAULT } })
    expect(dflt.columns.Logo).toEqual({ kind: 'image' })
    expect(dflt.problems).toEqual([])
  })

  it('YAZ-4802 demo: a size out of 12–240, not whole, or on another kind is a problem and costs only the size', () => {
    for (const size of [11, 241, 18.5, '32']) {
      const s = settingsOf({ Logo: { kind: 'image', size, shape: 'circle' } })
      expect(s.columns.Logo).toEqual({ kind: 'image', shape: 'circle' })
      expect(s.problems).toHaveLength(1)
      expect(s.problems[0]).toMatch(/Logo\.size/)
    }
    const onText = settingsOf({ Name: { kind: 'text', size: 32 } })
    expect(onText.columns.Name).toEqual({ kind: 'text' })
    expect(onText.problems[0]).toMatch(/Name\.size/)
  })

  it('YAZ-4802 demo: a shape that is not rounded / circle, or on another kind, is a problem and shows the picture as is', () => {
    const bad = settingsOf({ Logo: { kind: 'image', shape: 'square', size: 24 } })
    expect(bad.columns.Logo).toEqual({ kind: 'image', size: 24 })
    expect(bad.problems[0]).toMatch(/Logo\.shape/)
    const onText = settingsOf({ Name: { kind: 'text', shape: 'circle' } })
    expect(onText.columns.Name).toEqual({ kind: 'text' })
    expect(onText.problems[0]).toMatch(/Name\.shape/)
  })

  it('YAZ-4802 demo: the removed `beforeName` switch is not read into the column', () => {
    expect(settingsOf({ Logo: { kind: 'image', beforeName: true } }).columns.Logo).toEqual({ kind: 'image' })
  })

  it('YAZ-4802 demo: writeFolderSettings writes the Image column with its size and shape as the one settings key', async () => {
    const s = settingsOf({ Logo: { kind: 'image', size: 32, shape: 'rounded' } })
    await writeFolderSettings(FOLDER, s)
    expect(vi.mocked(writeProperty)).toHaveBeenCalledWith(FOLDER, 'folder_settings', expect.objectContaining({ columns: { Logo: { kind: 'image', size: 32, shape: 'rounded' } } }))
  })
})

describe('YAZ-4802 demo: declarationForKind keeps the look only on an Image column', () => {
  it('YAZ-4802 demo: a kind change away from Image drops size and shape', () => {
    for (const kind of ['text', 'number', 'select', 'link'] as const) {
      const next = declarationForKind({ kind: 'image', size: 32, shape: 'circle' }, kind)
      expect(next.kind).toBe(kind)
      expect(next).not.toHaveProperty('size')
      expect(next).not.toHaveProperty('shape')
    }
  })

  it('YAZ-4802 demo: staying an Image column keeps size and shape; a Select turned Image loses its options', () => {
    expect(declarationForKind({ kind: 'image', size: 32, shape: 'circle' }, 'image')).toEqual({ kind: 'image', size: 32, shape: 'circle' })
    expect(declarationForKind({ kind: 'select', options: [{ name: 'A' }] } as never, 'image')).toEqual({ kind: 'image' })
  })
})

describe('YAZ-4802 demo: an Image column filters on whether a row has a picture', () => {
  it('YAZ-4802 demo: the filter offers only is empty / is not empty', () => {
    expect(OPERATORS_BY_TYPE.image).toEqual(['isEmpty', 'isNotEmpty'])
    expect(operatorsFor('Logo', 'image').map((o) => o.id)).toEqual(['isEmpty', 'isNotEmpty'])
  })
})

describe('YAZ-4802 demo: an Image column sorts by the picture file name', () => {
  const recs = [
    rec('/vault/Tools/Zed.md', { Logo: '[[assets/images/apple.png]]' }),
    rec('/vault/Tools/Ant.md', { Logo: '[[zz/cloudflare.svg]]' }),
    rec('/vault/Tools/Bee.md', { Logo: '[[aa/zebra.png]]' }),
    rec('/vault/Tools/None.md', {}),
  ]
  const names = (direction: 'ASC' | 'DESC', byFileName?: (p: string) => boolean) =>
    runView({ views: [] }, { type: 'table', name: 'T', order: ['file.name', 'Logo'], sort: [{ property: 'Logo', direction }] }, recs, byFileName === undefined ? {} : { byFileName }).rows.map((r) => r.record.basename)

  it('YAZ-4802 demo: A to Z by file name, whatever folder the picture is in; a row with no picture is last', () => {
    expect(names('ASC', (p) => p === 'Logo')).toEqual(['Zed', 'Ant', 'Bee', 'None'])
  })

  it('YAZ-4802 demo: Z to A reverses the file names', () => {
    expect(names('DESC', (p) => p === 'Logo').slice(0, 3)).toEqual(['Bee', 'Ant', 'Zed'])
  })

  it('YAZ-4802 demo: without byFileName the same column sorts by the whole path (the folder first), so the option matters', () => {
    expect(names('ASC').slice(0, 3)).not.toEqual(['Zed', 'Ant', 'Bee'])
  })
})
