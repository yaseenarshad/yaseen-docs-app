/**
 * The comment stream (YAZ-1472) — a Linear-style block of the note's own, INSIDE the editor's
 * scroller after the note's body, or a folder's views, and before "Linked mentions" (🔒 D4). Always
 * rendered, unlike the backlinks: the composer is the door to the first comment. Storage is the
 * note's frontmatter (`shared/comments.ts`, 🔒 D1), so this block is a VIEW over the same disk
 * truth the properties panel reads — `file.content` is CrepeHost's `disk` — with no watcher of
 * its own.
 *
 * Writes (🔒 D8): every mutation is one `transformFile(path, fresh => …)` — the change applies to
 * the FRESH bytes, lands with `expectedMtime`, retries once on conflict — and the block adopts
 * exactly the bytes that landed. The watcher then echoes the write back through the Editor's
 * `absorbFrontmatterOnly` → `setDisk`, which the snapshot below recognises as the same content.
 *
 * Shapes (`commentsShape`): a note whose `comments` is a value of the user's own, or whose block
 * does not parse, gets the header and one line saying why — no composer, nothing overwritten.
 * Threads are one level deep; an orphaned reply shows at top level (`threadsOf`).
 *
 * The shape on screen — one card per thread, the outliner's folds, the title fixed in the header
 * row — is CONTRACTS "Comments" 🔒 D12. Fold state and the header's collapse are session chrome,
 * never persisted (the backlinks' rule). A link inside a body opens through the shell like the
 * editor's own, never by navigating the app window.
 *
 * YAZ-4615: who wrote it (D6 — a picture or initials, the name, then the number), your comments
 * signed with your handle (D2), Edit only on your own, old and agent comments (D8), and Resolve
 * (D3, D5): a resolved parent takes its whole thread to a folded "Resolved" group at the bottom, a
 * resolved reply goes into a fold at the end of its thread, and a 5-second Undo row holds the place.
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addComment,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  readComments,
  readCommentsAndShape,
  setResolved,
  threadsOf,
  type CommentThread,
  type PageComment,
} from '@shared/comments'
import { cardMatches, type PeopleConfig } from '@shared/people'
import { AGENT_HANDLE, type CommentProfile, type CommentsOrder, type FileResponse } from '@shared/types'
import { api } from '../api'
import { relativeTime } from '../lib/relativeTime'
import { transformFile } from '../views/writeProperty'
import { CollapseAllIcon, ExpandAllIcon } from '../views/view/icons'
import { Avatar, type AvatarTone } from './Avatar'
import { ConfirmDeleteComment } from './ConfirmDeleteComment'
import { commentHtml, commentInlineHtml, commentSplit } from './markdown'
import { CommentPrefsContext, saveCard, usePeople } from './usePeople'
import './comments.css'

export interface CommentsSectionProps {
  /** The open note as the Editor last saw it on disk — the block's truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content'>
  /** How the stream READS (YAZ-1515): a global setting handed down as a prop, never read from storage here. */
  order: CommentsOrder
  /** The header's Oldest/Newest toggle writes the setting through this; the block holds no order of its own. */
  onChangeOrder: (order: CommentsOrder) => void
  /** The vault the note is in (YAZ-4615 D1): whose people file names the writers. Null shows handles only. */
  root?: string | null
}

interface Snapshot {
  /** The `file.content` PROP this was last derived from — the re-derive trigger, and nothing else. */
  seen: string
  /** Whole-file bytes the block believes are on disk; its own writes move this AHEAD of `seen`. */
  content: string
}

/** The one inline composer open besides the bottom one: a reply under a thread, or an edit in place of a body. */
type Inline = { kind: 'reply'; to: string } | { kind: 'edit'; id: string } | null

/** A delete waiting on the sheet: which comment, the number it wears, how many replies go with it. */
interface PendingDelete {
  id: string
  label: string | null
  replies: number
}

/** What a composer hands back: the text, and the optional one-line title. */
interface Draft {
  body: string
  title: string
}

/** Who wrote a comment, as the row shows it (D6). `none`: an old comment with no `by` — its number keeps the seat. */
interface Writer {
  kind: 'none' | 'me' | 'person' | 'agent'
  name: string
  picture: string | null
}

/** How long the "Resolved · Undo" row holds a resolved comment's place (D5). */
export const UNDO_MS = 5000

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const NOTICE = {
  foreign: "This note's comments property isn't a comment list, so nothing can be added here.",
  invalid: "The properties block doesn't parse. Fix it in Properties to comment here.",
} as const

/** A declared `by` or `title` counts only when it says something. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * D6: you by your profile (so your own row is right before the people file has your card), a
 * teammate by their card: a person, no Edit (D8). Any handle with no card is an agent — `agent` as
 * the violet "AI", one that signs with its own name (`claude`) as violet initials — and you may edit
 * it. A person's card goes in with their first comment, so a handle with no card is an agent
 * (Yaseen's pick on audit 4, after the checker's round 1).
 */
function writerOf(by: string | null, me: CommentProfile | null, people: PeopleConfig): Writer {
  if (by === null) return { kind: 'none', name: '', picture: null }
  if (me !== null && by === me.handle) return { kind: 'me', name: me.name, picture: me.picture }
  const card = by === AGENT_HANDLE ? undefined : people.people[by]
  return card === undefined ? { kind: 'agent', name: by, picture: null } : { kind: 'person', name: card.name, picture: card.picture }
}

/** The name a handle stands for, for "Resolved by …". */
const nameOf = (handle: string | undefined, me: CommentProfile | null, people: PeopleConfig): string | null => {
  const h = nonBlank(handle)
  if (h === null) return null
  return me !== null && h === me.handle ? me.name : (people.people[h]?.name ?? h)
}

const TONE: Record<Exclude<Writer['kind'], 'none'>, AvatarTone> = { me: 'me', person: 'person', agent: 'agent' }

/** `#3` for a top-level comment, `#3.1` for a reply under it; null (a dot) when either number is missing or the parent is gone. */
function labelOf(comment: PageComment, parent?: PageComment): string | null {
  if (comment.n === undefined) return null
  if (parent === undefined) return comment.reply_to === undefined ? `#${comment.n}` : null
  return parent.n === undefined ? null : `#${parent.n}.${comment.n}`
}

/**
 * What a comment shows in its header row and what sits below it. A title is the header and the
 * whole body is below. Without one, the body's first line is the header — permanently, so a fold
 * never moves text — and only the REST is below; a one-liner has nothing below and nothing to fold.
 */
function shapeOf(comment: PageComment): { title: string | null; head: string; below: string; foldable: boolean } {
  const title = nonBlank(comment.title)
  if (title !== null) return { title, head: title, below: comment.body, foldable: true }
  const { summary, rest } = commentSplit(comment.body)
  return { title: null, head: summary, below: rest, foldable: rest.trim() !== '' }
}

const isResolved = (c: PageComment): boolean => c.resolved !== undefined

const Chevron = () => (
  <svg className="comments__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m4 6 4 4 4-4" />
  </svg>
)

const Check = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)

const toggled = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function CommentsSection({ file, order, onChangeOrder, root = null }: CommentsSectionProps) {
  const { me, resolvedPlace, openProfile } = useContext(CommentPrefsContext)
  const people = usePeople(root)
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content }))
  // The file moved under us (a reload, a property write, our own write echoed back): follow it.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content })

  // Open by default only when there is something to read (🔒 E): an empty stream starts folded and the header is the door. Decided once, at mount.
  const [expanded, setExpanded] = useState(() => readComments(file.content).length > 0)
  /** Comment ids folded to one line, and parent ids whose replies are hidden — the bullet's fold, twice. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [repliesFolded, setRepliesFolded] = useState<ReadonlySet<string>>(() => new Set())
  /** D5: the Resolved group (folded at first), and each thread whose resolved replies are open. */
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const [resolvedRepliesOpen, setResolvedRepliesOpen] = useState<ReadonlySet<string>>(() => new Set())
  /** D5: the comment just resolved, whose place the Undo row holds for `UNDO_MS`. */
  const [justResolved, setJustResolved] = useState<{ id: string; label: string | null } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const [inline, setInline] = useState<Inline>(null)
  const [confirming, setConfirming] = useState<PendingDelete | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useClock()
  useEffect(() => () => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
  }, [])

  // Item 12: the comment list is read ONCE for each content, not on every render (a fold, the clock).
  const { shape, chronological } = useMemo(() => {
    const read = readCommentsAndShape(snap.content)
    return { shape: read.shape, chronological: threadsOf(read.comments) }
  }, [snap.content])
  // The model's order is by the ROOT's `at`; newest-first is that list read backwards. Replies stay oldest-first: a conversation reads down.
  const newest = order === 'newest'
  const threads = newest ? [...chronological].reverse() : chronological
  // D5: at the bottom, a resolved parent takes its whole thread to the group; in place, every thread stays where it is.
  const bottom = resolvedPlace === 'bottom'
  const done = bottom ? threads.filter((t) => isResolved(t.comment)) : []
  // The header counts what is still open: a resolved comment, and every reply of a resolved parent, is not.
  const count = threads.reduce((n, t) => (isResolved(t.comment) ? n : n + 1 + t.replies.filter((r) => !isResolved(r)).length), 0)

  // One fold-all control, the outliner's pair in one seat: while anything is open it collapses
  // everything (comments and reply groups); once everything is folded it expands everything.
  // Only what can fold counts toward "everything folded": a one-liner has nothing to fold.
  const everyId = threads.flatMap((t) => [t.comment, ...t.replies]).filter((c) => shapeOf(c).foldable).map((c) => c.id)
  const everyThreaded = threads.filter((t) => t.replies.length > 0).map((t) => t.comment.id)
  const allFolded = everyId.every((id) => folded.has(id)) && everyThreaded.every((id) => repliesFolded.has(id))
  const foldAll = (): void => {
    setFolded(allFolded ? new Set() : new Set(everyId))
    setRepliesFolded(allFolded ? new Set() : new Set(everyThreaded))
  }

  /** ONE write, whole: fresh bytes in, landed bytes adopted. Never throws to React — the line at the foot of the block says. */
  const write = async (transform: (fresh: string) => string): Promise<boolean> => {
    setSaving(true)
    try {
      const { content } = await transformFile(file.path, transform)
      setSnap((s) => ({ seen: s.seen, content }))
      setError(null)
      return true
    } catch (err) {
      setError(`Could not save the comment: ${messageOf(err)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async (draft: Draft, replyTo?: string): Promise<boolean> => {
    // D2: signed with your handle when you have a profile; the first comment in a vault puts your card in its people file (D1).
    const ok = await write((fresh) => addComment(fresh, draft.body, { id: newCommentId(), at: nowIso(), replyTo, title: draft.title, by: me?.handle }))
    // Only when the vault's card is not yours yet: no IPC read after every comment (audit 16).
    if (ok && me !== null && root !== null && !cardMatches(people.people[me.handle], me)) void saveCard(root, me)
    return ok
  }

  const clearUndo = (): void => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    undoTimer.current = null
    setJustResolved(null)
  }

  /** D3: resolve or reopen; a resolve leaves the Undo row in the comment's place (D5). */
  const toggleResolved = async (comment: PageComment, label: string | null): Promise<void> => {
    const reopen = isResolved(comment)
    const ok = await write((fresh) => setResolved(fresh, comment.id, reopen ? null : nowIso(), me?.handle))
    if (!ok) return
    if (reopen) return clearUndo()
    // In place nothing moves, so there is no place to hold (audit 17).
    if (!bottom) return
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    setJustResolved({ id: comment.id, label })
    undoTimer.current = setTimeout(() => setJustResolved(null), UNDO_MS)
  }

  const undo = (id: string): void => {
    clearUndo()
    void write((fresh) => setResolved(fresh, id, null))
  }

  /** The header's "· N resolved": opens the group and brings it into view. */
  const showResolved = (): void => {
    setExpanded(true)
    setResolvedOpen(true)
    requestAnimationFrame(() => groupRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  const closeInline = (): void => {
    setInline(null)
    setError(null)
  }

  const item = (comment: PageComment, parent?: PageComment, onReply?: () => void, replies = 0) => {
    const writer = writerOf(nonBlank(comment.by), me, people)
    const label = labelOf(comment, parent)
    return (
      <CommentItem
        key={comment.id}
        comment={comment}
        label={label}
        writer={writer}
        resolvedBy={nameOf(comment.resolved_by, me, people)}
        // D8: never another person's words; your own, an old one and an agent's can be edited.
        canEdit={writer.kind !== 'person'}
        now={now}
        saving={saving}
        folded={folded.has(comment.id)}
        editing={inline?.kind === 'edit' && inline.id === comment.id}
        onToggleFold={() => setFolded((s) => toggled(s, comment.id))}
        onReply={onReply}
        onToggleResolved={() => void toggleResolved(comment, label)}
        onEdit={() => {
          setFolded((s) => (s.has(comment.id) ? toggled(s, comment.id) : s))
          setInline({ kind: 'edit', id: comment.id })
        }}
        onDelete={() => setConfirming({ id: comment.id, label, replies })}
        onSave={async (draft) => {
          // Save is against the comment as it was opened: gone or changed underneath → refuse, never clobber.
          const ok = await write((fresh) => {
            const current = readComments(fresh).find((c) => c.id === comment.id)
            if (current === undefined || current.body !== comment.body || current.edited !== comment.edited) {
              throw new Error('this comment changed on disk — cancel and reopen Edit')
            }
            return editComment(fresh, comment.id, draft.body, nowIso(), draft.title)
          })
          if (ok) closeInline()
          return ok
        }}
        onCancel={closeInline}
      />
    )
  }

  const undoRow = (id: string, label: string | null) => (
    <div key={`undo-${id}`} className="comments__undo" role="status">
      <Check />
      <span>Resolved {label ?? ''}</span>
      <span aria-hidden>·</span>
      <button type="button" className="comments__undo-btn" disabled={saving} onClick={() => undo(id)}>
        Undo
      </button>
    </div>
  )

  /** One thread's card. `inGroup`: it sits in the Resolved group, so everything in it shows as it is. */
  const thread = ({ comment, replies }: CommentThread, inGroup = false) => {
    const opened = inline?.kind === 'reply' && inline.to === comment.id
    const threaded = replies.length > 0
    const hidden = repliesFolded.has(comment.id)
    // D5: a resolved reply drops into a fold at the end of its thread (at the bottom only, and not inside the group).
    const split = bottom && !inGroup
    const openReplies = split ? replies.filter((r) => !isResolved(r) || r.id === justResolved?.id) : replies
    const doneReplies = split ? replies.filter((r) => isResolved(r) && r.id !== justResolved?.id) : []
    const doneOpen = resolvedRepliesOpen.has(comment.id)
    return (
      <div key={comment.id} className={`comments__thread${!bottom && isResolved(comment) ? ' comments__thread--resolved' : ''}`}>
        {/* A thread already has its reply field; a lone comment offers Reply on hover. */}
        {item(comment, undefined, threaded ? undefined : () => setInline({ kind: 'reply', to: comment.id }), replies.length)}
        {threaded && (
          <button type="button" className="comments__replies-toggle" aria-expanded={!hidden} onClick={() => setRepliesFolded((s) => toggled(s, comment.id))}>
            <Chevron />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {threaded && !hidden && (
          <div className="comments__replies">
            {openReplies.map((reply) => (split && reply.id === justResolved?.id && isResolved(reply) ? undoRow(reply.id, justResolved.label) : item(reply, comment)))}
            {doneReplies.length > 0 && (
              <>
                <button type="button" className="comments__resolved-toggle" aria-expanded={doneOpen} onClick={() => setResolvedRepliesOpen((s) => toggled(s, comment.id))}>
                  <Chevron />
                  {doneReplies.length} resolved {doneReplies.length === 1 ? 'reply' : 'replies'}
                </button>
                {doneOpen && doneReplies.map((reply) => item(reply, comment))}
              </>
            )}
            {/* One rule (audit 19): a resolved thread takes no new reply — Reopen it first. */}
            {!isResolved(comment) && <Composer placeholder="Reply…" submitLabel="Reply" saving={saving} collapsible onSubmit={(draft) => add(draft, comment.id)} />}
          </div>
        )}
        {!threaded && opened && (
          <div className="comments__replies">
            <Composer
              placeholder="Reply…"
              submitLabel="Reply"
              saving={saving}
              onSubmit={async (draft) => {
                const ok = await add(draft, comment.id)
                if (ok) closeInline()
                return ok
              }}
              onCancel={closeInline}
            />
          </div>
        )}
      </div>
    )
  }

  /** A link in a rendered body: through the shell, the editor's way — a click must never navigate the app window. */
  const onClick = (e: React.MouseEvent<HTMLElement>): void => {
    const a = (e.target as Element).closest('.comments__body a[href]')
    if (a === null) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href === '' || href.startsWith('#')) return
    void api.shell.openLink({ href, sourcePath: file.path }).catch((err: unknown) => setError(`Could not open the link: ${messageOf(err)}`))
  }

  const listed = threads.filter((t) => !bottom || !isResolved(t.comment) || t.comment.id === justResolved?.id)

  return (
    <section className="comments" onClick={onClick}>
      <div className="comments__bar">
        <button type="button" className="comments__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          <Chevron />
          <span className="comments__title">
            Comments
            {count > 0 && <span className="comments__count"> ({count})</span>}
          </span>
        </button>
        {/* D5: "· N resolved" opens the Resolved group and scrolls to it. */}
        {done.length > 0 && (
          <button type="button" className="comments__resolved-link" onClick={showResolved}>
            · {done.length} resolved
          </button>
        )}
        {expanded && (
          <div className="comments__tools">
            {/* The order toggle (YAZ-1515): state-driven like fold-all — the label names the CURRENT order; below two threads there is nothing to reorder. */}
            {threads.length > 1 && (
              <button type="button" className="comments__tool" title={newest ? 'Show oldest first' : 'Show newest first'} onClick={() => onChangeOrder(newest ? 'oldest' : 'newest')}>
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {newest ? <path d="M8 3v10M4 9l4 4 4-4" /> : <path d="M8 13V3M4 7l4-4 4 4" />}
                </svg>
                {newest ? 'Newest first' : 'Oldest first'}
              </button>
            )}
            {(everyId.length > 0 || everyThreaded.length > 0) && (
              <button type="button" className="comments__tool" onClick={foldAll}>
                {/* Every fold-all button's chevrons (YAZ-3938 D9): down expands, up collapses. */}
                {allFolded ? <ExpandAllIcon /> : <CollapseAllIcon />}
                {allFolded ? 'Expand all' : 'Collapse all'}
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <>
          {shape === 'foreign' || shape === 'invalid' ? (
            <p className="comments__notice">{NOTICE[shape]}</p>
          ) : (
            <>
              {listed.length > 0 && (
                <div className="comments__list">
                  {listed.map((t) => (bottom && isResolved(t.comment) && justResolved !== null ? undoRow(t.comment.id, justResolved.label) : thread(t)))}
                </div>
              )}
              {/* The composer stays at the BOTTOM whichever way the list reads (YAZ-1515: Yasin's call on the demo). */}
              <Composer placeholder="Leave a comment…" submitLabel="Comment" saving={saving} onSubmit={(draft) => add(draft)} me={me} onOpenProfile={openProfile} />
              {/* D5: the Resolved group, folded until opened; under the composer, so the open stream and its box stay together. */}
              {done.length > 0 && (
                <div className="comments__resolved" ref={groupRef}>
                  <button type="button" className="comments__resolved-toggle comments__resolved-toggle--group" aria-expanded={resolvedOpen} onClick={() => setResolvedOpen((open) => !open)}>
                    <Chevron />
                    Resolved ({done.length})
                  </button>
                  {resolvedOpen && <div className="comments__list comments__list--resolved">{done.map((t) => thread(t, true))}</div>}
                </div>
              )}
            </>
          )}
          {error !== null && (
            <p className="comments__error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {confirming !== null && (
        <ConfirmDeleteComment
          label={confirming.label}
          replies={confirming.replies}
          onConfirm={() => {
            const { id } = confirming
            setConfirming(null)
            void write((fresh) => deleteComment(fresh, id))
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  )
}

/** Wall-clock for the relative stamps: a minute's resolution is all "just now" → "1 minute ago" needs. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** A stamp that will not parse is shown as written rather than as "just now". */
const parsed = (iso: string): number | null => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function CommentItem({
  comment,
  label,
  writer,
  resolvedBy,
  canEdit,
  now,
  saving,
  folded,
  editing,
  onToggleFold,
  onReply,
  onToggleResolved,
  onEdit,
  onDelete,
  onSave,
  onCancel,
}: {
  comment: PageComment
  /** `#3` / `#3.1`, or null for a dot. */
  label: string | null
  writer: Writer
  /** Who resolved it, by name; null when no resolver was recorded. */
  resolvedBy: string | null
  canEdit: boolean
  now: number
  saving: boolean
  folded: boolean
  editing: boolean
  onToggleFold: () => void
  /** Only on a top-level comment with no replies yet: a thread carries its own reply field. */
  onReply?: () => void
  onToggleResolved: () => void
  onEdit: () => void
  onDelete: () => void
  onSave: (draft: Draft) => Promise<boolean>
  onCancel: () => void
}) {
  const at = comment.at === '' ? null : parsed(comment.at)
  const edited = comment.edited === undefined ? null : parsed(comment.edited)
  const { title, head, below, foldable } = shapeOf(comment)
  const closed = foldable && folded && !editing
  const resolved = isResolved(comment)
  return (
    <article className={`comments__item${writer.kind === 'agent' ? ' comments__item--agent' : ''}${resolved ? ' comments__item--resolved' : ''}`}>
      <div className="comments__meta">
        {foldable ? (
          <button type="button" className="comments__fold" aria-expanded={!closed} aria-label={closed ? 'Expand comment' : 'Collapse comment'} onClick={onToggleFold}>
            <Chevron />
          </button>
        ) : (
          <span className="comments__fold comments__fold--none" aria-hidden />
        )}
        {writer.kind === 'none' ? (
          // An old comment with no writer: the number keeps the avatar's seat, as before (YAZ-1472 D12).
          <span className="comments__mark" title={label === null ? 'No number on this comment' : `Comment ${label}`}>
            {label ?? '·'}
          </span>
        ) : (
          // D6: the picture (or initials), the name, then the number — quiet, the way an id is worn.
          <span className="comments__writer">
            <Avatar name={writer.name} picture={writer.picture} tone={TONE[writer.kind]} />
            <span className="comments__name">{writer.name}</span>
            {/* A hand-written entry has no number until the next write (D10): a dot, as an unsigned one shows. */}
            <span className="comments__num" title={label === null ? 'No number on this comment yet' : `Comment ${label}`}>
              {label ?? '·'}
            </span>
          </span>
        )}
        {/* The header text never moves: a title, or the body's first line — the whole comment when that is all there is. */}
        {title !== null ? (
          <span className="comments__summary comments__summary--title">{head}</span>
        ) : (
          // A body's first line keeps its inline Markdown (sanitised, the same renderer as the body).
          <span className={`comments__summary${foldable ? '' : ' comments__summary--whole'}`} dangerouslySetInnerHTML={{ __html: commentInlineHtml(head) }} />
        )}
        {at !== null || comment.at !== '' ? (
          <time className="comments__when" dateTime={comment.at} title={at === null ? comment.at : new Date(at).toLocaleString()}>
            {at === null ? comment.at : relativeTime(at, now)}
          </time>
        ) : null}
        {comment.edited !== undefined && (
          <span className="comments__edited" title={edited === null ? comment.edited : `Edited ${new Date(edited).toLocaleString()}`}>
            (edited)
          </span>
        )}
        {resolved && (
          <span className="comments__resolved-by" title={parsed(comment.resolved ?? '') === null ? undefined : `Resolved ${new Date(parsed(comment.resolved ?? '') ?? 0).toLocaleString()}`}>
            <Check />
            {resolvedBy === null ? 'Resolved' : `Resolved by ${resolvedBy}`}
          </span>
        )}
        <div className="comments__actions">
          <button type="button" className="comments__action" disabled={saving} onClick={onToggleResolved}>
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          {onReply !== undefined && !resolved && (
            <button type="button" className="comments__action" onClick={onReply}>
              Reply
            </button>
          )}
          {canEdit && (
            <button type="button" className="comments__action" onClick={onEdit}>
              Edit
            </button>
          )}
          <button type="button" className="comments__action comments__action--danger" disabled={saving} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {editing ? (
        <Composer initial={{ body: comment.body, title: title ?? '' }} placeholder="Edit…" submitLabel="Save" saving={saving} onSubmit={onSave} onCancel={onCancel} />
      ) : (
        // Sanitised HTML from `commentHtml`: Markdown in, document markup out, nothing that can run.
        !closed && foldable && <div className="comments__body" dangerouslySetInnerHTML={{ __html: commentHtml(below) }} />
      )}
    </article>
  )
}

/**
 * The one composer, three seats: the bottom of the block, the bottom of a card with replies (Reply),
 * in place of a body (Edit). ⌘Enter submits, Esc cancels — or clears the draft when there is
 * nothing to cancel. The textarea grows with its text and keeps focus across a submit. The
 * optional title line appears once the composer is in use (focused, holding text, or editing). A
 * `collapsible` seat shows one placeholder line until then — Linear's "Reply…" row — and folds
 * back when it is empty and loses focus. A seat that can be cancelled was opened by a click, so
 * it takes focus. The bottom seat shows who you comment as (YAZ-4615 D7): your picture and name,
 * or a "+" that opens Settings › You.
 */
function Composer({
  placeholder,
  submitLabel,
  initial,
  saving,
  collapsible = false,
  onSubmit,
  onCancel,
  me,
  onOpenProfile,
}: {
  placeholder: string
  submitLabel: string
  /** The edit seat's starting text; absent everywhere else. */
  initial?: Draft
  saving: boolean
  collapsible?: boolean
  /** Resolves true when the text landed; the composer then clears (a seat that closes unmounts it anyway). */
  onSubmit: (draft: Draft) => Promise<boolean>
  /** Esc and the Cancel button; absent → Esc clears the draft and there is no Cancel. */
  onCancel?: () => void
  /** The bottom seat only: who you comment as. Undefined elsewhere. */
  me?: CommentProfile | null
  onOpenProfile?: () => void
}) {
  const autoFocus = onCancel !== undefined
  const [text, setText] = useState(initial?.body ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [focused, setFocused] = useState(autoFocus)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const holding = text.trim() !== '' || title.trim() !== ''
  const ready = text.trim() !== '' && !saving
  // In use: focused anywhere inside, holding text, or an edit — a collapsible seat is one line otherwise.
  const active = focused || holding || initial !== undefined
  const open = !collapsible || active

  const submit = async (): Promise<void> => {
    if (!ready) return
    if (await onSubmit({ body: text, title })) {
      setText('')
      setTitle('')
      ref.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      // The textarea owns Esc while focused, the properties panel's way: nothing else in the window hears it.
      e.preventDefault()
      e.stopPropagation()
      if (onCancel !== undefined) onCancel()
      else {
        setText('')
        setTitle('')
        if (collapsible) (e.currentTarget as HTMLElement).blur()
      }
    }
  }

  return (
    <div
      className={`comments__composer${open ? '' : ' comments__composer--collapsed'}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Focus moving to a button inside is still "in use": the click must land before anything folds.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      {active && (
        <input
          type="text"
          className="comments__title-input"
          placeholder="Title (optional)"
          aria-label="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Enter on the title line moves to the text, the way a subject line does.
            if (e.key === 'Enter' && !e.metaKey) {
              e.preventDefault()
              ref.current?.focus()
            } else onKeyDown(e)
          }}
        />
      )}
      <textarea
        ref={ref}
        className="comments__textarea"
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="comments__footer">
          {me !== undefined &&
            (me === null ? (
              <button type="button" className="comments__me comments__me--none" title="Add your name and picture" onClick={onOpenProfile}>
                <Avatar name="" picture={null} tone="me" size={18} empty />
                <span>Add your name</span>
              </button>
            ) : (
              <button type="button" className="comments__me" title="Change your name and picture" onClick={onOpenProfile}>
                <Avatar name={me.name} picture={me.picture} tone="me" size={18} />
                <span>{me.name}</span>
              </button>
            ))}
          <span className="comments__hint">⌘ Enter</span>
          {onCancel !== undefined && (
            <button type="button" className="btn comments__btn" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn--primary comments__btn" disabled={!ready} onClick={() => void submit()}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}
