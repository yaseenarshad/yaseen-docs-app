import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { PropertyDecl } from '@shared/types'
import { writeFolderColumn } from './folderSettings'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))
import { api, BridgeRequestError } from '../api'

const path = '/vault/Candidates.md'
const read = vi.mocked(api.readFile)
const write = vi.mocked(api.writeFile)
const file = (content: string, mtime = 100) => ({ path, content, mtime, size: content.length })
const base: PropertyDecl = { kind: 'select', options: ['Later', 'Ready'] }
const next: PropertyDecl = { ...base, optionSort: 'ascending' }
const content = (settings: unknown) => setFrontmatterProperty('---\nowner: Sam\n---\nBody stays.\n', 'folder_settings', settings)
const settingsWritten = () => parseFrontmatter(splitFrontmatter(write.mock.lastCall![0].content).frontmatter).properties.folder_settings
beforeEach(() => {
  read.mockReset(); write.mockReset()
  write.mockResolvedValue({ path, mtime: 200, size: 200 })
})

describe('writeFolderColumn', () => {
  it.each([undefined, null])('creates a definition when settings are %s: it is the only column stated (YAZ-4713 C5: no default column), no view defaults injected', async settings => {
    read.mockResolvedValue(file(content(settings)))
    await expect(writeFolderColumn(path, 'Status', base, undefined, true)).resolves.toMatchObject({ mtime: 200 })
    expect(settingsWritten()).toEqual({ columns: { Status: base } })
    expect(write.mock.lastCall![0].expectedMtime).toBe(100)
    expect(write.mock.lastCall![0].content).toContain('Body stays.\n')
  })

  it('where the vault does not use IDs the first definition is the only one stated: no default column beside it (YAZ-2523 V11)', async () => {
    read.mockResolvedValue(file(''))
    await writeFolderColumn(path, 'owner', { kind: 'text' }, undefined, false)
    expect(settingsWritten()).toEqual({ columns: { owner: { kind: 'text' } } })
  })

  it('with nothing saved there is no column to check an edit against (YAZ-4713 C5): a base that names one is refused', async () => {
    read.mockResolvedValue(file(''))
    const edited: PropertyDecl = { kind: 'select', options: ['Todo', 'Done'] }
    await expect(writeFolderColumn(path, 'status', edited, { kind: 'select', options: ['1-Backlog'] }, true)).rejects.toThrow('changed since')
    expect(write).not.toHaveBeenCalled()
  })

  it('"Separate value on this page" (YAZ-4713 C3) is written, and removed again, as a known setting', async () => {
    read.mockResolvedValue(file(content({ columns: { domain: { kind: 'text' } } })))
    await writeFolderColumn(path, 'domain', { kind: 'text', separate: true }, { kind: 'text' }, true)
    expect(settingsWritten()).toEqual({ columns: { domain: { kind: 'text', separate: true } } })
    read.mockResolvedValue(file(content({ columns: { domain: { kind: 'text', separate: true } } })))
    await writeFolderColumn(path, 'domain', { kind: 'text' }, { kind: 'text', separate: true }, true)
    expect(settingsWritten()).toEqual({ columns: { domain: { kind: 'text' } } })
  })

  it('preserves concurrent sibling edits, raw view settings and unknown definition metadata', async () => {
    const settings = { columns: { Status: { ...base, future: { color: 'pink' } }, Priority: { kind: 'future-kind', extra: 8 } }, views: [{ type: 'future-view', name: 'Future', custom: true }], futureSetting: [1, 2] }
    read.mockResolvedValue(file(content(settings)))
    await writeFolderColumn(path, 'Status', next, { options: ['Later', 'Ready'], kind: 'select' }, true)
    expect(settingsWritten()).toEqual({ ...settings, columns: { ...settings.columns, Status: { ...next, future: { color: 'pink' } } } })
  })

  it('clears omitted known fields without removing unknown metadata', async () => {
    const old: PropertyDecl = { kind: 'link', target: '[[People]]', required: true }
    read.mockResolvedValue(file(content({ columns: { Related: { ...old, future: true } } })))
    await writeFolderColumn(path, 'Related', { kind: 'link' }, old, true)
    expect(settingsWritten()).toEqual({ columns: { Related: { kind: 'link', future: true } } })
  })

  it('writes a description, and an edit without one clears it (YAZ-4590 S23)', async () => {
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
    await writeFolderColumn(path, 'Status', { ...base, description: 'Where the page stands' }, base, true)
    expect(settingsWritten()).toEqual({ columns: { Status: { ...base, description: 'Where the page stands' } } })
    read.mockResolvedValueOnce(file(content({ columns: { Status: { ...base, description: 'Where the page stands' } } })))
    await writeFolderColumn(path, 'Status', base, { ...base, description: 'Where the page stands' }, true)
    expect(settingsWritten()).toEqual({ columns: { Status: base } })
  })

  it.each([
    { ...base, options: ['New'] }, { ...base, optionSort: 'descending' },
    { ...base, kind: 'multi-select' }, { ...base, required: true }, { ...base, target: '[[Page]]' },
    undefined,
  ])('rejects a stale edit when this column changed to %j', async current => {
    read.mockResolvedValue(file(content({ columns: current === undefined ? {} : { Status: current } })))
    await expect(writeFolderColumn(path, 'Status', next, base, true)).rejects.toThrow('changed since these settings were opened')
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects creating a column that appeared after the dialog opened', async () => {
    read.mockResolvedValue(file(content({ columns: { Status: base } })))
    await expect(writeFolderColumn(path, 'Status', next, undefined, true)).rejects.toThrow('changed since')
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['bad', [], { columns: null }, { columns: [] }, { columns: { Status: 42 } }, { columns: { Status: { kind: 'future-kind' } } }])('rejects malformed settings %j without replacing them', async settings => {
    read.mockResolvedValue(file(content(settings)))
    await expect(writeFolderColumn(path, 'Status', next, undefined, true)).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    { options: ['Ready', 7] }, { options: ['Ready', 'Ready'] }, { optionSort: 'future-mode' }, { target: 7 }, { required: 'yes' },
  ])('rejects malformed current optional fields %j even when the tolerant base matches', async malformed => {
    read.mockResolvedValue(file(content({ columns: { Status: { kind: 'select', options: ['Ready'], ...malformed } } })))
    await expect(writeFolderColumn(path, 'Status', { kind: 'select', options: ['Ready'], optionSort: 'ascending' }, { kind: 'select', options: ['Ready'] }, true)).rejects.toThrow('invalid definition')
    expect(write).not.toHaveBeenCalled()
  })

  it.each([{ kind: 'bad' }, { kind: 'select', options: ['A', 'A'] }, { kind: 'select', options: [''] }, { kind: 'select', optionSort: 'bad' }, { kind: 'link', target: 1 }, { kind: 'text', required: 'yes' }])('rejects invalid submitted definitions %j before reading or writing', async invalid => {
    await expect(writeFolderColumn(path, 'Status', invalid as PropertyDecl, undefined, true)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  })

  it('rejects broken frontmatter and skips writes for an unchanged definition', async () => {
    read.mockResolvedValueOnce(file('---\nbad: [\n---\nBody'))
    await expect(writeFolderColumn(path, 'Status', next, undefined, true)).rejects.toThrow()
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
    await expect(writeFolderColumn(path, 'Status', base, base, true)).resolves.toMatchObject({ mtime: 100 })
    expect(write).not.toHaveBeenCalled()
  })

  it('re-reads on mtime conflict and recomputes against fresh unrelated settings', async () => {
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
      .mockResolvedValueOnce(file(content({ columns: { Status: base, Added: { kind: 'text' } }, defaultView: 'New view' }), 150))
    write.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed', 150))
    await writeFolderColumn(path, 'Status', next, base, true)
    expect(read).toHaveBeenCalledTimes(2)
    expect(write.mock.lastCall![0].expectedMtime).toBe(150)
    expect(settingsWritten()).toEqual({ columns: { Status: next, Added: { kind: 'text' } }, defaultView: 'New view' })
  })

  it('stops the retry if the same definition changed on disk', async () => {
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
      .mockResolvedValueOnce(file(content({ columns: { Status: { ...base, options: ['Changed'] } } }), 150))
    write.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed', 150))
    await expect(writeFolderColumn(path, 'Status', next, base, true)).rejects.toThrow('changed since')
    expect(write).toHaveBeenCalledTimes(1)
  })
})
