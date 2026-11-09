import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
afterEach(async () => { _evictAll(); await removeVault(root) })

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
