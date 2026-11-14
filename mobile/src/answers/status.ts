import type { SyncProblem, SyncState } from '../sync/engine'
import type { AnswersState, SendProblem } from './answers'

/** The phone's sync state (decision 12): a dot and a few words in the top bar, always shown. AutoSync's five states. */
export type PhoneSyncState = 'synced' | 'pending' | 'syncing' | 'attention' | 'off'

export interface PhoneSyncDot {
  state: PhoneSyncState
  /** The few words next to the dot. 4D may tune them; the decisions name "Synced", "N answers waiting", "Syncing…", "No signal", "Sign in again" and "1 answer could not be saved". */
  words: string
  /** Why it is not green, for the sheet behind a tap. */
  problem: SyncProblem | SendProblem | null
}

const ATTENTION: readonly (SyncProblem | SendProblem)[] = ['UNAUTHORIZED', 'NO_TOKEN', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS']
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The dot of 4D from the engine (3B) and the answer list (3C), in this order:
 * red (the person must act) → blue (a pass or a send runs) → amber (lost answers; then waiting answers, also with no
 * signal or "slow down") → amber ("slow down" with nothing waiting) → grey (no signal) → green.
 * The answers waiting win over "No signal" (YAZ-5073 scenario table: "Answer with no connection … 'N answers waiting'").
 */
export function phoneSyncDot(sync: SyncState, answers: AnswersState): PhoneSyncDot {
  const attention = sync.status === 'attention' ? sync.problem : answers.problem !== null && ATTENTION.includes(answers.problem) ? answers.problem : null
  if (attention !== null) return { state: 'attention', words: attentionWords(attention), problem: attention }
  if (sync.status === 'syncing' || answers.sending) return { state: 'syncing', words: 'Syncing…', problem: null }
  if (answers.lost.length > 0) return { state: 'pending', words: `${plural(answers.lost.length, 'answer', 'answers')} could not be saved`, problem: answers.problem }
  if (answers.waiting > 0) return { state: 'pending', words: `${plural(answers.waiting, 'answer', 'answers')} waiting`, problem: answers.problem ?? sync.problem }
  if (sync.status === 'slowed') return { state: 'pending', words: 'GitHub asked to wait', problem: sync.problem }
  if (sync.status === 'off') return { state: 'off', words: 'No signal', problem: sync.problem }
  if (sync.status === 'idle') return { state: 'off', words: '', problem: null }
  return { state: 'synced', words: 'Synced', problem: null }
}

function attentionWords(problem: SyncProblem | SendProblem): string {
  if (problem === 'READ_ONLY') return "Your token can't save answers"
  if (problem === 'STORAGE_FULL') return 'The phone is full'
  if (problem === 'TREE_TRUNCATED') return 'The vault is too large'
  return 'Sign in again'
}
