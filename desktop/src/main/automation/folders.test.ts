import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VIEW_OPTIONS } from '@shared/folderViews'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { AUTOMATION_COMMANDS, commandDefinition, validateInput } from '@shared/automationCommands'
import { defaultAppState, defaultFolderState, type AppState } from '@shared/types'
import { removeVault, vaultFiles } from '../fs/testFixture'
import { _evictAll } from '../vaultIndex/live'
import { folderCommand } from './folders'
import { readSaved } from './resources'
import { checked } from './contract'

let root: string, dir: string, state: AppState, saved: string[]
const store = { get: () => state, setBaseGroups: (r: string, key: string, groups: readonly string[]) => {
  const baseGroups = { ...state.folders[r].baseGroups }
  if (groups.length) baseGroups[key] = [...groups]; else delete baseGroups[key]
  state = { ...state, folders: { ...state.folders, [r]: { ...state.folders[r], baseGroups } } }
} }
const record = async (_roots: readonly string[], path: string) => { saved.push(path) }
const run = (command: string, args: Record<string, unknown> = {}) => checked(command, folderCommand(state, store, command, { root, path: dir, ...args }, record)) as Promise<any>
const settingsOf = async () => parseFrontmatter(splitFrontmatter(await readFile(join(dir, '.folder.md'), 'utf8')).frontmatter).properties.folder_settings as any

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-folders-'))
  dir = join(root, 'Projects')
  await mkdir(join(root, '.yaseendocs'))
  await mkdir(dir)
  await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'TST' }))
  state = { ...defaultAppState(), folders: { [root]: defaultFolderState() } }
  saved = []
})
afterEach(async () => { _evictAll(); await removeVault(root) })

it('declares closed input and output schemas for every folder and ID command', () => {
  const unit = AUTOMATION_COMMANDS.filter(command => /^(folder|folderView|folderColumn|folderFormula|shortcut|ids)\./.test(command.name) && command.name !== 'folder.create')
  expect(unit.map(command => command.name)).toHaveLength(23)
  for (const command of unit) {
    expect(command.input.additionalProperties, command.name).toBe(false)
    expect(command.output.additionalProperties, command.name).toBe(false)
    expect(Object.keys(command.output.properties!).length, command.name).toBeGreaterThan(3)
  }
})

describe('folder pages', () => {
  it('reads a folder without .folder.md as the defaults and creates nothing', async () => {
    const before = await vaultFiles(root)
    expect(await run('folder.read')).toMatchObject({ exists: false, revision: null, ids: true, id: null, title: 'Projects', views: [{ type: 'table', name: 'Table' }, { type: 'board', name: 'Board' }], defaultView: null, startView: 'Table', columns: { status: { kind: 'select' } }, problems: [] })
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: false }))
    expect((await run('folder.read')).views).toEqual([{ type: 'table', name: 'Table' }])
    expect(await vaultFiles(root)).toEqual({ ...before, '.yaseendocs/ids.json': JSON.stringify({ enabled: false }) })
  })

  it('adds views with the + menu rules, creating the page on its first change', async () => {
    await expect(run('folderView.add', { revision: 'stale', type: 'board' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const added = await run('folderView.add', { revision: null, type: 'board' })
    expect(added).toMatchObject({ created: true, changed: true, view: 'Board 2', views: [{ name: 'Table' }, { name: 'Board' }, { type: 'board', name: 'Board 2' }] })
    // The first write states the defaults it was shown, as the page's first write does.
    expect(await settingsOf()).toEqual({ columns: { status: { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] } }, views: [{ type: 'table', name: 'Table' }, { type: 'board', name: 'Board' }, { type: 'board', name: 'Board 2' }] })
    expect(saved).toEqual([join(dir, '.folder.md')])
    await expect(run('folderView.add', { revision: null, type: 'list' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const outline = await run('folderView.add', { revision: added.revision, type: 'outline', name: ' Plan ' })
    expect(outline.view).toBe('Plan')
    await expect(run('folderView.add', { revision: outline.revision, type: 'outline' })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(run('folderView.add', { revision: outline.revision, type: 'list', name: 'Plan' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('renames, duplicates, moves and deletes views, keeping the starting view and collapse state honest', async () => {
    let page = await run('folderView.setDefault', { revision: null, view: 'board' })
    expect(page).toMatchObject({ defaultView: 'Board', startView: 'Board' })
    state.folders[root].baseGroups[`${dir}::Board`] = ['open']
    page = await run('folderView.rename', { revision: page.revision, view: 'Board', name: 'Kanban' })
    expect(page).toMatchObject({ defaultView: 'Kanban', view: 'Kanban' })
    expect(state.folders[root].baseGroups).toEqual({ [`${dir}::Kanban`]: ['open'] })
    page = await run('folderView.duplicate', { revision: page.revision, view: 'Kanban' })
    expect(page.views.map((v: any) => v.name)).toEqual(['Table', 'Kanban', 'Kanban copy'])
    page = await run('folderView.move', { revision: page.revision, view: 'Table', index: 2 })
    expect(page.views.map((v: any) => v.name)).toEqual(['Kanban', 'Kanban copy', 'Table'])
    await expect(run('folderView.move', { revision: page.revision, view: 'Table', index: 3 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    page = await run('folderView.remove', { revision: page.revision, view: 'Kanban' })
    expect(page).toMatchObject({ defaultView: null, startView: 'Kanban copy' })
    expect(state.folders[root].baseGroups).toEqual({})
    page = await run('folderView.remove', { revision: page.revision, view: 'Table' })
    await expect(run('folderView.remove', { revision: page.revision, view: 'Kanban copy' })).rejects.toMatchObject({ code: 'LAST_VIEW' })
    await expect(run('folderView.rename', { revision: page.revision, view: 'missing', name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    page = await run('folderView.add', { revision: page.revision, type: 'outline' })
    await expect(run('folderView.duplicate', { revision: page.revision, view: 'Outline' })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('sets only the options a view type reads, refusing the whole patch otherwise', async () => {
    let page = await run('folderView.setOptions', { revision: null, view: 'Table', changes: { rowHeight: 'tall', sort: [{ property: 'file.name', direction: 'DESC' }], groupBy: [{ property: 'status' }], summaries: { status: 'Count' }, rowNumbers: false } })
    expect(page.views[0]).toEqual({ type: 'table', name: 'Table', rowHeight: 'tall', sort: [{ property: 'file.name', direction: 'DESC' }], groupBy: [{ property: 'status' }], summaries: { status: 'Count' }, rowNumbers: false })
    // The value a menu deletes is an absence here too; null removes.
    page = await run('folderView.setOptions', { revision: page.revision, view: 'Table', changes: { rowNumbers: true, rowHeight: null } })
    expect(page.views[0]).toEqual({ type: 'table', name: 'Table', sort: [{ property: 'file.name', direction: 'DESC' }], groupBy: [{ property: 'status' }], summaries: { status: 'Count' } })
    const bytes = await readFile(join(dir, '.folder.md'), 'utf8')
    await expect(run('folderView.setOptions', { revision: page.revision, view: 'Board', changes: { showEmptyColumns: true, rowHeight: 'tall' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION', details: { view: 'Board', type: 'board' } })
    for (const changes of [{ rowHeight: 'huge' }, { groupBy: [{ property: 'a' }, { property: 'b' }, { property: 'c' }] }, { summaries: { status: 'Nope' } }, { sort: [{ property: 'x', direction: 'up' }] }, { filters: { xor: ['a'] } }])
      await expect(run('folderView.setOptions', { revision: page.revision, view: 'Table', changes })).rejects.toMatchObject({ code: 'INVALID_OPTION' })
    expect(await readFile(join(dir, '.folder.md'), 'utf8')).toBe(bytes)
    const input = commandDefinition('folderView.setOptions').input
    expect(() => validateInput(input, { root, path: dir, revision: page.revision, view: 'Table', changes: { colour: 'red' } })).toThrow('unknown field colour')
    expect(Object.keys(input.properties!.changes.properties!).sort()).toEqual([...VIEW_OPTIONS].sort())
  })

  it('edits the folder’s own properties beside its settings and refuses the app’s keys', async () => {
    let page = await run('folder.setProperty', { revision: null, name: 'owner', value: 'Ada' })
    expect(page).toMatchObject({ created: true, properties: { owner: 'Ada' }, views: [{ name: 'Table' }, { name: 'Board' }] })
    page = await run('folderView.add', { revision: page.revision, type: 'list' })
    page = await run('folder.setProperty', { revision: page.revision, name: 'owner', value: ['Ada', 'Lin'] })
    expect(page.properties).toEqual({ owner: ['Ada', 'Lin'] })
    expect((await settingsOf()).views).toHaveLength(3)
    for (const name of ['folder_settings', 'id', 'title', 'comments', 'also_in']) await expect(run('folder.setProperty', { revision: page.revision, name, value: 1 })).rejects.toMatchObject({ code: 'RESERVED_PROPERTY' })
    await expect(run('folder.setProperty', { revision: page.revision, name: 'Owner', value: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    page = await run('folder.removeProperty', { revision: page.revision, name: 'owner' })
    expect(page.properties).toEqual({})
  })
})

describe('folder columns and formulas (YAZ-4518)', () => {
  it('declares and changes a column with the kind rule, and refuses built-in keys', async () => {
    let page = await run('folderColumn.set', { revision: null, key: 'priority', definition: { kind: 'select', options: ['High', 'Low'], target: ' ignored ' } })
    expect(page).toMatchObject({ created: true, column: 'priority', columns: { status: { kind: 'select' }, priority: { kind: 'select', options: ['High', 'Low'] } } })
    expect(page.columns.priority.target).toBeUndefined()
    page = await run('folderColumn.set', { revision: page.revision, key: 'priority', definition: { kind: 'link', target: ' Projects ', options: ['High'] } })
    expect(page.columns.priority).toEqual({ kind: 'link', target: 'Projects' })
    await expect(run('folderColumn.set', { revision: 'stale', key: 'priority', definition: { kind: 'text' } })).rejects.toMatchObject({ code: 'CONFLICT' })
    for (const key of ['title', 'also_in', 'file.name', 'formula.x', 'Bad Key']) await expect(run('folderColumn.set', { revision: page.revision, key, definition: { kind: 'text' } })).rejects.toMatchObject({ code: 'RESERVED_PROPERTY' })
    page = await run('folderColumn.setLabel', { revision: page.revision, key: 'priority', label: 'Priority level' })
    expect(page.labels).toEqual({ priority: { displayName: 'Priority level' } })
    page = await run('folderColumn.setLabel', { revision: page.revision, key: 'note.priority', label: null })
    expect(page.labels).toEqual({})
  })

  it('deletes a column everywhere: declaration, views and label first, then each note’s value', async () => {
    await writeFile(join(dir, '.folder.md'), '---\nid: TST-3\nfolder_settings:\n  columns:\n    priority:\n      kind: number\n  properties:\n    priority:\n      displayName: P\n  views:\n    - type: table\n      name: Table\n      order: [file.name, note.priority]\n      sort:\n        - property: note.priority\n          direction: DESC\n---\n')
    const note = (name: string) => join(dir, name)
    await writeFile(note('a.md'), '---\nid: TST-4\nin:\n  TST-3:\n    priority: 2\n    status: open\n---\nA\n')
    await writeFile(note('b.md'), '---\nid: TST-5\nin:\n  TST-3:\n    priority: 1\n---\nB\n')
    const read = await run('folder.read')
    await expect(run('folderColumn.remove', { revision: read.revision, key: 'file.name', confirm: true })).rejects.toMatchObject({ code: 'RESERVED_PROPERTY' })
    const removed = await run('folderColumn.remove', { revision: read.revision, key: 'priority', confirm: true })
    expect(removed).toMatchObject({ column: 'priority', cleared: 2, failed: [], columns: {}, labels: {}, views: [{ type: 'table', name: 'Table', order: ['file.name'] }] })
    expect(removed.views[0].sort).toBeUndefined()
    expect(await readFile(note('a.md'), 'utf8')).toBe('---\nid: TST-4\nin:\n  TST-3:\n    status: open\n---\nA\n')
    expect(await readFile(note('b.md'), 'utf8')).not.toContain('priority')
    expect(() => validateInput(commandDefinition('folderColumn.remove').input, { root, path: dir, revision: removed.revision, key: 'x', confirm: false })).toThrow()
  })

  it('reports the notes that kept their value as a partial failure', async () => {
    await writeFile(join(dir, '.folder.md'), '---\nid: TST-3\nfolder_settings:\n  columns:\n    priority:\n      kind: number\n  views:\n    - type: table\n      name: Table\n---\n')
    const locked = join(dir, 'Locked'); await mkdir(locked)
    await writeFile(join(dir, 'a.md'), '---\nid: TST-4\nin:\n  TST-3:\n    priority: 2\n---\n')
    await writeFile(join(locked, 'c.md'), '---\nid: TST-6\nin:\n  TST-3:\n    priority: 3\n---\n')
    const read = await run('folder.read')
    await chmod(locked, 0o555)
    try {
      await expect(run('folderColumn.remove', { revision: read.revision, key: 'priority', confirm: true })).rejects.toMatchObject({ code: 'PARTIAL_FAILURE', details: { cleared: 1, failed: [{ path: join(locked, 'c.md') }], columns: {} } })
    } finally { await chmod(locked, 0o755) }
    expect(await readFile(join(dir, 'a.md'), 'utf8')).not.toContain('priority')
    expect(await readFile(join(locked, 'c.md'), 'utf8')).toContain('priority: 3')
  })

  it('sets a formula and removes it with every reference', async () => {
    let page = await run('folderFormula.set', { revision: null, name: 'score', expression: 'priority * 2' })
    expect(page).toMatchObject({ formula: 'score', formulas: { score: 'priority * 2' } })
    page = await run('folderView.setOptions', { revision: page.revision, view: 'Table', changes: { order: ['file.name', 'formula.score'], sort: [{ property: 'formula.score', direction: 'ASC' }] } })
    page = await run('folderFormula.set', { revision: page.revision, name: 'score', expression: null })
    expect(page.formulas).toEqual({})
    expect(page.views[0]).toEqual({ type: 'table', name: 'Table', order: ['file.name'] })
    await expect(run('folderFormula.set', { revision: page.revision, name: '2bad', expression: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('shortcuts', () => {
  const note = () => join(root, 'Elsewhere.md')
  beforeEach(async () => { await writeFile(note(), '---\nid: TST-7\ntitle: Elsewhere\n---\nBody\n') })

  it('gives the folder an id first, then adds and lists the shortcut', async () => {
    const added = await run('shortcut.add', { note: note(), revision: (await readSaved(note())).revision })
    expect(added).toMatchObject({ changed: true, folderIdCreated: true, folderId: expect.stringMatching(/^TST-\d+$/) })
    expect(await readFile(note(), 'utf8')).toContain(`also_in:\n  - ${added.folderId}`)
    // The list reads the index, which takes the note's write from the watcher, as the sidebar's row does.
    await expect.poll(() => run('shortcut.list'), { timeout: 10_000 }).toMatchObject({ total: 1, items: [{ path: note(), title: 'Elsewhere', id: 'TST-7' }] })
    expect(await run('shortcut.add', { note: note(), revision: added.revision })).toMatchObject({ changed: false, folderIdCreated: false })
    await expect(run('shortcut.add', { note: note(), revision: 'stale' })).rejects.toMatchObject({ code: 'CONFLICT' })
    const inside = join(dir, 'Inside.md'); await writeFile(inside, '---\nid: TST-8\n---\n')
    await expect(run('shortcut.add', { note: inside, revision: (await readSaved(inside)).revision })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('asks for dropValues before a removal clears the folder’s values', async () => {
    await writeFile(join(dir, '.folder.md'), '---\nid: TST-3\n---\n')
    await writeFile(note(), '---\nid: TST-7\nalso_in:\n  - TST-3\nin:\n  TST-3:\n    status: open\n---\nBody\n')
    const revision = (await readSaved(note())).revision
    await expect(run('shortcut.remove', { note: note(), revision })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { folders: [dir] } })
    expect(await run('shortcut.remove', { note: note(), revision, dropValues: true })).toMatchObject({ changed: true })
    expect(await readFile(note(), 'utf8')).toBe('---\nid: TST-7\n---\nBody\n')
  })

  it('refuses a vault that does not use IDs', async () => {
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: false }))
    await expect(run('shortcut.list')).rejects.toMatchObject({ code: 'IDS_OFF' })
  })
})
