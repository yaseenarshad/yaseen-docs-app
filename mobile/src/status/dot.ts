import type { AnswersState } from '../answers/answers'
import type { LostAnswer, WaitingAnswer } from '../answers/outbox'
import type { CardOp } from '../answers/ops'
import type { ShellSyncStatus } from '../app/syncPort'
import type { TokenEndWarning } from '../auth/expiry'

/** The phone's sync state (decision 12): a dot and a few words in the top bar, always shown. AutoSync's five states. */
export type PhoneSyncState = 'synced' | 'pending' | 'syncing' | 'attention' | 'off'

/** What the dot reads. Four sources, each one small, so the dot is a pure function of them. */
export interface DotInput {
  /** 3B's engine (`useApp().sync`). `problem` is a `GithubErrorCode` or one of 3B's own. */
  sync: { status: ShellSyncStatus; problem: string | null }
  /**
   * 3C's answer list, counted as the person counts (`answersPart`). `loaded`: the list has read its stored answers for
   * the open vault (YAZ-5297). Before that, the counts are not known, so the dot cannot say green.
   */
  answers: { loaded: boolean; waiting: number; lost: number; sending: boolean; problem: string | null; stuck?: 'store' | 'list' | null }
  /** The phone's own signal (`navigator.onLine`). The engine learns it only at its next poll. */
  online: boolean
  /** The token's end date (3E, round 10 item 18). */
  token: TokenEndWarning
}

/** Why the dot shows what it shows: the sheet behind a tap picks its sentence by it. */
export type DotReason =
  | 'synced'
  | 'syncing'
  | 'waiting'
  | 'waiting-offline'
  | 'slowed'
  | 'lost'
  | 'offline'
  | 'token-soon'
  | 'sign-in'
  | 'vault-gone'
  | 'too-large'
  | 'phone-full'
  | 'starting'
  | 'checking'
  | 'no-storage'
  | 'no-list'

export interface Dot {
  /** The colour (decision 12): green, amber, blue, grey ring, red. */
  state: PhoneSyncState
  /** The few words next to the dot. VoiceOver reads them too. */
  words: string
  /** The same facts in 20 characters at most, for a top bar under 380 px (iPhone SE). Equal to `words` when they are short. */
  short: string
  reason: DotReason
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The problems that need the person (red). The engine stops polling on each; the answers stay on the phone. */
const RED: Record<string, { reason: DotReason; words: string }> = {
  UNAUTHORIZED: { reason: 'sign-in', words: 'Sign in again' },
  NO_TOKEN: { reason: 'sign-in', words: 'Sign in again' },
  READ_ONLY: { reason: 'sign-in', words: 'Sign in again' },
  NOT_FOUND: { reason: 'vault-gone', words: 'Vault not found' },
  NO_ACCESS: { reason: 'vault-gone', words: 'Vault not found' },
  TREE_TRUNCATED: { reason: 'too-large', words: 'Vault too large' },
  STORAGE_FULL: { reason: 'phone-full', words: 'Phone is full' },
}

/**
 * THE DOT (decision 12; round 10 items 18 and 20; round 12 item 9; YAZ-5080). The first rule that is true wins:
 *
 * 0. (a cold start) grey "Checking…" until the answer list has read its stored answers: never green before (YAZ-5297).
 *    It ends (YAZ-5302): red "Phone can't save" when the store does not answer, grey "Can't sync now" when it does.
 * 1. red: the person must act. A 401 or a token that ended ("Sign in again"), a vault that is gone, a vault too large,
 *    a full phone. Never for no signal, GitHub down, "slow down" or a failed read: those pass by themselves.
 * 2. amber "N answers could not be saved": a lost answer needs a tap (Discard). It stays until then.
 * 3. no signal (the phone's or the engine's): amber "N answers waiting · no signal" when answers wait, else grey.
 * 4. blue "Syncing…": a pass or a send runs.
 * 5. amber "N answers waiting" (also while GitHub asked to wait).
 * 6. amber "Waiting for GitHub": "slow down", with nothing waiting.
 * 7. amber "Token ends in N days": only in place of green.
 * 8. grey "Not synced yet": no vault is open in the engine.
 * 9. green "Synced".
 */
export function syncDot(input: DotInput): Dot {
  const dot = dotWords(input)
  return { ...dot, short: shortWords(dot, input) }
}

/** YAZ-5216: the short form keeps each fact of the words; only the long words of two states change. */
function shortWords(dot: Omit<Dot, 'short'>, { answers }: DotInput): string {
  if (dot.reason === 'waiting-offline') return `${answers.waiting} waiting · offline`
  if (dot.reason === 'lost') return `${plural(answers.lost, 'answer', 'answers')} not saved`
  return dot.words
}

function dotWords({ sync, answers, online, token }: DotInput): Omit<Dot, 'short'> {
  const red =
    token.kind === 'ended'
      ? RED.UNAUTHORIZED
      : sync.status === 'attention'
        ? (RED[sync.problem ?? ''] ?? RED.UNAUTHORIZED)
        : answers.problem !== null && answers.problem in RED
          ? RED[answers.problem]
          : null
  if (red !== null) return { state: 'attention', ...red }
  // YAZ-5297: a cold start. The list reads its stored answers after the first paint; until then nothing may say "Synced".
  if (!answers.loaded) {
    // YAZ-5302: "Checking…" ends. The store did not answer: the person must act. The store answered: the sync did not start.
    if (answers.stuck === 'store') return { state: 'attention', words: "Phone can't save", reason: 'no-storage' }
    if (answers.stuck === 'list') return { state: 'off', words: "Can't sync now", reason: 'no-list' }
    return { state: 'off', words: 'Checking…', reason: 'checking' }
  }
  if (answers.lost > 0) return { state: 'pending', words: `${plural(answers.lost, 'answer', 'answers')} could not be saved`, reason: 'lost' }
  const waiting = plural(answers.waiting, 'answer', 'answers') + ' waiting'
  if (!online || sync.status === 'off')
    return answers.waiting > 0 ? { state: 'pending', words: `${waiting} · no signal`, reason: 'waiting-offline' } : { state: 'off', words: 'No signal', reason: 'offline' }
  if (sync.status === 'syncing' || answers.sending) return { state: 'syncing', words: 'Syncing…', reason: 'syncing' }
  if (answers.waiting > 0) return { state: 'pending', words: waiting, reason: 'waiting' }
  if (sync.status === 'slowed') return { state: 'pending', words: 'Waiting for GitHub', reason: 'slowed' }
  if (sync.status === 'idle') return { state: 'off', words: 'Not synced yet', reason: 'starting' }
  if (token.kind === 'soon') return { state: 'pending', words: `Token ends in ${plural(token.daysLeft, 'day', 'days')}`, reason: 'token-soon' }
  return { state: 'synced', words: 'Synced', reason: 'synced' }
}

/**
 * The person counts answers, not card actions. One answer can be two actions in one group (Up next off and the
 * review: 3C's `group`), so the dot counts groups.
 */
export function waitingCount(waiting: readonly WaitingAnswer[]): number {
  return new Set(waiting.map((w) => w.group)).size
}

/** One lost answer as the sheet shows it: one row for each card, with every lost action of that card (Discard takes all). */
export interface LostRow {
  id: string
  title: string
  /** The answer in the words of the Review screen. */
  answer: string
  seqs: number[]
}

const ANSWER_WORDS: Record<CardOp['kind'], (op: CardOp) => string> = {
  review: (op) => (op.kind === 'review' && op.review.rating === 'again' ? 'Forgot' : 'Remembered'),
  unreview: () => 'Undo',
  off: (op) => (op.kind === 'off' && !op.on ? 'Unarchive card' : 'Archive card'),
  next: (op) => (op.kind === 'next' && !op.on ? 'Not up next' : 'Up next'),
  fix: (op) => (op.kind === 'fix' && !op.on ? 'Fixed' : 'Fix later'),
}

export function lostRows(lost: readonly LostAnswer[]): LostRow[] {
  const rows = new Map<string, LostRow & { rank: number }>()
  for (const l of lost) {
    // The review is the answer the person gave; an action that only came with it (Up next off) does not name the row.
    const rank = l.op.kind === 'review' ? 2 : l.op.kind === 'next' && !l.op.on ? 0 : 1
    const row = rows.get(l.op.id)
    // YAZ-5245: a card with no title is named by its ID, as Review's lost line names it.
    if (row === undefined) rows.set(l.op.id, { id: l.op.id, title: l.title.trim() === '' ? l.op.id : l.title, answer: ANSWER_WORDS[l.op.kind](l.op), seqs: [l.seq], rank })
    else {
      row.seqs.push(l.seq)
      if (rank > row.rank) Object.assign(row, { answer: ANSWER_WORDS[l.op.kind](l.op), rank })
    }
  }
  return [...rows.values()].map(({ rank: _rank, ...row }) => row)
}

/**
 * The answer list's part of `DotInput`, from 3C's state and its waiting list. `state` null: the list has not read its
 * stored answers yet (`loaded: false`), unless the app has no list at all (`noList`: a sync with no `review()`).
 */
export function answersPart(state: AnswersState | null, waiting: readonly WaitingAnswer[], noList = false, stuck: 'store' | 'list' | null = null): DotInput['answers'] {
  if (state === null) return { loaded: noList, stuck, waiting: 0, lost: 0, sending: false, problem: null }
  return { loaded: true, waiting: waitingCount(waiting), lost: lostRows(state.lost).length, sending: state.sending, problem: state.problem }
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "Last synced 2h ago" (the words of a friend row, round 10 item 12). */
export function lastSyncWords(at: number | null, now: number): string {
  if (at === null) return 'Not synced yet on this phone'
  const ago = now - at
  if (ago < MIN) return 'Last synced just now'
  if (ago < HOUR) return `Last synced ${Math.floor(ago / MIN)} min ago`
  if (ago < DAY) return `Last synced ${Math.floor(ago / HOUR)}h ago`
  return `Last synced ${plural(Math.floor(ago / DAY), 'day', 'days')} ago`
}

/** YAZ-5214: when the answer list tries again. "Next try in about 4 minutes, at 2:32 PM." */
export function nextTryWords(retryAt: number, now: number): string {
  const minutes = Math.ceil((retryAt - now) / MIN)
  if (minutes <= 1) return `Next try in less than a minute, at ${clockTime(retryAt)}.`
  if (minutes < 120) return `Next try in about ${minutes} minutes, at ${clockTime(retryAt)}.`
  return `Next try at ${clockTime(retryAt)}.`
}

/** `14:05` or `2:05 PM`, as the phone's own setting says. */
export const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** `21 Nov` or `Nov 21`, as the phone's own setting says. */
export const dayDate = (iso: string): string => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
