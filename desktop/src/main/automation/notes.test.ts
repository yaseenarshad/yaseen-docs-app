import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { noteCommand } from './notes'
import { documentCommand } from './documents'
import { linkCommand } from './links'
import { readSaved } from './resources'
import { _actAs, _resetMint } from '../vaultIndex/mint'
import { _evictAll } from '../vaultIndex/live'
import { checked } from './contract'
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-notes-'))
  _actAs(root, join(root, 'profile'))
  await mkdir(join(root, '.yaseendocs'))
  await writeFile(join(root, '.yaseendocs/ids.json'), '{"enabled":false}')
})
afterEach(async () => { _evictAll(); _resetMint(); await rm(root, { recursive: true, force: true }) })
const state = () => defaultAppState()
const run = (command: string, args: Record<string, unknown> = {}, body = '') => checked(command, noteCommand(state(), command, { root, folder: root, ...args }, Buffer.from(body)))
describe('note capability adapters', () => {
  it('keeps absent templates absent on read and requires a fresh revision to change them', async () => {
    expect(await run('template.read')).toMatchObject({ exists: false, revision: null })
    const made = await run('template.write', { revision: null }, 'Template body\n') as { revision: string }
    await expect(run('template.write', { revision: null }, 'overwrite')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    await run('template.write', { revision: made.revision }, 'Updated\n')
    await expect(run('template.write', { revision: made.revision }, 'stale')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(join(root, '.template.md'), 'utf8')).toBe('Updated\n')
  })
  it('distinguishes an empty note body from an omitted template override', async () => {
    await run('template.write', { revision: null }, 'Template body\n')
    const empty = await checked('note.create', documentCommand(state(), 'note.create', { root, folder: root, title: 'Empty' }, Buffer.alloc(0), true)) as { path: string }
    const normal = await checked('note.create', documentCommand(state(), 'note.create', { root, folder: root, title: 'Normal' }, Buffer.alloc(0), false)) as { path: string }
    expect(await readFile(empty.path, 'utf8')).toBe('')
    expect(await readFile(normal.path, 'utf8')).toBe('Template body\n')
  })
  it('finds without creating and creates one daily note across concurrent calls', async () => {
    await mkdir(join(root, 'Daily'))
    await writeFile(join(root, 'Daily/.template.md'), 'Daily plan\n')
    const app = state(); Object.assign(app.settings, { dailyNotes: true, dailyNoteFolder: 'Daily', dailyNoteFormat: 'YYYY-MM-DD', dailyNoteDayFolder: false })
    const args = { root, date: '2026-11-07' }
    expect(await checked('daily.find', noteCommand(app, 'daily.find', args, Buffer.alloc(0)))).toEqual({ note: null })
    const results = await Promise.all([1, 2].map(() => checked('daily.create', noteCommand(app, 'daily.create', args, Buffer.alloc(0))))) as { note: { path: string; created: boolean } }[]
    expect(results.filter(result => result.note.created)).toHaveLength(1)
    expect(new Set(results.map(result => result.note.path)).size).toBe(1)
    expect(await readFile(results[0].note.path, 'utf8')).toBe('Daily plan\n')
    await expect(noteCommand(app, 'daily.create', { root, date: '2026-02-30' }, Buffer.alloc(0))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('uses review log helpers and refuses to clobber an intervening edit', async () => {
    const path = join(root, 'Review.md'); await writeFile(path, 'Body\n')
    const before = await readSaved(path)
    await checked('review.keep', documentCommand(state(), 'review.keep', { root, path, revision: before.revision }, Buffer.alloc(0)))
    const list = await checked('review.list', documentCommand(state(), 'review.list', { root, path }, Buffer.alloc(0))) as { revision: string; items: { at: string; rating: string }[] }
    expect(list.items).toMatchObject([{ rating: 'keep' }])
    await expect(checked('review.reset', documentCommand(state(), 'review.reset', { root, path, revision: before.revision }, Buffer.alloc(0)))).rejects.toMatchObject({ code: 'CONFLICT' })
    await checked('review.remove', documentCommand(state(), 'review.remove', { root, path, revision: list.revision, at: list.items[0].at }, Buffer.alloc(0)))
    expect(await readFile(path, 'utf8')).not.toContain('reviews:')
  })
  it('uses the shared alias and folder resolver without writing IDs', async () => {
    const source = join(root, 'Source.md'), target = join(root, 'Target.md')
    await mkdir(join(root, 'Mochi'))
    await writeFile(source, '[[Alias]] and [[Mochi]] and [[Missing]]\n')
    await writeFile(target, '---\naliases: [Alias]\n---\nTarget\n')
    expect(await checked('link.resolve', linkCommand(state(), 'link.resolve', { root, target: '[[Alias]]' }))).toMatchObject({ path: target })
    expect(await checked('link.outgoing', linkCommand(state(), 'link.outgoing', { root, path: source }))).toMatchObject({ items: [{ target: 'Alias', path: target }, { target: 'Mochi', path: join(root, 'Mochi') }, { target: 'Missing', path: null }] })
    expect(await checked('link.incoming', linkCommand(state(), 'link.incoming', { root, path: target }))).toMatchObject({ items: [{ path: source }] })
    expect(await readFile(target, 'utf8')).not.toContain('id:')
  })
  it('returns the UI’s Linked mentions, including folder outlines, view order and column targets', async () => {
    const target = join(root, 'Target.md'), note = join(root, 'Note.md')
    await writeFile(target, 'Target\n')
    await writeFile(note, 'See [[Target]]\n')
    const settings = async (folder: string, yaml: string) => {
      await mkdir(join(root, folder))
      await writeFile(join(root, folder, '.folder.md'), `---\nfolder_settings:\n${yaml}---\n`)
    }
    await settings('Ordered', '  views:\n    - type: table\n      name: Table\n      order: ["[[Target]]"]\n')
    await settings('Outlined', '  views:\n    - type: outline\n      name: Plan\n      outline: |\n        - first\n        - read [[Target|the target]] soon\n')
    await settings('Columned', '  columns:\n    owner:\n      type: link\n      target: "[[Target]]"\n')
    await settings('Coded', '  views:\n    - type: outline\n      name: Plan\n      outline: "- `[[Target]]`"\n')
    await settings('Self', '  views:\n    - type: outline\n      name: Plan\n      outline: "- [[Self]]"\n')
    const incoming = await checked('link.incoming', linkCommand(state(), 'link.incoming', { root, path: target })) as { items: unknown[]; total: number }
    expect(incoming.items).toEqual([
      { kind: 'folder', path: join(root, 'Columned'), settings: join(root, 'Columned/.folder.md'), title: expect.any(String) },
      { kind: 'note', path: note, title: 'Note' },
      { kind: 'folder', path: join(root, 'Ordered'), settings: join(root, 'Ordered/.folder.md'), title: expect.any(String) },
      { kind: 'folder', path: join(root, 'Outlined'), settings: join(root, 'Outlined/.folder.md'), title: expect.any(String) },
    ])
    expect(await checked('link.incoming', linkCommand(state(), 'link.incoming', { root, path: join(root, 'Self') }))).toMatchObject({ items: [], total: 0 })
    const outgoing = await checked('link.outgoing', linkCommand(state(), 'link.outgoing', { root, path: join(root, 'Outlined') }))
    expect(outgoing).toMatchObject({ items: [{ target: 'Target', path: target, embedded: false }] })
    expect(await checked('link.outgoing', linkCommand(state(), 'link.outgoing', { root, path: join(root, 'Ordered') }))).toMatchObject({ items: [{ target: 'Target', path: target }] })
  })
})
