import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { canonicalPageId, isPageId, PAGE_ID_KEY } from '@shared/pageId'
import { commitSubject, MAX_STALE_HEADS } from '../answers/send'
import { GithubError } from '../github/client'
import type { VaultStore } from '../store'
import type { Change, GithubRemote } from '../sync/githubRemote'
import { INDEX_STATE, type PhoneIndex } from '../sync/phoneIndex'
import type { CommentBox, WaitingComment } from './outbox'
import { applyTask } from './taskWrite'
import { applySetting } from './settingWrite'
import { LEGACY_MOBILE_SETTINGS_PATH, MOBILE_SETTINGS_PATH, applyVaultSetting, isVaultSetting } from './mobileWrite'
import { applyComment } from './write'

export interface CommentSendOptions {
  remote: GithubRemote
  store: VaultStore
  vault: string
  box: CommentBox
  /** One sync pass that brings the stored copy to the newest head (the engine's pass inside its lane). */
  pass: () => Promise<unknown>
  /** YAZ-5596 (5): the index the sync engine holds (no read of the stored one when it is of the checkpoint's commit). */
  index?: () => PhoneIndex | null
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
 * ONE SEND of the comment list (and the check box ticks, YAZ-5494: `taskWrite.ts`, on the same path), on the answer list's path (`answers/send.ts`, YAZ-5097 decision 2): the
 * write is compare-and-swap on the branch, never a force push, never a conflict copy.
 *  1. A sync pass brings the stored copy to the newest head: the page's FRESH bytes.
 *  2. Each comment that is due goes onto its page as it is NOW (`applyComment`): the number is taken on that page,
 *     and a comment whose id the page holds already is not added again (a try whose answer was lost).
 *  3. A page that is gone from its path but found again FOR SURE (`movedTo`): the comment goes there.
 *     A page whose `comments` is not a comment list, that does not parse, or that is gone: the comment is refused,
 *     nothing is written, and it stays on the phone with its words (the page shows it with Discard; and the dot and
 *     its sheet count it until Discard).
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
  // A tick is signed by nothing: it changes one box, not the comments.
  const due = () => box.waiting().filter((c) => c.refused === undefined && (c.by !== undefined || c.task !== undefined || c.setting !== undefined) && c.notBefore <= now())
  /** Commits GitHub refused to move the branch to (`STALE_HEAD`): never in it. */
  const notLanded = new Set<string>()
  if (due().length === 0) return report
  try {
    for (;;) {
      await pass()
      await box.refresh()
      const list = due()
      if (list.length === 0) return report
      const plan = await planComments(store, vault, list, await landedTicks(remote, store, vault, list, notLanded), options.index)
      if (plan.changes.length > 0) {
        // From here GitHub may hold them: Undo can no longer take them back. One that Undo took meanwhile: plan again.
        const marked = await box.markTried(plan.added.map((c) => c.id))
        if (marked.length < plan.added.length) continue
        // Each tick knows its try's commit before the branch moves, so a lost answer can be settled later.
        const made: { sha: string | null } = { sha: null }
        const ticks = plan.added.filter((c) => c.task !== undefined).map((c) => c.id)
        try {
          report.commit = await remote.commit(plan.parent, plan.changes, commitSubject(plan.changes.map((c) => c.path)), async (sha) => {
            made.sha = sha
            if (ticks.length > 0) await box.noteCommit(ticks, { sha, parent: plan.parent })
          })
        } catch (error) {
          if (error instanceof GithubError && error.code === 'STALE_HEAD' && made.sha !== null) notLanded.add(made.sha)
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
  /** Comments whose page moved, and where to. */
  moved: { id: string; path: string }[]
}

/**
 * What finds a page again after the Mac moves it: its blob SHA (only when no other file had the same bytes, so
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
 * Where a page gone from its path is now, when that is SURE: the one path that holds its old bytes (a git
 * rename, as the sync pass pairs them, `diffTrees`), else the one page with its `id`. None: null. YAZ-5521: two or
 * more pages with its `id` (and no one path with its bytes): `{ copies: true }`, the page was copied, not deleted.
 */
function movedTo(was: WaitingComment['was'], shas: Readonly<Record<string, string>>, index: PhoneIndex | null): string | { copies: true } | null {
  if (was === undefined) return null
  if (was.sha !== undefined) {
    const same = Object.keys(shas).filter((p) => shas[p] === was.sha)
    if (same.length === 1) return same[0]!
  }
  if (was.id !== undefined && index !== null) {
    const same = Object.values(index.records).filter((r) => r.id === was.id && shas[r.path] !== undefined)
    if (same.length === 1) return same[0]!.path
    if (same.length > 1) return { copies: true }
  }
  return null
}

/**
 * The ticks whose earlier try's commit the branch holds. Its answer was lost, and the phone could not
 * know whether GitHub took it; what the page says now is not the answer, since a later change may have set the box
 * back (the Mac unticked it). So the history says, one `remote.contains` per commit (as answers ask it, `heldByBranch`;
 * one request, with no depth limit, so a busy branch far past the try still says yes). Held: the tick was done, and a
 * change after it is someone else's, so it settles with no write. Not held: the try never reached the branch, and the
 * tick goes on the fresh page as any tick.
 */
async function landedTicks(remote: GithubRemote, store: VaultStore, vault: string, list: readonly WaitingComment[], notLanded: ReadonlySet<string>): Promise<Set<string>> {
  const tried = list.filter((c) => c.task !== undefined && c.tried === true && c.commit !== undefined && !notLanded.has(c.commit.sha))
  const out = new Set<string>()
  if (tried.length === 0) return out
  const head = (await store.checkpoint(vault))?.commit
  if (head === undefined) return out
  const held = new Set<string>()
  for (const sha of new Set(tried.map((c) => c.commit!.sha))) if (await remote.contains(sha, head)) held.add(sha)
  for (const c of tried) if (held.has(c.commit!.sha)) out.add(c.id)
  return out
}

/** Step 2 and 3 on the stored copy, which the pass just brought to the head. `landed`: ticks done already (W3). */
async function planComments(store: VaultStore, vault: string, list: readonly WaitingComment[], landed: ReadonlySet<string> = new Set(), heldIndex?: () => PhoneIndex | null): Promise<CommentPlan> {
  const checkpoint = await store.checkpoint(vault)
  if (checkpoint === null) throw new Error('The phone has no full copy of the vault yet')
  const plan: CommentPlan = { parent: checkpoint.commit, changes: [], added: [], already: [], refused: [], moved: [] }
  // A page gone from its path that is found again for sure: its comments and ticks go to its new path.
  let index: PhoneIndex | null | undefined
  const byPath = new Map<string, WaitingComment[]>()
  // Comments whose page's `id` is on two or more pages now (copied on the Mac): not "gone".
  const copied = new Set<string>()
  for (const c of list) {
    let path = c.path
    if (checkpoint.shas[path] === undefined && c.was !== undefined) {
      if (index === undefined) {
        const held = heldIndex?.() ?? null
        const saved = held !== null && held.commit === checkpoint.commit ? held : await store.getState<PhoneIndex>(vault, INDEX_STATE)
        index = saved !== undefined && saved.commit === checkpoint.commit ? saved : null
      }
      const to = movedTo(c.was, checkpoint.shas, index)
      if (typeof to === 'string') {
        path = to
        plan.moved.push({ id: c.id, path })
      } else if (to?.copies === true) copied.add(c.id)
    }
    byPath.set(path, [...(byPath.get(path) ?? []), c])
  }
  for (const [path, comments] of byPath) {
    const file = checkpoint.shas[path] === undefined ? null : await store.read(vault, path)
    // YAZ-5592 / YAZ-6557: unified vault settings file (`.yaseendocs/settings.json`): no file yet is made; its bytes are text.
    if (comments.every((c) => isVaultSetting(c.setting))) {
      if (file === null && checkpoint.shas[path] !== undefined) {
        for (const c of comments) plan.refused.push({ id: c.id, why: 'too-large' })
        continue
      }
      const was = file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
      const legacyFile = path === MOBILE_SETTINGS_PATH && checkpoint.shas[LEGACY_MOBILE_SETTINGS_PATH] !== undefined ? await store.read(vault, LEGACY_MOBILE_SETTINGS_PATH) : null
      const legacy = legacyFile === null ? null : typeof legacyFile.content === 'string' ? legacyFile.content : new TextDecoder().decode(legacyFile.content)
      let next = was
      for (const c of comments) {
        const out = applyVaultSetting(next, c.setting as Parameters<typeof applyVaultSetting>[1], legacy)
        if (out.kind === 'set') {
          next = out.content
          plan.added.push(c)
        } else if (out.kind === 'already') plan.already.push(c)
        else plan.refused.push({ id: c.id, why: out.why })
      }
      if (next !== null && next !== was) plan.changes.push({ path, content: next })
      continue
    }
    if (file === null || typeof file.content !== 'string') {
      // Gone from the vault (deleted or renamed on the Mac), or over the phone's size limit (F7): the words stay here.
      const why = checkpoint.shas[path] === undefined ? 'gone' : 'too-large'
      for (const c of comments) plan.refused.push({ id: c.id, why: why === 'gone' && copied.has(c.id) ? 'copies' : why })
      continue
    }
    let content = file.content
    for (const c of comments) {
      if (landed.has(c.id)) {
        plan.already.push(c)
        continue
      }
      // A tick finds its task on the page as it is NOW, and sets its box; a task that changed is refused.
      // YAZ-5568: a page setting becomes what it says on the page as it is now (the Mac's writer, spliced).
      const out = c.task !== undefined ? applyTask(content, c.task) : c.setting !== undefined && !isVaultSetting(c.setting) ? applySetting(content, c.setting) : applyComment(content, { id: c.id, at: c.at, by: c.by, body: c.body })
      if (out.kind === 'added' || out.kind === 'ticked' || out.kind === 'set') {
        content = out.content
        plan.added.push(c)
      } else if (out.kind === 'already') plan.already.push(c)
      else plan.refused.push({ id: c.id, why: out.why })
    }
    if (content !== file.content) plan.changes.push({ path, content })
  }
  return plan
}
