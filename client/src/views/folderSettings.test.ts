/**
 * Folder page settings (YAZ-830): the ONE door to `folder_page_settings`. Each case pins a
 * locked rule — tolerant parsing (report, never block, never throw), DEFAULT_VIEWS (Table, Board),
 * the 7 property kinds, parseViews's own view assertion mirrored, and a FOLDER's defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'

/** `transformFile`'s stand-in: the file the ONE label write reads and rewrites (YAZ-1513). */
const { disk } = vi.hoisted(() => ({ disk: { content: '' } }))
vi.mock('./writeProperty', () => ({
  writeProperty: vi.fn(),
  transformFile: vi.fn(async (_path: string, transform: (content: string) => string) => {
    disk.content = transform(disk.content)
    return { mtime: 1, content: disk.content }
  }),
}))
import { writeProperty } from './writeProperty'
import { DEFAULT_COLUMNS, DEFAULT_VIEWS, folderSettings, writeFolderSettings } from './folderSettings'

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const METRICS = '/vault/Metrics/.folder.md'

/** A folder's settings file carrying this settings value, parsed. */
const settingsOf = (value: unknown) => folderSettings(rec(METRICS, { folder_page_settings: value }))

const TABLE_BOARD = [
  { type: 'table', name: 'Table' },
  { type: 'board', name: 'Board' },
]

describe('defaults (Q7, amended YAZ-935, YAZ-2290 D5a): a folder that lists NO views gets its two skins, Table then Board', () => {
  it('DEFAULT_VIEWS is two — no Outline (D5a) — and each parse hands back its own copy', () => {
    expect(DEFAULT_VIEWS.map((v) => v.type)).toEqual(['table', 'board'])
    const a = folderSettings(undefined)
    const b = folderSettings(undefined)
    expect(a.views).not.toBe(b.views)
    expect(a.views[0]).not.toBe(b.views[0])
  })

  it.each([
    ['a string', 'table'],
    ['a number', 3],
    ['a list', [{ type: 'table', name: 'Table' }]],
  ])('a settings key that is %s is ONE problem plus full defaults', (_label, value) => {
    const settings = settingsOf(value)
    expect(settings.problems).toHaveLength(1)
    expect(settings.views).toEqual(TABLE_BOARD)
    expect(settings.columns).toEqual({})
  })
})

describe("a FOLDER's settings (YAZ-2290 D1/E2): its `.folder.md`, else the defaults", () => {
  const FILE = '/vault/Projects/.folder.md'

  it('no settings file: the default views and the default Status column', () => {
    expect(folderSettings(undefined)).toEqual({ columns: DEFAULT_COLUMNS, views: TABLE_BOARD, problems: [] })
  })

  it('a file that has saved NO settings yet is the defaults too, each read its own copy', () => {
    const a = folderSettings(rec(FILE, {}))
    expect(a).toEqual({ columns: DEFAULT_COLUMNS, views: TABLE_BOARD, problems: [] })
    expect(folderSettings(rec(FILE, { folder_page_settings: null }))).toEqual(a)
    expect(a.columns).not.toBe(DEFAULT_COLUMNS)
    expect(a.columns.status).not.toBe(folderSettings(rec(FILE, {})).columns.status)
  })

  it('once saved, the file states exactly which columns the folder has — Status is not added back', () => {
    expect(folderSettings(rec(FILE, { folder_page_settings: { columns: { owner: { kind: 'text' } } } })).columns).toEqual({ owner: { kind: 'text' } })
    expect(folderSettings(rec(FILE, { folder_page_settings: { views: [{ type: 'table', name: 'Table' }] } })).columns).toEqual({})
  })
})

describe("columns: the 7 property kinds, report-don't-block", () => {
  it('parses declared columns, keeping kind, target and a boolean required', () => {
    const settings = settingsOf({
      columns: {
        owner: { kind: 'text' },
        kpis: { kind: 'multi-link', target: '[[KPIs]]' },
        due: { kind: 'date', required: true },
      },
    })
    expect(settings.columns).toEqual({
      owner: { kind: 'text' },
      kpis: { kind: 'multi-link', target: '[[KPIs]]' },
      due: { kind: 'date', required: true },
    })
    expect(settings.problems).toEqual([])
  })

  it('an unknown kind is a problem and the column is treated as ABSENT', () => {
    const settings = settingsOf({ columns: { owner: { kind: 'text' }, weird: { kind: 'rating' } } })
    expect(Object.keys(settings.columns)).toEqual(['owner'])
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('weird')
  })

  it('a non-map column value is a problem and the column is absent', () => {
    const settings = settingsOf({ columns: { owner: 'text', nope: null } })
    expect(settings.columns).toEqual({})
    expect(settings.problems).toHaveLength(2)
  })

  it('a non-boolean required is a problem and only that key is dropped — the column stays', () => {
    const settings = settingsOf({ columns: { owner: { kind: 'text', required: 'yes' } } })
    expect(settings.columns).toEqual({ owner: { kind: 'text' } })
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('required')
  })

  it('a non-map columns value is a problem and no columns are declared', () => {
    const settings = settingsOf({ columns: ['owner'] })
    expect(settings.columns).toEqual({})
    expect(settings.problems).toHaveLength(1)
  })
})

describe('views: parseViews\'s own assertion, mirrored', () => {
  it('keeps view order, and unknown types and extra keys pass through untouched', () => {
    const settings = settingsOf({
      views: [
        { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
        { type: 'gantt', name: 'Table', columnSize: { owner: 120 }, zoom: 3 },
      ],
    })
    expect(settings.views).toEqual([
      { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
      { type: 'gantt', name: 'Table', columnSize: { owner: 120 }, zoom: 3 },
    ])
    expect(settings.views[1].zoom).toBe(3)
    expect(settings.problems).toEqual([])
  })

  it('an entry missing name (or type, or not a map) is dropped with a problem; the rest survive', () => {
    const settings = settingsOf({
      views: [{ type: 'outline' }, { type: 'table', name: 'Table' }, 'table', { name: 'Nameless' }],
    })
    expect(settings.views).toEqual([{ type: 'table', name: 'Table' }])
    expect(settings.problems).toHaveLength(3)
  })

  it('a persisted list WITHOUT a board reads back without one — what the card says is what you get (YAZ-1471)', () => {
    const settings = settingsOf({ views: [{ type: 'table', name: 'My table' }] })
    expect(settings.views).toEqual([{ type: 'table', name: 'My table' }])
    expect(settings.problems).toEqual([])
  })

  it('a persisted list WITH a board — whatever its name — passes through untouched', () => {
    const views = [
      { type: 'board', name: 'Kanban', groupBy: { property: 'note.status' } },
      { type: 'table', name: 'Table' },
    ]
    const settings = settingsOf({ views })
    expect(settings.views).toEqual(views)
    expect(settings.problems).toEqual([])
  })

  it('a string outline rides along verbatim (🔒 D2: the view IS its markdown bullet list)', () => {
    const settings = settingsOf({ views: [{ type: 'outline', name: 'Outline', outline: '- [[CAC]]\n    - [[LTV]]' }] })
    expect(settings.views).toEqual([{ type: 'outline', name: 'Outline', outline: '- [[CAC]]\n    - [[LTV]]' }])
    expect(settings.problems).toEqual([])
  })

  it('a non-string outline is a problem and only THAT key is dropped — the view stays', () => {
    const settings = settingsOf({ views: [{ type: 'outline', name: 'Outline', outline: ['[[CAC]]'], limit: 3 }] })
    expect(settings.views).toEqual([{ type: 'outline', name: 'Outline', limit: 3 }])
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('outline')
  })

  it('a non-list views is a problem and yields DEFAULT_VIEWS', () => {
    const settings = settingsOf({ views: 'table' })
    expect(settings.views).toEqual(TABLE_BOARD)
    expect(settings.problems).toHaveLength(1)
  })

  it('an empty list yields DEFAULT_VIEWS quietly — a folder page always has its two skins', () => {
    const settings = settingsOf({ views: [] })
    expect(settings.views).toEqual(TABLE_BOARD)
    expect(settings.problems).toEqual([])
  })

  it('views whose entries ALL fail fall back to DEFAULT_VIEWS, problems recorded', () => {
    const settings = settingsOf({ views: [{ type: 'outline' }] })
    expect(settings.views).toEqual(TABLE_BOARD)
    expect(settings.problems).toHaveLength(1)
  })
})

describe('defaultView (YAZ-1104): the saved starting view', () => {
  const write = vi.mocked(writeProperty)

  it('reads a string name, and absent stays undefined — zero problems either way', () => {
    expect(settingsOf({ defaultView: 'Table' }).defaultView).toBe('Table')
    expect(settingsOf({ defaultView: 'Table' }).problems).toEqual([])
    expect(settingsOf({}).defaultView).toBeUndefined()
    expect(folderSettings(undefined).defaultView).toBeUndefined()
  })

  it.each([
    ['a number', 3],
    ['a list', ['Table']],
    ['a map', { name: 'Table' }],
  ])('%s is ONE problem and reads as absent', (_label, value) => {
    const settings = settingsOf({ defaultView: value })
    expect(settings.defaultView).toBeUndefined()
    expect(settings.problems).toHaveLength(1)
  })

  it("a name matching no view still reads verbatim — staleness is the pane's concern, not a problem", () => {
    expect(settingsOf({ defaultView: 'Ghost' }).defaultView).toBe('Ghost')
    expect(settingsOf({ defaultView: 'Ghost' }).problems).toEqual([])
  })

  it('round-trips to disk, and an unset value never reaches the key', async () => {
    write.mockReset()
    write.mockResolvedValue({ mtime: 200 })
    await writeFolderSettings(METRICS, settingsOf({ defaultView: 'Table' }))
    expect(write.mock.calls[0][2]).toMatchObject({ defaultView: 'Table' })
    await writeFolderSettings(METRICS, settingsOf({}))
    expect(write.mock.calls[1][2]).not.toHaveProperty('defaultView')
  })
})

describe('writeFolderSettings: ONE key, through the shared writer', () => {
  const write = vi.mocked(writeProperty)

  beforeEach(() => {
    write.mockReset()
    write.mockResolvedValue({ mtime: 200 })
  })

  it('round-trips a parsed settings value as a plain object under the one key', async () => {
    const raw = {
      columns: { owner: { kind: 'text' }, kpis: { kind: 'multi-link', target: '[[KPIs]]' } },
      views: [
        { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
        { type: 'table', name: 'Table', order: ['file.name', 'owner'], columnSize: { owner: 120 }, zoom: 3 },
      ],
    }
    const settings = settingsOf(raw)

    await expect(writeFolderSettings(METRICS, settings)).resolves.toMatchObject({ mtime: 200 })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', raw)
  })

  it('never serializes problems, and omits empty columns', async () => {
    const settings = settingsOf({ defaultView: 7, views: [{ type: 'table', name: 'Table' }] })
    expect(settings.problems).toHaveLength(1)

    await writeFolderSettings(METRICS, settings)

    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', { views: [{ type: 'table', name: 'Table' }] })
  })

  it('writes undefined to DELETE the key when the caller explicitly asks for it', async () => {
    await writeFolderSettings(METRICS, undefined)
    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', undefined)
  })
})

it('reads ordered select options tolerantly without changing raw config', () => {
  const raw = { columns: { status: { kind: 'select', options: ['Done', 'Ready', '', 'Done', 7] }, tags: { kind: 'multi-select', options: ['A', 'B'] } } }
  const before = structuredClone(raw)
  const settings = settingsOf(raw)
  expect(settings.columns.status).toEqual({ kind: 'select', options: ['Done', 'Ready'] })
  expect(settings.columns.tags).toEqual({ kind: 'multi-select', options: ['A', 'B'] })
  expect(settings.problems).toHaveLength(1)
  expect(raw).toEqual(before)
})

it('reads option order tolerantly and reports malformed order without changing the manual array', () => {
  const raw = { columns: {
    Status: { kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' },
    Labels: { kind: 'multi-select', options: ['B', 'A'], optionSort: 'sideways' },
  } }
  const settings = settingsOf(raw)
  expect(settings.columns.Status).toEqual({ kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' })
  expect(settings.columns.Labels).toEqual({ kind: 'multi-select', options: ['B', 'A'] })
  expect(settings.problems).toEqual(['folder_page_settings.columns.Labels.optionSort must be manual, ascending, or descending — using manual order'])
  expect(raw.columns.Labels.optionSort).toBe('sideways')
})

describe('the default status column (YAZ-1513): every folder page is born with it', () => {
  const STATUS = { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] }

  it('DEFAULT_COLUMNS is one Select, its options in board order', () => {
    expect(DEFAULT_COLUMNS).toEqual({ status: STATUS })
  })
})

describe('properties: column labels (YAZ-1513) — `ViewSet.properties` verbatim, the key never changes', () => {
  it('reads key → { displayName } and hands it back to the writer untouched', () => {
    const settings = settingsOf({ properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } }, views: [{ type: 'table', name: 'T' }] })
    expect(settings.properties).toEqual({ status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } })
    expect(settings.problems).toEqual([])
    writeFolderSettings('/vault/F.md', settings)
    expect(vi.mocked(writeProperty)).toHaveBeenLastCalledWith('/vault/F.md', 'folder_page_settings', {
      properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } },
      views: [{ type: 'table', name: 'T' }],
    })
  })

  it('is absent when the card has none, and absent from the write too', () => {
    const settings = settingsOf({ views: [{ type: 'table', name: 'T' }] })
    expect(settings.properties).toBeUndefined()
    writeFolderSettings('/vault/F.md', settings)
    expect(vi.mocked(writeProperty)).toHaveBeenLastCalledWith('/vault/F.md', 'folder_page_settings', { views: [{ type: 'table', name: 'T' }] })
  })

  it('a blank displayName reads as absent — the header never goes empty (YAZ-1549)', () => {
    const settings = settingsOf({ properties: { status: { displayName: '   ' }, owner: { displayName: '' } } })
    expect(settings.properties).toEqual({ status: {}, owner: {} })
    expect(settings.problems).toEqual([])
  })

  it("reads tolerantly: a non-map is ignored with a problem; a non-map entry or a non-string displayName drops that entry", () => {
    expect(settingsOf({ properties: 'nope' }).properties).toBeUndefined()
    expect(settingsOf({ properties: 'nope' }).problems).toEqual(['folder_page_settings.properties must be a map of column labels — ignoring it'])
    const mixed = settingsOf({ properties: { a: { displayName: 'A' }, b: 'text', c: { displayName: 7 }, d: {} } })
    expect(mixed.properties).toEqual({ a: { displayName: 'A' }, d: {} })
    expect(mixed.problems).toEqual([
      'folder_page_settings.properties.b must be a map with a displayName — ignoring that label',
      'folder_page_settings.properties.c.displayName must be text — ignoring that label',
    ])
  })

})
