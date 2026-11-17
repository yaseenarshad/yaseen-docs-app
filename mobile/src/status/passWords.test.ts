import { describe, expect, it } from 'vitest'
import { IDLE, type ShellSyncEvent, type ShellSyncState } from '../app/syncPort'
import { passWords } from './passWords'

/** YAZ-5469: the words of the toast after a tap on the dot. Made-up paths only. */
const synced: ShellSyncState = { ...IDLE, status: 'synced', vault: 'demo/vault@main', ready: true }
const changed = (diff: { added?: string[]; changed?: string[]; removed?: string[]; renamed?: { from: string; to: string }[] }, vault = 'demo/vault@main'): ShellSyncEvent => ({
  type: 'changed',
  vault,
  settings: [],
  diff: { added: [], changed: [], removed: [], renamed: [], ...diff },
})

describe('the toast after a tap on the dot (YAZ-5469)', () => {
  it('counts the pages that came in: added, changed, removed, renamed; once each', () => {
    expect(passWords(synced, [changed({ added: ['a.md'], changed: ['b.md'], removed: ['c.md'], renamed: [{ from: 'd.md', to: 'e.md' }] })], true)).toBe('Synced · 4 pages updated')
    expect(passWords(synced, [changed({ changed: ['a.md'] }), changed({ changed: ['a.md'] })], true)).toBe('Synced · 1 page updated')
  })
  it('only other files: says files; pages and files: counts the pages', () => {
    expect(passWords(synced, [changed({ added: ['img/a.png', '.yaseendocs/x.json'] })], true)).toBe('Synced · 2 files updated')
    expect(passWords(synced, [changed({ added: ['img/a.png', 'a.md'] })], true)).toBe('Synced · 1 page updated')
  })
  it('up to date: no diff, an empty diff, a diff of another vault, the index read from the store (diff null)', () => {
    expect(passWords(synced, [], true)).toBe('Synced · up to date')
    expect(passWords(synced, [changed({})], true)).toBe('Synced · up to date')
    expect(passWords(synced, [changed({ added: ['a.md'] }, 'other/vault@main')], true)).toBe('Synced · up to date')
    expect(passWords(synced, [{ type: 'changed', vault: 'demo/vault@main', settings: [], diff: null }], true)).toBe('Synced · up to date')
  })
  it('fails: no signal, GitHub down, slow down, red problems', () => {
    expect(passWords(synced, [], false)).toBe('No signal · will sync later')
    expect(passWords({ ...synced, status: 'off', problem: 'OFFLINE' }, [], true)).toBe('No signal · will sync later')
    expect(passWords({ ...synced, status: 'off', problem: 'GITHUB_DOWN' }, [], true)).toBe('GitHub is down · will sync later')
    expect(passWords({ ...synced, status: 'off', problem: 'FAILED' }, [], true)).toBe('Sync failed · will try again')
    expect(passWords({ ...synced, status: 'slowed', problem: 'RATE_LIMITED' }, [], true)).toBe('GitHub asked to wait · will sync later')
    expect(passWords({ ...synced, status: 'attention', problem: 'NOT_FOUND' }, [], true)).toBe('Not synced · vault not found')
    expect(passWords({ ...synced, status: 'attention', problem: 'STORAGE_FULL' }, [], true)).toBe('Not synced · phone is full')
  })
})
