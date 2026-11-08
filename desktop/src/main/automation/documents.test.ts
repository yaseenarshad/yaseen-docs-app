import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { addComment, readComments } from '@shared/comments'
import { documentCommand } from './documents'
import { readSaved } from './resources'
import { writeFile as sharedWrite } from '../fs/file'

let root: string, path: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-write-')); path = join(root, 'Note.md'); await writeFile(path, '---\n# keep this comment\ntitle: Original\ncustom: [one, two]\n---\nBody\n') })
afterEach(() => rm(root, { recursive: true, force: true }))
const run = async (command: string, extra: Record<string, unknown> = {}, body = '') => documentCommand(defaultAppState(), command, { root, path, revision: (await readSaved(path)).revision, ...extra }, Buffer.from(body))

describe('the app’s own properties (YAZ-4514, the properties panel’s reserved keys)', () => {
  const ids = (enabled: boolean) => mkdir(join(root, '.yaseendocs'), { recursive: true }).then(() => writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled, letters: 'TST' })))
  const refused = async (keys: string[], door: string, target = path) => {
    const before = await readFile(target, 'utf8')
    for (const command of ['property.set', 'property.remove']) {
      await expect(documentCommand(defaultAppState(), command, { root, path: target, revision: (await readSaved(target)).revision, keys, value: 'x' }, Buffer.alloc(0)))
        .rejects.toMatchObject({ code: 'RESERVED_PROPERTY', details: { key: keys[0] }, message: expect.stringContaining(door) })
    }
    expect(await readFile(target, 'utf8')).toBe(before)
  }
  it('refuses the keys every vault reserves, naming their command', async () => {
    await refused(['comments', 'x'], 'comment add')
    await refused(['reviews'], 'review keep')
    await refused(['readonly'], 'page settings')
    for (const key of ['toc', 'section-indent', 'guide-lines', 'folding', 'bullet-threading', 'outside-glow']) await refused([key], 'page settings')
  })
  it('refuses id, title, also_in and in only where the vault uses IDs', async () => {
    for (const key of ['id', 'title', 'also_in', 'in']) await run('property.set', { keys: [key], value: 'plain' })
    await ids(true)
    await refused(['id'], 'ids commands')
    await refused(['title'], 'file retitle')
    await refused(['also_in'], 'shortcut add')
    await refused(['in', 'TST-1'], 'folder’s views')
    await ids(false)
    await run('property.remove', { keys: ['title'] })
  })
  it('refuses folder_settings on a folder page only', async () => {
    await run('property.set', { keys: ['folder_settings'], value: 'on a note this is ordinary' })
    await mkdir(join(root, 'Projects')); const page = join(root, 'Projects/.folder.md'); await writeFile(page, '---\nowner: Ada\n---\n')
    await refused(['folder_settings', 'views'], 'folderView', page)
  })
})

describe('revision-checked document commands', () => {
  it('creates a folder only inside the vault and never replaces an existing one', async () => {
    const folder = join(root, 'New folder')
    expect(await run('folder.create', { path: folder })).toEqual({ path: folder, diskSaved: true })
    expect((await stat(folder)).isDirectory()).toBe(true)
    await expect(run('folder.create', { path: folder })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    await expect(run('folder.create', { path: join(root, '../Outside') })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
  })
  it('preserves unrelated frontmatter and text and makes an unchanged write a no-op', async () => {
    const before = await readSaved(path)
    expect(await run('file.write', {}, before.content)).toMatchObject({ changed: false, mtime: before.mtime, revision: before.revision, diskSaved: true, rendererMerged: false })
    await run('property.set', { keys: ['nested', 'status'], value: 'ready' })
    const content = await readFile(path, 'utf8')
    expect(content).toContain('# keep this comment')
    expect(content).toContain('custom: [one, two]')
    expect(content).toContain('status: ready')
    expect(content.endsWith('Body\n')).toBe(true)
    await run('property.remove', { keys: ['nested', 'status'] })
    expect(await readFile(path, 'utf8')).not.toContain('status:')
  })
  it('rejects a stale hash even when the file modification time was preserved', async () => {
    await utimes(path, 1_700_000_000, 1_700_000_000)
    const before = await readSaved(path)
    await writeFile(path, 'Another writer')
    await utimes(path, 1_700_000_000, 1_700_000_000)
    await expect(run('file.write', { revision: before.revision }, 'clobber')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe('Another writer')
  })
  it('serializes shared UI and CLI saves so a stale CLI write cannot overwrite the UI save', async () => {
    const before = await readSaved(path)
    const results = await Promise.allSettled([
      sharedWrite({ path, content: 'UI save', expectedMtime: before.mtime }),
      sharedWrite({ path, content: 'CLI save', expectedRevision: before.revision }),
    ])
    // Either write may take the lock first. Exactly one lands; the other is refused, and disk holds the winner.
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } })
    expect(await readFile(path, 'utf8')).toBe(results[0].status === 'fulfilled' ? 'UI save' : 'CLI save')
  })
  it('protects human comments, edits agent comments, and refuses orphan replies', async () => {
    const before = await readFile(path, 'utf8')
    await writeFile(path, addComment(before, 'Human comment', { id: 'human', at: '2026-11-07T00:00:00Z' }))
    await expect(run('comment.update', { comment: 'human' }, 'change')).rejects.toMatchObject({ code: 'COMMENT_OWNERSHIP' })
    await expect(run('comment.remove', { comment: 'human' })).rejects.toMatchObject({ code: 'COMMENT_OWNERSHIP' })
    await expect(run('comment.add', { replyTo: 'absent' }, 'reply')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(run('property.remove', { keys: ['comments'] })).rejects.toMatchObject({ code: 'RESERVED_PROPERTY', message: expect.stringContaining('comment add/update/remove') })
    const result = await run('comment.add', {}, 'Agent comment') as { comment: string }
    await run('comment.update', { comment: result.comment }, 'Updated')
    expect(readComments(await readFile(path, 'utf8')).find(item => item.id === result.comment)).toMatchObject({ body: 'Updated', by: 'agent' })
    await run('comment.remove', { comment: result.comment })
    expect(readComments(await readFile(path, 'utf8')).map(item => item.id)).toEqual(['human'])
  })
  it('appends exact text and reports the new saved revision', async () => {
    const before = await readSaved(path)
    const result = await run('file.append', {}, '\nExtra 🌍')
    const after = await readSaved(path)
    expect(after.content).toBe(before.content + '\nExtra 🌍')
    expect(result).toMatchObject({ revision: after.revision, size: after.size, changed: true })
  })
})
