import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { threadsOf, type CommentsShape as CommentShape, type PageComment } from '@shared/comments'
import type { CommentsPort } from '../../comments/bridge'
import type { WaitingComment } from '../../comments/outbox'
import { REFUSED_WORDS } from '../../comments/write'
import './comments.css'

/** How long the one-tap "Approved" waits, with its Undo, before it is sent (as Review's Undo line, about 4 s). */
export const APPROVED_UNDO_MS = 4000
/** The quick replies above the box. Yaseen: "just that one for right now". */
export const QUICK_REPLIES = ['Approved'] as const

const NOT_SENT: Record<NonNullable<WaitingComment['refused']>, string> = {
  ...REFUSED_WORDS,
  gone: 'This page is no longer in the vault (it was moved or deleted), so your comment was not added.',
  'too-large': 'This page is too large for the phone to change, so your comment was not added. Comment on the Mac.',
}

export interface CommentsViewProps {
  path: string
  /** The page's comments, as its stored text holds them. */
  comments: readonly PageComment[]
  shape: CommentShape
  /** The comment list of the open vault; null while the engine loads (the button waits). */
  port: CommentsPort | null
  /** The `by` of a new comment (the vault's GitHub login, through the people file). */
  signer: () => Promise<string | undefined>
  /** A handle as the vault's people file names it. */
  nameOf: (handle: string | undefined) => string
  /** Bumped when the comment list changes (the port's `subscribe`). */
  version: number
}

const when = (at: string): string => {
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * YAZ-5461: a page's comments on the phone, read only, as the Mac's comment block shows them (`client/src/comments/
 * CommentsSection.tsx`): each thread in time order with its number (`#3`), who, when and the words; its replies one
 * level in (`#3.1`); a resolved thread folded into "N resolved" at the bottom (the Mac's default place), a resolved
 * reply dimmed. Reply, Edit and Resolve stay on the Mac for now.
 *
 * And the one write: "Comment" floats at the bottom right of the page's scroll area (so it never covers the bar under
 * the page, the page arrows of YAZ-5449, nor the tab bar). One tap opens the box with the keyboard up; "Approved" above
 * it posts at once with a 4-second Undo (one tap: Yaseen's "boom"); a typed comment goes with Send, which waits for a
 * word. The comment shows at once, "Waiting to send" until GitHub holds it.
 */
export function CommentsView({ path, comments, shape, port, signer, nameOf, version }: CommentsViewProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** The comment that the one-tap reply posted, while its Undo runs. */
  const [undoable, setUndoable] = useState<WaitingComment | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (undoable === null) return
    const left = Math.max(0, undoable.notBefore - Date.now())
    const id = setTimeout(() => {
      setUndoable((u) => (u?.id === undoable.id ? null : u))
      setOpen(false)
    }, left)
    return () => clearTimeout(id)
  }, [undoable])

  const refused = shape === 'foreign' || shape === 'invalid' ? REFUSED_WORDS[shape] : null
  void version
  const held = new Set(comments.map((c) => c.id))
  const pending = (port?.waiting(path) ?? []).filter((c) => !held.has(c.id))

  const openBox = () => {
    // iOS raises the keyboard only for a focus in the tap itself: draw the box now, then focus it.
    flushSync(() => {
      setOpen(true)
      setProblem(null)
    })
    box.current?.focus()
    // The writer's chunk loads now, while the person types (first use).
    void port?.ready().catch(() => {})
  }

  const post = async (body: string, holdMs: number) => {
    if (port === null || body.trim() === '' || busy) return
    if (refused !== null) return setProblem(refused)
    setBusy(true)
    try {
      const by = await signer()
      const made = await port.add({ path, body, by, holdMs })
      if (holdMs > 0) setUndoable(made)
      else {
        setDraft('')
        setOpen(false)
      }
    } catch {
      setProblem('The phone could not keep your comment. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (undoable === null || port === null) return
    const gone = await port.undo(undoable.id)
    setUndoable(null)
    if (!gone) setProblem('Already sent.')
    else box.current?.focus()
  }

  const threads = threadsOf(comments)
  const openThreads = threads.filter((t) => t.comment.resolved === undefined)
  const done = threads.filter((t) => t.comment.resolved !== undefined)
  const count = openThreads.reduce((n, t) => n + 1 + t.replies.filter((r) => r.resolved === undefined).length, 0) + pending.filter((c) => c.refused === undefined).length

  return (
    <>
      {(threads.length > 0 || pending.length > 0) && (
        <section className="page-comments" aria-label="Comments">
          <h3 className="page-comments__head">
            Comments{count > 0 ? ` · ${count}` : ''}
            {done.length > 0 && <span className="page-comments__muted"> · {done.length} resolved</span>}
          </h3>
          {openThreads.map((t) => (
            <Thread key={t.comment.id} comment={t.comment} replies={t.replies} nameOf={nameOf} />
          ))}
          {pending.map((c) => (
            <article key={c.id} className={c.refused === undefined ? 'page-comments__item page-comments__item--pending' : 'page-comments__item page-comments__item--refused'}>
              <p className="page-comments__meta">
                <span className="page-comments__who">{nameOf(c.by)}</span>
                <span className="page-comments__muted"> · {c.refused === undefined ? 'Waiting to send' : 'Not sent'}</span>
              </p>
              <p className="page-comments__body">{c.body}</p>
              {c.refused !== undefined && (
                <p className="page-comments__problem" role="alert">
                  {NOT_SENT[c.refused]}{' '}
                  <button type="button" className="link-btn" onClick={() => void port?.discard(c.id)}>
                    Discard
                  </button>
                </p>
              )}
            </article>
          ))}
          {done.length > 0 && <Resolved threads={done} nameOf={nameOf} />}
        </section>
      )}
      <div className="page-comments__dock">
        {open ? (
          <div className="page-comments__composer" role="group" aria-label="New comment">
            {undoable !== null ? (
              <p className="page-comments__undo" role="status">
                <span>{undoable.body} · posting</span>
                <button type="button" className="link-btn" onClick={() => void undo()}>
                  ↶ Undo
                </button>
              </p>
            ) : (
              <div className="page-comments__chips">
                {QUICK_REPLIES.map((reply) => (
                  <button key={reply} type="button" className="page-comments__chip" disabled={port === null || busy} onClick={() => void post(reply, APPROVED_UNDO_MS)}>
                    {reply}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={box}
              className="page-comments__box"
              aria-label="Comment"
              placeholder="Write a comment"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {problem !== null && (
              <p className="page-comments__problem" role="alert">
                {problem}
              </p>
            )}
            <div className="page-comments__actions">
              <button type="button" className="link-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={draft.trim() === '' || port === null || busy || undoable !== null} onClick={() => void post(draft, 0)}>
                Send
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="page-comments__fab" disabled={port === null} onClick={openBox}>
            Comment
          </button>
        )}
      </div>
    </>
  )
}

function Item({ comment, label, nameOf, reply = false }: { comment: PageComment; label: string; nameOf: (h: string | undefined) => string; reply?: boolean }) {
  const resolved = comment.resolved !== undefined
  return (
    <article className={`page-comments__item${reply ? ' page-comments__item--reply' : ''}${resolved ? ' page-comments__item--resolved' : ''}`}>
      <p className="page-comments__meta">
        {label !== '' && <span className="page-comments__n">{label} </span>}
        <span className="page-comments__who">{nameOf(comment.by)}</span>
        {comment.at !== '' && <span className="page-comments__muted"> · {when(comment.at)}</span>}
        {resolved && <span className="page-comments__muted"> · Resolved</span>}
      </p>
      {comment.title !== undefined && <p className="page-comments__title">{comment.title}</p>}
      <p className="page-comments__body">{comment.body}</p>
    </article>
  )
}

function Thread({ comment, replies, nameOf }: { comment: PageComment; replies: PageComment[]; nameOf: (h: string | undefined) => string }) {
  const top = comment.n === undefined ? '' : `#${comment.n}`
  return (
    <div className="page-comments__thread">
      <Item comment={comment} label={top} nameOf={nameOf} />
      {replies.map((r) => (
        <Item key={r.id} comment={r} label={comment.n === undefined || r.n === undefined ? '' : `#${comment.n}.${r.n}`} nameOf={nameOf} reply />
      ))}
    </div>
  )
}

function Resolved({ threads, nameOf }: { threads: ReturnType<typeof threadsOf>; nameOf: (h: string | undefined) => string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="page-comments__resolved">
      <button type="button" className="link-btn" aria-expanded={show} onClick={() => setShow((s) => !s)}>
        {show ? '▾' : '▸'} {threads.length} resolved
      </button>
      {show && threads.map((t) => <Thread key={t.comment.id} comment={t.comment} replies={t.replies} nameOf={nameOf} />)}
    </div>
  )
}
