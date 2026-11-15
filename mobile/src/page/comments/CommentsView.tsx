import { useLayoutEffect, useRef, useState } from 'react'
import { threadsOf, type CommentsShape as CommentShape, type PageComment } from '@shared/comments'
import type { CommentsPort } from '../../comments/bridge'
import type { WaitingComment } from '../../comments/outbox'
import { REFUSED_WORDS } from '../../comments/write'
import './comments.css'

/** The pre-fills beside the box (YAZ-5478: a tap fills the box; Comment sends). Yaseen: "just that one for right now". */
export const QUICK_REPLIES = ['Approved'] as const

const NOT_SENT: Record<NonNullable<WaitingComment['refused']>, string> = {
  ...REFUSED_WORDS,
  gone: 'This page is no longer in the vault (it was moved or deleted), so your comment was not added.',
  'too-large': 'This page is too large for the phone to change, so your comment was not added. Comment on the Mac.',
  // A check box tick's refusal (YAZ-5494); ticks are not shown here (`taskTicks.ts` says it).
  changed: 'This page changed, so your comment was not added.',
}

export interface CommentsViewProps {
  path: string
  /** The page's comments, as its stored text holds them. */
  comments: readonly PageComment[]
  shape: CommentShape
  /** The comment list of the open vault; null while the engine loads (Comment waits). */
  port: CommentsPort | null
  /** The `by` of a new comment (the vault's GitHub login, through the people file). */
  signer: () => Promise<string | undefined>
  /** A handle as the vault's people file names it. */
  nameOf: (handle: string | undefined) => string
  /** Bumped when the comment list changes (the port's `subscribe`). */
  version: number
  /** YAZ-5477: what the file is called in the words of a refusal: "page" (the default), or "card file". */
  noun?: string
}

/**
 * S10: `words` put in `draft` at `at` (the cursor), spaced from the words around it; an empty box is the words alone.
 * A box that already says them (a second tap) stays as it is. Nothing typed is ever taken away.
 */
export function withWords(draft: string, words: string, at: number): { text: string; caret: number } {
  if (draft.trim() === '') return { text: words, caret: words.length }
  const said = new RegExp(`(^|\\s)${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s.,;:!?])`)
  if (said.test(draft)) return { text: draft, caret: Math.min(Math.max(at, 0), draft.length) }
  const cut = Math.min(Math.max(at, 0), draft.length)
  const before = draft.slice(0, cut)
  const after = draft.slice(cut)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const tail = after === '' || /^\s/.test(after) ? '' : ' '
  const text = `${before}${lead}${words}${tail}${after}`
  return { text, caret: before.length + lead.length + words.length }
}

/** The words of a refusal, with the file called by its noun (YAZ-5477: "This card file is no longer in the vault"). */
const named = (words: string, noun: string): string => (noun === 'page' ? words : words.replace(/\bpage\b/g, noun))

const when = (at: string): string => {
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

/** The open comments of a list: each open thread, and each of its open replies (the count beside "Comments"). */
export const openCount = (comments: readonly PageComment[]): number =>
  threadsOf(comments)
    .filter((t) => t.comment.resolved === undefined)
    .reduce((n, t) => n + 1 + t.replies.filter((r) => r.resolved === undefined).length, 0)

/**
 * YAZ-5461: a page's comments on the phone, read only, as the Mac's comment block shows them (`client/src/comments/
 * CommentsSection.tsx`): each thread in time order with its number (`#3`), who, when and the words; its replies one
 * level in (`#3.1`); a resolved thread folded into "N resolved" at the bottom (the Mac's default place), a resolved
 * reply dimmed. Reply, Edit and Resolve stay on the Mac for now.
 *
 * YAZ-5478: the one write is INLINE, at the end of the comments (the end of the page or card file), always there: a
 * quiet one-line field, "Add a comment…", that grows when it takes the focus, so the comments stay in view above it
 * while the person types. "Approved" beside it is a PRE-FILL: a tap puts the word in the box (at the cursor, after
 * words already typed: S10) and focuses it; Comment
 * sends, and is off while the box is empty. No floating button, no one-tap send. The comment shows at once, "Waiting
 * to send" until GitHub holds it.
 */
export function CommentsView({ path, comments, shape, port, signer, nameOf, version, noun = 'page' }: CommentsViewProps) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const refused = shape === 'foreign' || shape === 'invalid' ? named(REFUSED_WORDS[shape], noun) : null
  void version
  const held = new Set(comments.map((c) => c.id))
  // A check box tick (YAZ-5494) waits in the same list, but it is no comment.
  const pending = (port?.waiting(path) ?? []).filter((c) => !held.has(c.id) && c.task === undefined)

  const onFocus = () => {
    setFocused(true)
    // The writer's chunk loads now, while the person types (first use).
    void port?.ready().catch(() => {})
  }

  // S10 (sweep1): "Approved" over words already typed wiped them (`setDraft(words)`), with no Undo. Now an empty box
  // takes the word; a box with words keeps them and takes it at the cursor (`withWords`), the cursor after it.
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null || box.current === null) return
    box.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const prefill = (words: string) => {
    const el = box.current
    const at = el !== null && document.activeElement === el ? el.selectionEnd : draft.length
    const next = withWords(draft, words, at)
    setDraft(next.text)
    caret.current = next.caret
    setProblem(null)
    el?.focus()
  }

  const post = async () => {
    const body = draft
    if (port === null || body.trim() === '' || busy) return
    if (refused !== null) return setProblem(refused)
    setBusy(true)
    try {
      const by = await signer()
      await port.add({ path, body, by, holdMs: 0 })
      setDraft('')
      setProblem(null)
      box.current?.blur()
    } catch {
      setProblem('The phone could not keep your comment. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const threads = threadsOf(comments)
  const openThreads = threads.filter((t) => t.comment.resolved === undefined)
  const done = threads.filter((t) => t.comment.resolved !== undefined)
  const count = openCount(comments) + pending.filter((c) => c.refused === undefined).length
  const grown = focused || draft !== ''

  return (
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
              {named(NOT_SENT[c.refused], noun)}{' '}
              <button type="button" className="link-btn" onClick={() => void port?.discard(c.id)}>
                Discard
              </button>
            </p>
          )}
        </article>
      ))}
      {done.length > 0 && <Resolved threads={done} nameOf={nameOf} />}
      <div className={grown ? 'page-comments__new page-comments__new--open' : 'page-comments__new'} role="group" aria-label="New comment">
        <textarea
          ref={box}
          className="page-comments__box"
          aria-label="Add a comment"
          placeholder="Add a comment…"
          rows={grown ? 3 : 1}
          value={draft}
          onFocus={onFocus}
          onBlur={() => setFocused(false)}
          onChange={(e) => setDraft(e.target.value)}
        />
        {problem !== null && (
          <p className="page-comments__problem" role="alert">
            {problem}
          </p>
        )}
        <div className="page-comments__actions">
          {QUICK_REPLIES.map((reply) => (
            // A pre-fill: the mouse-down does not take the focus from the box, so the box stays open.
            <button key={reply} type="button" className="page-comments__chip" aria-label={`Fill in "${reply}"`} onMouseDown={(e) => e.preventDefault()} onClick={() => prefill(reply)}>
              {reply}
            </button>
          ))}
          <button type="button" className="btn page-comments__send" disabled={draft.trim() === '' || port === null || busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void post()}>
            Comment
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * YAZ-5478: the small comment count near the title (a speech bubble and the number of open comments). A tap glides to
 * the comments at the end of the page (at once with Reduce Motion). None while the file has no comment: the box at
 * the end is there anyway, and none when every comment is resolved. It sits in the column, never floats.
 */
export function CommentsCount({ comments }: { comments: readonly PageComment[] }) {
  const n = openCount(comments)
  if (n === 0) return null
  const go = (e: React.MouseEvent<HTMLButtonElement>) => {
    const section = e.currentTarget.closest('article')?.querySelector<HTMLElement>('.page-comments')
    if (section == null) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  }
  const words = `${n} ${n === 1 ? 'comment' : 'comments'}`
  return (
    <button type="button" className="comments-count" aria-label={`${words}. Go to the comments`} onClick={go}>
      <svg className="comments-count__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 11.5H7l-3.2 2.6a.4.4 0 0 1-.65-.3V11.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span>{n}</span>
    </button>
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
