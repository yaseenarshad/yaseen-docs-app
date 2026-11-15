import { useEffect, useRef, useState } from 'react'
import { mentionSnippets, type MentionSnippet } from '@client/links/backlinks'
import { pathTitles } from '@client/lib/pathTitles'
import type { IndexRecord } from '@shared/types'
import { openLink, type LinkDoor } from './openLink'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'
import { linkedFromOf } from './linkedFromOf'
import { resolveSourceOf } from './pageLook'
import './linkedMentions.css'

/**
 * THE END OF A PAGE (YAZ-5455, YAZ-5535): "Linked mentions (N)", the pages that link to this one, as the Mac shows it
 * under each page and under an Explore panel's page (`BacklinksSection.tsx`), with the Mac's own code (`backlinks.ts`:
 * `backlinksFor`, `mentionSnippets`). ONE component for both places on the phone: the full page (`PageView`) and an
 * Explore panel's page (`SheetPage`). It sits in the page's own column, so it scrolls with the page; it is never sticky.
 *
 * The Mac has no "References" section (the pages this page links to): only "Linked mentions". So the phone has none
 * either, and the panel's old sticky "N Backlinks · N References" foot is gone.
 *
 * From the phone's index: each record's `links` and `embeds` (the Mac's `indexRecord`, which the sync's index step
 * already runs), resolved by the reader's resolver. ONE pass over the vault builds the reverse map, cached per resolver,
 * so per version of the vault's data (`mentionsMap`'s WeakMap): every page opened after that reads it.
 *
 * As the Mac: collapsed, with the count on the header; a tap drops it open in place; nobody links here → nothing at all;
 * a linking page is listed once, path-sorted, never the page itself; its lines (each mention highlighted) are read from
 * the phone's storage only when the section opens. A tap on a page or a line goes through the link `door`: on the full
 * page as the vault says (an Explore panel when it says explore), in a panel another panel on top.
 *
 * The phone's difference: a FOLDER that links here (its `.folder.md`) is not listed: the phone has no folder page to open.
 */
export function LinkedMentions({ path, data, store, door }: { path: string; data: VaultData; store: VaultStore; door: LinkDoor }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(LINKED_MENTIONS_PAGE)
  const entries = linkedFromOf(path, data)
  if (entries.length === 0) return null
  const more = moreStep(shown, entries.length)
  const toggle = () => {
    setShown(LINKED_MENTIONS_PAGE)
    setOpen((o) => !o)
  }
  return (
    <section className="linked-mentions" aria-label="Linked mentions">
      <button type="button" className="linked-mentions__header" aria-expanded={open} onClick={toggle}>
        <svg className="linked-mentions__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="linked-mentions__title">
          Linked mentions <span className="linked-mentions__count">({entries.length})</span>
        </span>
      </button>
      {open && (
        <ul className="linked-mentions__list">
          {entries.slice(0, shown).map((record) => (
            <Entry key={record.path} record={record} target={path} data={data} store={store} door={door} />
          ))}
        </ul>
      )}
      {open && more !== null && (
        <button type="button" className="linked-mentions__more" onClick={() => setShown((n) => n + more.count)}>
          {more.label}
        </button>
      )}
    </section>
  )
}

/**
 * S4 (sweep1): a page 1,301 pages link to drew 3,904 elements, and read 1,301 files, in one go when the section
 * opened. It draws this many pages, then "Show 100 more" or "Show all N" (`moreStep`; each reads its file only when drawn).
 */
export const LINKED_MENTIONS_PAGE = 20

/** YAZ-5521 (sweep2 nit 1): after the first 20, "Show more" draws 100 at a time (1,301 took 65 taps of 20). */
export const LINKED_MENTIONS_MORE = 100

/** The "Show more" of `shown` of `total`: all that is left when 100 or fewer ("Show all 47"), else 100. Null: all shown. */
export function moreStep(shown: number, total: number): { count: number; label: string } | null {
  const left = total - shown
  if (left <= 0) return null
  return left <= LINKED_MENTIONS_MORE ? { count: left, label: `Show all ${total}` } : { count: LINKED_MENTIONS_MORE, label: `Show ${LINKED_MENTIONS_MORE} more` }
}

function Entry({ record, target, data, store, door }: { record: IndexRecord; target: string; data: VaultData; store: VaultStore; door: LinkDoor }) {
  /** null: the read runs; []: none to show (or the file is not on the phone). */
  const [lines, setLines] = useState<MentionSnippet[] | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  useEffect(() => {
    let live = true
    setLines(null)
    void store.read(data.vault, record.path).then(
      (file) => {
        if (!live) return
        const now = dataRef.current
        const resolve = resolveSourceOf(now).resolve ?? (() => null)
        const text = file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
        setLines(text === null ? [] : mentionSnippets(text, target, resolve, pathTitles(now.records, now.folders)))
      },
      () => live && setLines([]),
    )
    return () => {
      live = false
    }
  }, [store, data.vault, record.path, record.mtime, target])
  const open = () => openLink(door, { kind: 'page', path: record.path })
  const title = record.title.trim() !== '' ? record.title : record.basename
  return (
    <li className="linked-mentions__entry">
      <button type="button" className="linked-mentions__page" onClick={open}>
        {title}
      </button>
      {lines === null ? (
        <div className="linked-mentions__wait" aria-hidden="true" />
      ) : (
        lines.map((line, i) => (
          <button key={i} type="button" className="linked-mentions__line" aria-label={`${title}: ${line.text}`} onClick={open}>
            {runs(line)}
          </button>
        ))
      )}
    </li>
  )
}

/** A line with each mention of this page marked (the Mac's `snippetRuns`). */
function runs(line: MentionSnippet): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let at = 0
  line.ranges.forEach(({ from, to }, i) => {
    if (from > at) out.push(line.text.slice(at, from))
    out.push(
      <mark key={i} className="linked-mentions__match">
        {line.text.slice(from, to)}
      </mark>,
    )
    at = to
  })
  if (at < line.text.length) out.push(line.text.slice(at))
  return out
}

/** For the speed test: the reverse map of `data`, built once (the first page that asks pays for it). */
export const linkedMentionsCount = (data: VaultData, path: string): number => linkedFromOf(path, data).length

