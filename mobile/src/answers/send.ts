import { cardsById } from '@shared/cardLinks'
import { GithubError } from '../github/client'
import type { VaultStore } from '../store'
import type { Change, GithubRemote } from '../sync/githubRemote'
import { syncPass } from '../sync/pass'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import { applyOps, type CardOp } from './ops'
import type { Outbox, WaitingAnswer } from './outbox'

/** A send reads again and repeats at most this often when GitHub says the branch moved (`STALE_HEAD`). */
export const MAX_STALE_HEADS = 5
/** The subject names this many files, then "+N more" (AutoSync's `commitMessage`, `desktop/src/main/git/sync.ts`). */
const SUBJECT_FILES = 3

/** The commit subject, in AutoSync's form: `sync (phone): a.md, b.md, c.md +4 more` (basenames). */
export function commitSubject(paths: readonly string[]): string {
  const names = paths.map((p) => p.split('/').pop()!).filter((n) => n !== '')
  const rest = names.length - SUBJECT_FILES
  const head = names.slice(0, SUBJECT_FILES).join(', ')
  return rest > 0 ? `sync (phone): ${head} +${rest} more` : `sync (phone): ${head}`
}

export interface SendOptions {
  remote: GithubRemote
  store: VaultStore
  /** The vault id. */
  vault: string
  outbox: Outbox
  /**
   * One sync pass that brings the stored copy to the newest head. In the app it is the engine's pass inside its lane
   * (`engine.lane((remote, pass) => …)`), so the screens hear of it. Default: a bare `syncPass`.
   */
  pass?: () => Promise<unknown>
  now?: () => number
  yieldToUi?: () => Promise<void>
}

export interface SendReport {
  /** `sent`: GitHub holds every action that was waiting (some may be lost). `nothing`: no action was waiting or all were lost. `offline`: no connection, or GitHub is down. */
  result: 'sent' | 'nothing' | 'offline'
  /** The new commit, or null when no commit was needed. */
  commit: string | null
  /** Actions that left the list because GitHub holds them. */
  sent: number
  /** Actions whose card was gone: moved to the lost list. */
  lost: number
  /** How often GitHub refused the move because the branch had moved first. */
  staleHeads: number
  /** The files of the commit. */
  files: string[]
  /** The stored copy holds the result (the pass after the commit worked). */
  stored: boolean
}

/**
 * ONE SEND of the answer list (decision 2): read the head, apply the waiting actions to the newest text, make ONE commit,
 * move the branch. Each round:
 *  1. A sync pass brings the stored copy and its index to the newest head (only changed files download).
 *  2. Each action finds its card's file by card ID in the index of THAT head (`cardsById`): the Mac can move a card to
 *     another page, or into its own card file, after the answer. A page that only embeds the card is never written.
 *  3. `applyOps` on each file's stored text. A card that the newest head does not hold: the action is lost (it moves to
 *     the lost list and never blocks the others).
 *  4. No file changed: GitHub already holds every action (a send that reached GitHub but whose answer was lost). They
 *     leave the list with no write. Else ONE commit with every changed file (`remote.commit`: blobs, tree with
 *     `base_tree`, commit, `PATCH` the ref with `force: false`).
 *  5. GitHub refuses the move when the branch moved first (422 "Update is not a fast forward": `STALE_HEAD`): repeat
 *     from step 1, at most `MAX_STALE_HEADS` times.
 * An action leaves the list only after the move (then a pass takes the new head in, so the stored copy holds it).
 * No connection or GitHub down: `offline`, and the actions stay. Every other failure is thrown as it is (`GithubError`:
 * `UNAUTHORIZED`, `READ_ONLY`, `RATE_LIMITED`, a 409 or 422 that is not "not a fast forward" as `UNEXPECTED`, …), and
 * the actions stay.
 */
export async function sendOutbox(options: SendOptions): Promise<SendReport> {
  const { remote, store, vault, outbox } = options
  const now = options.now ?? Date.now
  const pass = options.pass ?? (() => syncPass({ remote, store, vault, now, yieldToUi: options.yieldToUi }))
  const report: SendReport = { result: 'nothing', commit: null, sent: 0, lost: 0, staleHeads: 0, files: [], stored: false }
  if (outbox.waiting().length === 0) return report
  try {
    for (;;) {
      await pass()
      await outbox.refresh()
      const plan = await planSend(store, vault, outbox.waiting())
      if (plan.changes.length > 0) {
        // YAZ-5180: from here GitHub may hold these actions, so Undo may no longer remove them. An action that Undo
        // removed after the plan was made is not marked: plan again without it.
        const marked = await outbox.markTried(plan.done.map((w) => w.seq))
        if (marked.length < plan.done.length) continue
        try {
          report.commit = await remote.commit(plan.parent, plan.changes, commitSubject(plan.changes.map((c) => c.path)))
        } catch (error) {
          if (error instanceof GithubError && error.code === 'STALE_HEAD' && report.staleHeads < MAX_STALE_HEADS) {
            report.staleHeads++
            continue
          }
          throw error
        }
        report.files = plan.changes.map((c) => c.path)
        // The branch moved: the stored copy takes the new head in before the actions leave, so the screens never
        // lose them. If that pass fails, the actions still leave (GitHub has them); the next pass brings them.
        try {
          await pass()
          report.stored = true
        } catch {
          report.stored = false
        }
      } else report.stored = true
      await outbox.settle(plan.done.map((w) => w.seq), plan.lost.map((w) => w.seq), now())
      report.sent = plan.done.length
      report.lost = plan.lost.length
      report.result = plan.done.length > 0 ? 'sent' : 'nothing'
      return report
    }
  } catch (error) {
    if (error instanceof GithubError && (error.code === 'OFFLINE' || error.code === 'GITHUB_DOWN')) return { ...report, result: 'offline', commit: null }
    throw error
  }
}

interface SendPlan {
  parent: string
  changes: Change[]
  /** Actions that the commit holds, or that GitHub already holds. */
  done: WaitingAnswer[]
  lost: WaitingAnswer[]
}

/** Steps 2 and 3 on the stored copy, which the pass just brought to the head. */
async function planSend(store: VaultStore, vault: string, waiting: readonly WaitingAnswer[]): Promise<SendPlan> {
  const checkpoint = await store.checkpoint(vault)
  const index = await store.getState<PhoneIndex>(vault, INDEX_STATE)
  if (checkpoint === null || index === undefined || index.commit !== checkpoint.commit) throw new Error('The phone has no full copy of the vault yet')
  const byId = cardsById(Object.values(index.records))
  const files = new Map<string, WaitingAnswer[]>()
  const lost: WaitingAnswer[] = []
  for (const w of waiting) {
    const link = byId.get(w.op.id.toLowerCase())
    if (link === undefined) lost.push(w)
    else files.set(link.path, [...(files.get(link.path) ?? []), w])
  }
  const changes: Change[] = []
  const done: WaitingAnswer[] = []
  for (const [path, list] of files) {
    const file = await store.read(vault, path)
    // Not stored (over the size limit, F7): the actions wait; they never block the others.
    if (file === null || typeof file.content !== 'string') continue
    const out = applyOps(file.content, list.map((w) => w.op))
    const missing = new Set<CardOp>(out.lost)
    for (const w of list) (missing.has(w.op) ? lost : done).push(w)
    if (out.content !== file.content) changes.push({ path, content: out.content })
  }
  return { parent: checkpoint.commit, changes, done, lost }
}
