import { useState } from 'react'
import { useOverlay } from '../app/browserHistory'
import type { WaitingComment } from '../comments/outbox'
import { Confirm } from '../screens/Confirm'

/**
 * The comments and ticks the phone could not send, in the dot's sheet: each with its words, its page, why,
 * Copy (the words, to keep them) and Discard (it asks first: they cannot come back). They stay until Discard, so a
 * write is never lost without a word, also when its page is gone and no page shows it. The sheet is its own chunk.
 */
export const WHY_NOT_SENT: Record<NonNullable<WaitingComment['refused']>, string> = {
  gone: 'Its page is gone (deleted or moved on the Mac).',
  // The page was copied on the Mac, its `id` with it: the phone cannot tell which one is it.
  copies: 'Its page has a copy with the same ID.',
  changed: 'The task changed on the Mac.',
  foreign: 'The page uses "comments" for something else.',
  invalid: "The page's properties do not read correctly.",
  layout: "The phone can't add it without changing the page's properties.",
  'too-large': 'The page is too large for the phone to change.',
}

/** What the person wrote: a comment's words, the tick and its task ("Tick: Book hotel"; YAZ-5618 a cell's task too, `|col|path|[ ] words`), or a page setting (YAZ-5568). */
export const notSentWords = (c: WaitingComment): string =>
  c.setting !== undefined ? settingWords(c.setting) : c.task === undefined ? c.body : `${c.task.checked ? 'Tick' : 'Untick'}: ${c.task.core.replace(/^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+|\|\d+\|[\d.]+\|)\[ \] ?/, '')}`

/** A setting's row and what it becomes: "Folding on this page: Off", YAZ-5592 "This vault on mobile, Sticky headings: Off", YAZ-5658 "Wide tables on this page: Fit Screen". */
function settingWords(s: NonNullable<WaitingComment['setting']>): string {
  // YAZ-5658: Wide tables is a choice, not On / Off.
  const wide = s.key === 'fitTables' || s.key === 'fit-tables'
  const to = wide ? (s.on === null ? 'Mobile Vault Default' : s.on ? 'Fit Screen' : 'Same as Desktop') : s.on ? 'On' : 'Off'
  if ('file' in s) return `This vault on mobile, ${wide ? 'Wide tables' : s.key === 'folding' ? 'Folding' : 'Sticky headings'}: ${to}`
  return `${wide ? 'Wide tables' : s.key === 'sticky-headings' ? 'Sticky headings' : 'Folding'} on this page: ${to}`
}

const pageName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

export function NotSentRows({ items, onDiscard }: { items: readonly WaitingComment[]; onDiscard: (id: string) => Promise<unknown> }) {
  if (items.length === 0) return null
  return (
    <>
      <p>The phone could not send {items.length === 1 ? 'this' : 'these'}. Nothing was changed. Copy the words to keep them, then Discard.</p>
      <ul className="rows">
        {items.map((c) => (
          <NotSentRow key={c.id} item={c} onDiscard={() => onDiscard(c.id)} />
        ))}
      </ul>
    </>
  )
}

function NotSentRow({ item, onDiscard }: { item: WaitingComment; onDiscard: () => Promise<unknown> }) {
  const [copied, setCopied] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const words = notSentWords(item)
  // Sweep3 N-4: the ask is an overlay of the app's one stack: a Back closes the ask only, not the sheet.
  useOverlay(asking, () => setAsking(false))
  const copy = () =>
    void navigator.clipboard?.writeText(words).then(
      () => setCopied(true),
      () => {},
    )
  return (
    <li className="row not-sent">
      <span className="row__main">
        {words}
        <br />
        <span className="muted">
          {pageName(item.path)} · {item.setting !== undefined && 'file' in item.setting && item.refused === 'invalid' ? 'The file does not read correctly. Fix it on the Mac.' : WHY_NOT_SENT[item.refused ?? 'gone']}
        </span>
      </span>
      {asking ? (
        <div className="discard-answer__ask">
          <Confirm
            question={`Discard "${words}"? It cannot be taken back.`}
            yes="Discard"
            busy={busy}
            onNo={() => setAsking(false)}
            onYes={() => {
              setBusy(true)
              void onDiscard().finally(() => setBusy(false))
            }}
          />
        </div>
      ) : (
        <>
          <button type="button" className="btn" aria-label={`Copy the words: ${words}`} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn discard-answer" aria-label={`Discard: ${words}`} onClick={() => setAsking(true)}>
            Discard
          </button>
        </>
      )}
    </li>
  )
}
