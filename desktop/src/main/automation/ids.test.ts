import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import { isAutomationCommand } from '../../cli/automation'
import { removeVault } from '../fs/testFixture'
import { _evictAll, changeLettersPass, giveOldIdsNumbersPass } from '../vaultIndex'
import { idsCommand } from './ids'
import { checked } from './contract'

// The watcher's echo of a pass write, held open on purpose (YAZ-4502 polish): `race.old` is the file the
// test races. Its rename first sends the watcher's `change` for the content the pass just wrote there,
// lets that scan read the file, renames, and lets the scan land one turn later. Off, every mock is the real module.
const race = vi.hoisted(() => ({
  old: undefined as string | undefined,
  listeners: new Map<string, (ev: { type: 'change'; path: string; mtime: number }) => void>(),
  read: undefined as (() => void) | undefined,
  land: undefined as Promise<void> | undefined,
}))
vi.mock('../fs/watchers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/watchers')>()
  return { ...real, subscribe: (r: string, listener: Parameters<typeof real.subscribe>[1]) => (race.listeners.set(r, listener), real.subscribe(r, listener)) }
})
vi.mock('../vaultIndex/scan', async (importOriginal) => {
  const real = await importOriginal<typeof import('../vaultIndex/scan')>()
  return {
    ...real,
    scanFile: async (r: string, file: string) => {
      const record = await real.scanFile(r, file)
      if (file === race.old && race.read !== undefined) {
        race.read()
        await race.land
      }
      return record
    },
  }
})
vi.mock('../fs/rename', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/rename')>()
  return {
    ...real,
    renameFile: async (req: { oldPath: string; newPath: string }) => {
      if (req.oldPath !== race.old) return real.renameFile(req)
      let land = (): void => undefined
      race.land = new Promise((done) => (land = done))
      const read = new Promise<void>((done) => (race.read = done))
      for (const [r, listener] of race.listeners) if (req.oldPath.startsWith(r)) listener({ type: 'change', path: req.oldPath, mtime: Date.now() })
      await read
      const res = await real.renameFile(req)
      setImmediate(land)
      return res
    },
  }
})

let root: string
const changes = { reletter: (r: string, letters: string) => changeLettersPass(r, letters), backfill: (r: string) => giveOldIdsNumbersPass(r) }
const run = (command: string, args: Record<string, unknown> = {}) => checked(command, idsCommand(defaultAppState(), changes, command, { root, ...args })) as Promise<any>
const config = async () => JSON.parse(await readFile(join(root, '.yaseendocs/ids.json'), 'utf8'))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-ids-'))
  await mkdir(join(root, 'Projects'))
  await writeFile(join(root, 'a.md'), '---\ntitle: A\n---\nSee [[b]]\n')
  await writeFile(join(root, 'Projects/b.md'), '# b\n')
})
afterEach(async () => { race.old = undefined; race.read = undefined; _evictAll(); await removeVault(root) })

describe('ids commands', () => {
  it('keeps the legacy id command and routes the new ids resource', () => {
    expect(isAutomationCommand(['id', join(root, 'a.md')])).toBe(false)
    expect(isAutomationCommand(['ids', 'state'])).toBe(true)
  })

  it('turns IDs on only with the typed letters, gives every note and folder its number, and reports the counts', async () => {
    expect(await run('ids.state')).toMatchObject({ answer: null, saved: false, notes: 0, ask: { notes: 2, folders: 1 } })
    await expect(run('ids.enable', { letters: 'x' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const on = await run('ids.enable', { letters: 'tst' })
    expect(on).toMatchObject({ answer: true, letters: 'TST', saved: true, notes: 3, given: { notes: 2, folders: 1 }, left: { notes: 0, folders: 0 }, changed: true })
    expect(await config()).toEqual({ enabled: true, letters: 'TST' })
    expect(await readFile(join(root, 'a.md'), 'utf8')).toMatch(/^---\ntitle: A\nid: TST-\d+\n---/)
    expect(await run('ids.enable', { letters: 'TST' })).toMatchObject({ changed: false })
    // A vault with saved letters takes exactly those (S9).
    await run('ids.disable', { confirm: true })
    expect(await config()).toEqual({ enabled: false, letters: 'TST' })
    await expect(run('ids.enable', { letters: 'DOC' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', message: expect.stringContaining('TST') })
    expect(() => validateInput(commandDefinition('ids.disable').input, { root, confirm: false })).toThrow()
  })

  it('changes letters and gives old IDs numbers through the Settings passes, with changed and renamed counts', async () => {
    await mkdir(join(root, '.yaseendocs'))
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'YAZ' }))
    await writeFile(join(root, 'foo-yaz-1.md'), '---\nid: YAZ-1\ntitle: Foo\n---\n')
    await writeFile(join(root, 'a.md'), '---\nid: YAZ-2\ntitle: A\n---\nSee [[YAZ-1]] and [[aaaaaaaaaaa1]]\n')
    await writeFile(join(root, 'Projects/b.md'), '---\nid: aaaaaaaaaaa1\ntitle: B\n---\n')
    await expect(run('ids.reletter', { letters: 'YAZ' })).rejects.toMatchObject({ code: 'NOTHING_TO_CHANGE' })
    expect(await run('ids.reletter', { letters: 'doc' })).toMatchObject({ letters: 'DOC', notes: 2, changed: 2, renamed: 1, left: [], stopped: false, diskSaved: true })
    expect(await readFile(join(root, 'foo-doc-1.md'), 'utf8')).toContain('id: DOC-1')
    expect(await readFile(join(root, 'a.md'), 'utf8')).toContain('[[DOC-1]]')
    await expect(run('ids.backfill', { letters: 'YAZ' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(await run('ids.backfill', { letters: 'doc' })).toMatchObject({ old: 0, notes: 3, changed: 2, left: [], stopped: false })
    expect(await readFile(join(root, 'a.md'), 'utf8')).toMatch(/\[\[DOC-3\]\]/)
    await expect(run('ids.backfill', { letters: 'DOC' })).rejects.toMatchObject({ code: 'NOTHING_TO_CHANGE' })
  })

  it('counts a renamed note once when the watcher scan of its old name lands after the pass', async () => {
    await mkdir(join(root, '.yaseendocs'))
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'YAZ' }))
    await writeFile(join(root, 'foo-yaz-1.md'), '---\nid: YAZ-1\ntitle: Foo\n---\n')
    await writeFile(join(root, 'a.md'), '---\nid: YAZ-2\ntitle: A\n---\n')
    expect(await run('ids.state')).toMatchObject({ notes: 2 })
    race.old = join(root, 'foo-yaz-1.md')
    expect(await run('ids.reletter', { letters: 'DOC' })).toMatchObject({ letters: 'DOC', notes: 2, changed: 2, renamed: 1 })
    expect(await run('ids.state')).toMatchObject({ notes: 2 })
  })

  it('checks duplicates on request and refuses maintenance in a vault without IDs', async () => {
    await expect(run('ids.check')).rejects.toMatchObject({ code: 'IDS_OFF' })
    await expect(run('ids.reletter', { letters: 'DOC' })).rejects.toMatchObject({ code: 'IDS_OFF' })
    await mkdir(join(root, '.yaseendocs'))
    await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'TST' }))
    await writeFile(join(root, 'a.md'), '---\nid: TST-1\ntitle: A\n---\n')
    await writeFile(join(root, 'Projects/b.md'), '---\nid: TST-2\ntitle: B\n---\n')
    expect(await run('ids.check')).toMatchObject({ line: 'No duplicates.', fixed: 0, copies: 0, otherMac: 0, later: 0 })
  })
})
