import { describe, expect, it } from 'vitest'
import type { SyncState } from '../sync/engine'
import type { AnswersState } from './answers'
import { phoneSyncDot } from './status'

const sync = (s: Partial<SyncState> = {}): SyncState => ({ status: 'synced', vault: 'v', problem: null, retryAt: null, progress: null, lastSyncedAt: 1, ready: true, ...s })
const answers = (a: Partial<AnswersState> = {}): AnswersState => ({ vault: 'v', waiting: 0, lost: [], sending: false, problem: null, retryAt: null, lastSentAt: null, ...a })
const lost = { seq: 1, op: { kind: 'review' as const, id: 'NC-2', review: { at: '2026-11-14T06:01Z', rating: 'good' as const } }, path: 'a.md', title: 'T', lostAt: 0 }

describe('the dot of 4D (decision 12; round 12 item 9): the engine and the answer list together', () => {
  const cases: [string, SyncState, AnswersState, string, string][] = [
    ['all sent', sync(), answers(), 'synced', 'Synced'],
    ['answers waiting', sync(), answers({ waiting: 1 }), 'pending', '1 answer waiting'],
    ['answers waiting with no signal', sync({ status: 'off', problem: 'OFFLINE' }), answers({ waiting: 3, problem: 'OFFLINE' }), 'pending', '3 answers waiting'],
    ['no signal, nothing waiting', sync({ status: 'off', problem: 'OFFLINE' }), answers(), 'off', 'No signal'],
    ['a pass runs', sync({ status: 'syncing' }), answers({ waiting: 2 }), 'syncing', 'Syncing…'],
    ['the list is sending', sync(), answers({ waiting: 2, sending: true }), 'syncing', 'Syncing…'],
    ['a lost answer', sync(), answers({ lost: [lost] }), 'pending', '1 answer could not be saved'],
    ['two lost answers', sync(), answers({ lost: [lost, { ...lost, seq: 2 }] }), 'pending', '2 answers could not be saved'],
    ['token cancelled on a send', sync(), answers({ waiting: 1, problem: 'UNAUTHORIZED' }), 'attention', 'Sign in again'],
    ['token cancelled on a pass', sync({ status: 'attention', problem: 'UNAUTHORIZED' }), answers({ waiting: 1 }), 'attention', 'Sign in again'],
    ['no write access', sync(), answers({ waiting: 1, problem: 'READ_ONLY' }), 'attention', 'Your token can\'t save answers'],
    ['"slow down" on a send', sync(), answers({ waiting: 1, problem: 'RATE_LIMITED', retryAt: 5 }), 'pending', '1 answer waiting'],
  ]
  for (const [name, s, a, state, words] of cases)
    it(name, () => {
      expect(phoneSyncDot(s, a)).toMatchObject({ state, words })
    })
})
