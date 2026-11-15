import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { canonicalPageId, isPageId, PAGE_ID_KEY } from '@shared/pageId'
import { commitSubject, MAX_STALE_HEADS } from '../answers/send'
import { GithubError } from '../github/client'
import type { VaultStore } from '../store'
import type { Change, GithubRemote } from '../sync/githubRemote'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import type { CommentBox, WaitingComment } from './outbox'
import { applyTask } from './taskWrite'
import { applyComment } from './write'

export interface CommentSendOptions {
  remote: GithubRemote
  store: VaultStore
  vault: string
  box: CommentBox
  /** One sync pass that brings the stored copy to the newest head (the engine's pass inside its lane). */
  pass: () => Promise<unknown>
  now?: () => number
}

export interface CommentSendReport {
  /** `sent`: GitHub holds each comment that was due. `nothing`: none was due. `offline`: no connection, or GitHub is down. */
  result: 'sent' | 'nothing' | 'offline'
  commit: string | null
  sent: number
  refused: number
  staleHeads: number
  /** The stored copy holds the result (the pass after the commit worked): the page shows the comment at once. */
  stored: boolean
}

type Refusal = { id: string; why: NonNullable<WaitingComment['refused']> }

/**
 * ONE SEND of the comment list (YAZ-5461; and the check box ticks, YAZ-5494: `taskWrite.ts`, on the same path), on the answer list's path (`answers/send.ts`, YAZ-5097 decision 2): the
 * write is compare-and-swap on the branch, never a force push, never a conflict copy.
 *  1. A sync pass brings the stored copy to the newest head: the page's FRESH bytes.
 *  2. Each comment that is due goes onto its page as it is NOW (`applyComment`): the number is taken on that page,
 *     and a comment whose id the page holds already is not added again (a try whose answer was lost).
 *  3. A page that is gone from its path but found again FOR SURE (YAZ-5517: `movedTo`): the comment goes there.
 *     A page whose `comments` is not a comment list, that does not parse, or that is gone: the comment is refused,
 *     nothing is written, and it stays on the phone with its words (the page shows it with Discard; and the dot and
 *     its sheet count it until Discard, YAZ-5517).
 *  4. ONE commit with each changed page (`remote.commit`: a tree on `base_tree`, then the ref `PATCH` with
 *     `force: false`). GitHub refuses it when the branch moved first (`STALE_HEAD`): back to 1, at most
 *     `MAX_STALE_HEADS` times: the comments go again onto the newest pages, with the numbers of those pages.
 *  5. A pass takes the new head in (the page shows the comment), then the comments leave the list.
 * No connection or GitHub down: `offline`, the comments stay. Any other failure is thrown, and they stay.
 */
export async function sendComments(options: CommentSendOptions): Promise<CommentSendReport> {
  const { remote, store, vault, box, pass } = options
  const now = options.now ?? Date.now
  const report: CommentSendReport = { result: 'nothing', commit: null, sent: 0, refused: 0, staleHeads: 0, stored: false }
  // An unsigned comment (no account known yet) waits for its `by`: the sender signs it first.
  // A tick (YAZ-5494) is signed by nothing: it changes one box, not the comments.
  const due = () => box.waiting().filter((c) => c.refused === undefined && (c.by !== undefined || c.task !== undefined) && c.notBefore <= now())
  if (due().length === 0) return report
  try {
    for (;;) {
      await pass()
      await box.refresh()
      const list = due()
      if (list.length === 0) return report
      const plan = await planComments(store, vault, list)
      if (plan.changes.length > 0) {
        // From here GitHub may hold them: Undo can no longer take them back. One that Undo took meanwhile: plan again.
        const marked = await box.markTried(plan.added.map((c) => c.id))
        if (marked.length < plan.added.length) continue
        try {
          report.commit = await remote.commit(plan.parent, plan.changes, commitSubject(plan.changes.map((c) => c.path)))
        } catch (error) {
          if (error instanceof GithubError && error.code === 'STALE_HEAD' && report.staleHeads < MAX_STALE_HEADS) {
            report.staleHeads++
            continue
          }
          throw error
        }
        try {
          await pass()
          report.stored = true
        } catch {
          report.stored = false
        }
      } else report.stored = true
      if (plan.moved.length > 0) await box.follow(plan.moved)
      const done = [...plan.added, ...plan.already].map((c) => c.id)
      await box.settle(done, plan.refused)
      report.sent = done.length
      report.refused = plan.refused.length
      report.result = done.length > 0 ? 'sent' : 'nothing'
      return report
    }
  } catch (error) {
    if (error instanceof GithubError && (error.code === 'OFFLINE' || error.code === 'GITHUB_DOWN')) return { ...report, result: 'offline', commit: null }
    throw error
  }
}

interface CommentPlan {
  parent: string
  changes: Change[]
  added: WaitingComment[]
  already: WaitingComment[]
  refused: Refusal[]
  /** YAZ-5517: comments whose page moved, and where to. */
  moved: { id: string; path: string }[]
}

/**
 * YAZ-5517: what finds a page again after the Mac moves it: its blob SHA (only when no other file had the same bytes, so
 * one path with it later is that file), and its page `id`. From the stored copy, when the comment goes in.
 */
export async function pageMark(store: VaultStore, vault: string, path: string): Promise<WaitingComment['was']> {
  try {
    const checkpoint = await store.checkpoint(vault)
    const sha = checkpoint?.shas[path]
    const only = sha !== undefined && Object.values(checkpoint!.shas).filter((s) => s === sha).length === 1
    const file = await store.read(vault, path)
    const id = typeof file?.content === 'string' ? pageIdOf(file.content) : undefined
    const was = { ...(only ? { sha } : {}), ...(id === undefined ? {} : { id }) }
    return Object.keys(was).length === 0 ? undefined : was
  } catch {
    return undefined
  }
}

function pageIdOf(content: string): string | undefined {
  const id = parseFrontmatter(splitFrontmatter(content).frontmatter).properties[PAGE_ID_KEY]
  return isPageId(id) ? canonicalPageId(id) : undefined
}

/**
 * YAZ-5517: where a page gone from its path is now, when that is SURE: the one path that holds its old bytes (a git
 * rename, as the sync pass pairs them, `diffTrees`), else the one page with its `id`. Two candidates, or none: null.
 */
function movedTo(was: WaitingComment['was'], shas: Readonly<Record<string, string>>, index: PhoneIndex | null): string | null {
  if (was === undefined) return null
  if (was.sha !== undefined) {
    const same = Object.keys(shas).filter((p) => shas[p] === was.sha)
    if (same.length === 1) return same[0]!
  }
  if (was.id !== undefined && index !== null) {
    const same = Object.values(index.records).filter((r) => r.id === was.id && shas[r.path] !== undefined)
    if (same.length === 1) return same[0]!.path
  }
  return null
}

/** Step 2 and 3 on the stored copy, which the pass just brought to the head. */
async function planComments(store: VaultStore, vault: string, list: readonly WaitingComment[]): Promise<CommentPlan> {
  const checkpoint = await store.checkpoint(vault)
  if (checkpoint === null) throw new Error('The phone has no full copy of the vault yet')
  const plan: CommentPlan = { parent: checkpoint.commit, changes: [], added: [], already: [], refused: [], moved: [] }
  // YAZ-5517: a page gone from its path that is found again for sure: its comments and ticks go to its new path.
  let index: PhoneIndex | null | undefined
  const byPath = new Map<string, WaitingComment[]>()
  for (const c of list) {
    let path = c.path
    if (checkpoint.shas[path] === undefined && c.was !== undefined) {
      if (index === undefined) {
        const saved = await store.getState<PhoneIndex>(vault, INDEX_STATE)
        index = saved !== undefined && saved.commit === checkpoint.commit ? saved : null
      }
      const to = movedTo(c.was, checkpoint.shas, index)
      if (to !== null) {
        path = to
        plan.moved.push({ id: c.id, path })
      }
    }
    byPath.set(path, [...(byPath.get(path) ?? []), c])
  }
  for (const [path, comments] of byPath) {
    const file = checkpoint.shas[path] === undefined ? null : await store.read(vault, path)
    if (file === null || typeof file.content !== 'string') {
      // Gone from the vault (deleted or renamed on the Mac), or over the phone's size limit (F7): the words stay here.
      const why = checkpoint.shas[path] === undefined ? 'gone' : 'too-large'
      for (const c of comments) plan.refused.push({ id: c.id, why })
      continue
    }
    let content = file.content
    for (const c of comments) {
      // YAZ-5494: a tick finds its task on the page as it is NOW, and sets its box; a task that changed is refused.
      const out = c.task !== undefined ? applyTask(content, c.task) : applyComment(content, { id: c.id, at: c.at, by: c.by, body: c.body })
      if (out.kind === 'added' || out.kind === 'ticked') {
        content = out.content
        plan.added.push(c)
      } else if (out.kind === 'already') plan.already.push(c)
      else plan.refused.push({ id: c.id, why: out.why })
    }
    if (content !== file.content) plan.changes.push({ path, content })
  }
  return plan
}
