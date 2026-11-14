import { describe, expect, it } from 'vitest'
import type { LostAnswer, WaitingAnswer } from '../answers/outbox'
import type { ShellSyncStatus } from '../app/syncPort'
import type { TokenEndWarning } from '../auth/expiry'
import { lastSyncWords, lostRows, syncDot, waitingCount, type DotInput } from './dot'

/**
 * The status dot (decision 12; round 10 items 18 and 20; round 12 item 9; YAZ-5080): ONE pure function from the
 * engine's status, the answer list, the signal and the token to a colour and its words.
 */

const NONE: TokenEndWarning = { kind: 'none' }
const SOON: TokenEndWarning = { kind: 'soon', endsAt: '2026-11-17T00:00:00.000Z', daysLeft: 3 }
const SOON_1: TokenEndWarning = { kind: 'soon', endsAt: '2026-11-14T00:00:00.000Z', daysLeft: 1 }
const ENDED: TokenEndWarning = { kind: 'ended', endsAt: '2026-11-01T00:00:00.000Z' }

const input = (over: {
  status?: ShellSyncStatus
  problem?: string | null
  waiting?: number
  lost?: number
  sending?: boolean
  sendProblem?: string | null
  online?: boolean
  token?: TokenEndWarning
} = {}): DotInput => ({
  sync: { status: over.status ?? 'synced', problem: over.problem ?? null },
  answers: { waiting: over.waiting ?? 0, lost: over.lost ?? 0, sending: over.sending ?? false, problem: over.sendProblem ?? null },
  online: over.online ?? true,
  token: over.token ?? NONE,
})

const dot = (over: Parameters<typeof input>[0]) => {
  const d = syncDot(input(over))
  return `${d.state} ${d.words}`
}

describe('the table: which state wins when two are true', () => {
  // [what is true, the colour and the words]. Read top to bottom: the first row of a group wins over the rows below it.
  const TABLE: [string, Parameters<typeof input>[0], string][] = [
    // Green: the normal case.
    ['all sent, up to date', {}, 'synced Synced'],
    // Blue: a pass or a send runs.
    ['a pass runs', { status: 'syncing' }, 'syncing Syncing…'],
    ['the list sends', { sending: true, waiting: 1 }, 'syncing Syncing…'],
    ['a pass runs while answers wait', { status: 'syncing', waiting: 2 }, 'syncing Syncing…'],
    ['a pass runs while GitHub asked to wait (the next try)', { status: 'syncing', sendProblem: 'RATE_LIMITED', waiting: 1 }, 'syncing Syncing…'],
    // Amber: answers wait.
    ['1 answer waits', { waiting: 1 }, 'pending 1 answer waiting'],
    ['3 answers wait', { waiting: 3 }, 'pending 3 answers waiting'],
    ['answers wait, GitHub asked to wait (round 10 item 20: not red)', { status: 'slowed', problem: 'RATE_LIMITED', waiting: 2 }, 'pending 2 answers waiting'],
    ['the send was told to wait', { waiting: 1, sendProblem: 'RATE_LIMITED' }, 'pending 1 answer waiting'],
    ['GitHub asked to wait, nothing waits', { status: 'slowed', problem: 'RATE_LIMITED' }, 'pending Waiting for GitHub'],
    // Amber: the token ends soon (round 10 item 18). Only in place of green.
    ['the token ends in 3 days', { token: SOON }, 'pending Token ends in 3 days'],
    ['the token ends in 1 day', { token: SOON_1 }, 'pending Token ends in 1 day'],
    ['the token ends soon, answers wait', { token: SOON, waiting: 1 }, 'pending 1 answer waiting'],
    ['the token ends soon, a pass runs', { token: SOON, status: 'syncing' }, 'syncing Syncing…'],
    ['the token ends soon, no signal', { token: SOON, online: false }, 'off No signal'],
    // Grey: no signal. Waiting answers win (the mockup's status()), and the words name both (YAZ-5080 edge case).
    ['no signal (the phone says it is offline)', { online: false }, 'off No signal'],
    ['no signal (the engine could not reach GitHub)', { status: 'off', problem: 'OFFLINE' }, 'off No signal'],
    ['GitHub is down: as no signal (October N5)', { status: 'off', problem: 'GITHUB_DOWN' }, 'off No signal'],
    ['a hung request ended after 30 s (YAZ-5173)', { status: 'off', problem: 'OFFLINE' }, 'off No signal'],
    ['the token store failed one read (YAZ-5170)', { status: 'off', problem: 'FAILED' }, 'off No signal'],
    ['no signal while a pass starts', { online: false, status: 'syncing' }, 'off No signal'],
    ['no signal, 1 answer waits', { online: false, waiting: 1 }, 'pending 1 answer waiting · no signal'],
    ['no signal, 3 answers wait', { status: 'off', problem: 'OFFLINE', waiting: 3, sendProblem: 'OFFLINE' }, 'pending 3 answers waiting · no signal'],
    ['no signal, the list tries to send', { online: false, waiting: 2, sending: true }, 'pending 2 answers waiting · no signal'],
    // Amber: a lost answer (round 12 item 9). It needs a tap, so it wins over blue, grey and waiting.
    ['1 lost answer', { lost: 1 }, 'pending 1 answer could not be saved'],
    ['2 lost answers', { lost: 2 }, 'pending 2 answers could not be saved'],
    ['a lost answer, others wait', { lost: 1, waiting: 4 }, 'pending 1 answer could not be saved'],
    ['a lost answer, a pass runs', { lost: 1, status: 'syncing' }, 'pending 1 answer could not be saved'],
    ['a lost answer, no signal', { lost: 1, online: false }, 'pending 1 answer could not be saved'],
    ['a lost answer, the token ends soon', { lost: 1, token: SOON }, 'pending 1 answer could not be saved'],
    // Red: the person must act. It wins over all.
    ['the token was cancelled (401, N6)', { status: 'attention', problem: 'UNAUTHORIZED' }, 'attention Sign in again'],
    ['the phone has no token for the vault', { status: 'attention', problem: 'NO_TOKEN' }, 'attention Sign in again'],
    ['the token can read but not write', { status: 'attention', problem: 'READ_ONLY' }, 'attention Sign in again'],
    ['a send got 401', { waiting: 1, sendProblem: 'UNAUTHORIZED' }, 'attention Sign in again'],
    ['a send got 403 on a write', { waiting: 1, sendProblem: 'READ_ONLY' }, 'attention Sign in again'],
    ['the token ended by its date', { token: ENDED }, 'attention Sign in again'],
    ['the vault is gone (R12)', { status: 'attention', problem: 'NOT_FOUND' }, 'attention Vault not found'],
    ['the token cannot see the vault now', { status: 'attention', problem: 'NO_ACCESS' }, 'attention Vault not found'],
    ['a send found the repo gone', { waiting: 1, sendProblem: 'NOT_FOUND' }, 'attention Vault not found'],
    ['the vault is too large (F6)', { status: 'attention', problem: 'TREE_TRUNCATED' }, 'attention Vault too large'],
    ['the phone is full', { status: 'attention', problem: 'STORAGE_FULL' }, 'attention Phone is full'],
    ['401 with answers waiting and no signal', { status: 'attention', problem: 'UNAUTHORIZED', waiting: 3, online: false }, 'attention Sign in again'],
    ['401 with a lost answer', { status: 'attention', problem: 'UNAUTHORIZED', lost: 1 }, 'attention Sign in again'],
    ['the token ended, a pass runs', { token: ENDED, status: 'syncing' }, 'attention Sign in again'],
    // Grey: no vault open yet (the engine is idle). Never empty words.
    ['the engine has not started', { status: 'idle' }, 'off Not synced yet'],
  ]
  for (const [what, over, expected] of TABLE)
    it(what, () => {
      expect(dot(over)).toBe(expected)
    })
})

describe('every combination', () => {
  const STATUSES: [ShellSyncStatus, string | null][] = [
    ['idle', null],
    ['syncing', null],
    ['synced', null],
    ['off', 'OFFLINE'],
    ['off', 'GITHUB_DOWN'],
    ['off', 'FAILED'],
    ['slowed', 'RATE_LIMITED'],
    ['attention', 'UNAUTHORIZED'],
    ['attention', 'NO_TOKEN'],
    ['attention', 'READ_ONLY'],
    ['attention', 'NOT_FOUND'],
    ['attention', 'NO_ACCESS'],
    ['attention', 'TREE_TRUNCATED'],
    ['attention', 'STORAGE_FULL'],
  ]
  const SEND_PROBLEMS = [null, 'OFFLINE', 'GITHUB_DOWN', 'RATE_LIMITED', 'FAILED', 'UNAUTHORIZED', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS']
  const all: { over: Parameters<typeof input>[0]; d: ReturnType<typeof syncDot> }[] = []
  for (const [status, problem] of STATUSES)
    for (const waiting of [0, 1, 3])
      for (const lost of [0, 1, 2])
        for (const sending of [false, true])
          for (const sendProblem of SEND_PROBLEMS)
            for (const online of [true, false])
              for (const token of [NONE, SOON, ENDED]) {
                const over = { status, problem, waiting, lost, sending, sendProblem, online, token }
                all.push({ over, d: syncDot(input(over)) })
              }

  it(`covers ${14 * 3 * 3 * 2 * 9 * 2 * 3} combinations`, () => {
    expect(all.length).toBe(13_608)
  })

  it('red only when the person must sign in again or fix the vault: never for no signal, GitHub down, a failed read or "slow down"', () => {
    const PERSON = ['UNAUTHORIZED', 'NO_TOKEN', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS', 'TREE_TRUNCATED', 'STORAGE_FULL']
    for (const { over, d } of all) {
      const mustAct = over.status === 'attention' || over.token === ENDED || (over.sendProblem !== null && PERSON.includes(over.sendProblem!))
      expect([over, d.state === 'attention']).toEqual([over, mustAct])
    }
  })

  it('a lost answer always shows (amber) unless red wins', () => {
    for (const { over, d } of all) if (over.lost! > 0 && d.state !== 'attention') expect(d.words).toMatch(/could not be saved$/)
  })

  it('waiting answers are never hidden by grey: grey only when nothing waits and nothing is lost', () => {
    for (const { over, d } of all) if (d.state === 'off') expect([over.waiting, over.lost]).toEqual([0, 0])
  })

  it('green only when all is sent, the engine says synced, the phone is online and the token does not end soon', () => {
    for (const { over, d } of all)
      if (d.state === 'synced') {
        expect(over).toMatchObject({ status: 'synced', waiting: 0, lost: 0, sending: false, online: true, token: NONE })
        expect(['UNAUTHORIZED', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS']).not.toContain(over.sendProblem)
      }
  })

  it('the words are never empty, never hold a code, and fit the top bar (30 characters at most)', () => {
    for (const { d } of all) {
      expect(d.words.length).toBeGreaterThan(0)
      expect(d.words.length).toBeLessThanOrEqual(30)
      expect(d.words).not.toMatch(/[A-Z]{2,}_|\b\d{3}\b/)
    }
  })

  it('the five colours of decision 12 and nothing more', () => {
    expect(new Set(all.map(({ d }) => d.state))).toEqual(new Set(['synced', 'pending', 'syncing', 'off', 'attention']))
  })
})

const waiting = (group: number, seq: number): WaitingAnswer => ({ seq, group, op: { kind: 'review', id: `NC-${group}`, review: { at: '2026-11-14T06:01Z', rating: 'good' } }, path: 'a.md', title: 'T', madeAt: 0 })

describe('1 vs N: what counts as one answer', () => {
  it('an answer is ONE person action: its two card actions (Up next off and the review) count one time', () => {
    expect(waitingCount([])).toBe(0)
    expect(waitingCount([{ ...waiting(1, 1), op: { kind: 'next', id: 'NC-1', on: false } }, waiting(1, 2)])).toBe(1)
    expect(waitingCount([waiting(1, 1), waiting(2, 2), waiting(3, 3)])).toBe(3)
  })

  it('a lost answer is one row for each card, with its title and the answer in words; Discard takes all its actions', () => {
    const lost = (seq: number, op: LostAnswer['op'], title = 'Speed of light'): LostAnswer => ({ seq, op, path: 'a.md', title, lostAt: 0 })
    const rows = lostRows([
      lost(4, { kind: 'next', id: 'NC-17', on: false }),
      lost(5, { kind: 'review', id: 'NC-17', review: { at: '2026-11-14T06:01Z', rating: 'good' } }),
      lost(6, { kind: 'review', id: 'NC-2', review: { at: '2026-11-14T06:02Z', rating: 'again' } }, 'Ohm'),
      lost(7, { kind: 'off', id: 'NC-3', on: true }, 'Old card'),
      lost(8, { kind: 'next', id: 'NC-4', on: true }, 'Soon'),
      lost(9, { kind: 'fix', id: 'NC-5', on: true }, 'Typo'),
      lost(10, { kind: 'unreview', id: 'NC-6', at: '2026-11-14T06:03Z' }, 'Undone'),
    ])
    expect(rows).toEqual([
      { id: 'NC-17', title: 'Speed of light', answer: 'Remembered', seqs: [4, 5] },
      { id: 'NC-2', title: 'Ohm', answer: 'Forgot', seqs: [6] },
      { id: 'NC-3', title: 'Old card', answer: 'Archive card', seqs: [7] },
      { id: 'NC-4', title: 'Soon', answer: 'Up next', seqs: [8] },
      { id: 'NC-5', title: 'Typo', answer: 'Fix later', seqs: [9] },
      { id: 'NC-6', title: 'Undone', answer: 'Undo', seqs: [10] },
    ])
  })
})

describe('the time of the last sync (a tap on the dot)', () => {
  const NOW = Date.UTC(2026, 10, 14, 12)
  it('"just now", minutes, hours, days; and the phone that never synced', () => {
    expect(lastSyncWords(null, NOW)).toBe('Not synced yet on this phone')
    expect(lastSyncWords(NOW - 20_000, NOW)).toBe('Last synced just now')
    expect(lastSyncWords(NOW + 5_000, NOW)).toBe('Last synced just now')
    expect(lastSyncWords(NOW - 60_000, NOW)).toBe('Last synced 1 min ago')
    expect(lastSyncWords(NOW - 59 * 60_000, NOW)).toBe('Last synced 59 min ago')
    expect(lastSyncWords(NOW - 2 * 3_600_000, NOW)).toBe('Last synced 2h ago')
    expect(lastSyncWords(NOW - 23 * 3_600_000 - 59 * 60_000, NOW)).toBe('Last synced 23h ago')
    expect(lastSyncWords(NOW - 24 * 3_600_000, NOW)).toBe('Last synced 1 day ago')
    expect(lastSyncWords(NOW - 5 * 24 * 3_600_000, NOW)).toBe('Last synced 5 days ago')
  })
})
