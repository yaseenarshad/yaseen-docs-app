/**
 * THE "WHAT'S NEW" SHEET (YAZ-2976 D5): the update pill and Help › What's New… (D8) open this one
 * sheet. It fills about 94% of the window (YAZ-2988 D9). The left column lists every published
 * release that main fetches live, newest first (D13); the right pane shows the notes of the selected
 * one; the buttons below are the state's.
 * A lazy chunk: App imports it with `React.lazy`, so launch never parses it.
 *
 * THE LIST (D10). Two tags only: **Latest** on the newest release, **Your current version** on the
 * running app's (`current`, which main sends with the list: the renderer has no other way to know it).
 * Up to date, one row has both. A thin divider above and below the current row shows where the user
 * is: every row above it is newer. The list is a listbox: ↑ and ↓ move the selection when it has the
 * focus, and a click selects. Which release it opens on (D11): with an update waiting (`ready`,
 * `manual`) the latest, so the user sees what is coming; otherwise the current version, else the latest.
 *
 * The notes are Markdown with GIFs and pictures. They go through `commentHtml`, the app's one
 * Markdown → HTML door (`marked` + DOMPurify), and wear the comments' Markdown look
 * (`.comments__body`), so a release reads like a comment and nothing here can run. ONLY the selected
 * release is built and in the document, never all of them (up to 100 bodies).
 *  - S16: each `<img>` gets `loading="lazy"` BEFORE it is in the document. The HTML is built in an
 *    inert `<template>`, where no image loads; an attribute set after insertion could be too late.
 *  - D12: a click on a picture or a GIF opens the editor's lightbox (`ImageModal`) with every picture
 *    of that release, in order, at the one clicked. A picture inside a link opens the lightbox too.
 *  - S17: a link click opens through `window.open`. Main's window-open policy sends an http(s)
 *    URL to the browser and denies the rest, so a link never navigates the app window.
 *  - S18: a failed read says so, and the buttons still work: a staged update does not need its notes.
 *
 * The keys are the overlay's, never `window`'s (the SettingsDialog rule, YAZ-888): Esc closes, and
 * a click on the backdrop closes (S19). The lightbox is rendered INSIDE the sheet, so Esc is layered:
 * the lightbox's own key handler stops Esc, which closes only the lightbox, and the sheet's
 * `mousedown` guard keeps a click on the lightbox's backdrop from closing the sheet. The first button
 * has the focus on open, and the element that had it before (the pill, or the editor under the menu)
 * gets it back on close.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { ReleaseNote, ReleaseNotes, UpdateState } from '@shared/types'
import { api } from '../api'
import { commentHtml } from '../comments/markdown'
import { ImageModal } from '../editor/image/ImageModal'
import type { GalleryImage } from '../editor/image/imageOptions'
import './whatsNewSheet.css'

interface WhatsNewSheetProps {
  update: UpdateState
  onClose: () => void
}

/** A release's body as sanitised HTML whose images load only when they scroll into view (S16). */
function noteHtml(body: string): string {
  const template = document.createElement('template')
  template.innerHTML = commentHtml(body)
  for (const img of template.content.querySelectorAll('img')) img.setAttribute('loading', 'lazy')
  return template.innerHTML
}

/** "Oct 17, 2026"; an unreadable date shows nothing. */
function shortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** The title without the version it starts with: the releases are named "v1.0.12 — Tab Names", and the row already says 1.0.12. */
function bareTitle(note: ReleaseNote): string {
  const title = note.title.trim()
  for (const lead of [`v${note.version}`, note.version]) if (title.startsWith(lead)) return title.slice(lead.length).replace(/^[\s—–:-]+/, '')
  return title
}

/** D11: an update waiting opens on what it brings (the latest); anything else on the user's own version, else the latest. */
function defaultVersion(update: UpdateState, notes: ReleaseNotes): string | undefined {
  const latest = notes.releases[0]?.version
  if (update.kind === 'ready' || update.kind === 'manual') return latest
  return notes.releases.some((r) => r.version === notes.current) ? notes.current : latest
}

/** The action button for the state (S14, S13): main decides what it does — the swap, or the release page. */
const ACTION: Partial<Record<UpdateState['kind'], string>> = { ready: 'Restart to update', manual: 'Download' }

export default function WhatsNewSheet({ update, onClose }: WhatsNewSheetProps) {
  const [notes, setNotes] = useState<ReleaseNotes | 'loading' | 'failed'>('loading')
  /** The row the user picked; until then the default of D11, which follows the state. */
  const [picked, setPicked] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ images: GalleryImage[]; index: number } | null>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const ids = useId()

  useEffect(() => {
    let live = true
    api.update.notes().then(
      (got) => live && setNotes(got),
      () => live && setNotes('failed'),
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const previous = document.activeElement
    firstButton.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  const releases = typeof notes === 'object' ? notes.releases : []
  const current = typeof notes === 'object' ? notes.current : null
  const want = picked ?? (typeof notes === 'object' ? defaultVersion(update, notes) : undefined)
  const index = Math.max(0, releases.findIndex((r) => r.version === want))
  const selected: ReleaseNote | undefined = releases[index]
  const html = useMemo(() => (selected === undefined ? '' : noteHtml(selected.body)), [selected])
  const optionId = (i: number): string => `${ids}-release-${i}`

  // A new selection starts at the top of its notes, and its row is in view (the current version can be far down the list).
  useEffect(() => {
    pane.current?.scrollTo?.({ top: 0 })
    document.getElementById(`${ids}-release-${index}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [ids, index])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  const onListKeyDown = (e: ReactKeyboardEvent): void => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step === 0 || releases.length === 0) return
    e.preventDefault()
    setPicked(releases[Math.min(releases.length - 1, Math.max(0, index + step))].version)
  }

  const onNotesClick = (e: ReactMouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null
    const img = target?.closest('img')
    if (img != null && pane.current !== null) {
      e.preventDefault()
      const all = [...pane.current.querySelectorAll('img')]
      setViewer({ images: all.map((i) => ({ src: i.currentSrc || i.src, alt: i.alt })), index: all.indexOf(img) })
      return
    }
    const link = target?.closest('a')
    if (link == null) return
    e.preventDefault()
    if (link.href !== '') window.open(link.href)
  }

  const action = ACTION[update.kind]
  const act = (): void => {
    void api.update.restart().catch(() => undefined)
    // "Download" hands off to the browser, so the sheet has nothing left to do; "Restart to update" quits the app.
    if (update.kind === 'manual') onClose()
  }

  return (
    <div className="whats-new-overlay" tabIndex={-1} onMouseDown={onClose} onKeyDown={onKeyDown}>
      <div className="whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="whats-new__title" id="whats-new-title">
          What's new
        </h2>
        {selected === undefined ? (
          <div className="whats-new__notes" aria-busy={notes === 'loading'}>
            {notes === 'loading' && <p className="whats-new__msg">Loading…</p>}
            {notes === 'failed' && <p className="whats-new__msg">Can't load the notes. Check your connection.</p>}
            {typeof notes === 'object' && <p className="whats-new__msg">No release notes.</p>}
          </div>
        ) : (
          <div className="whats-new__columns">
            <div className="whats-new__list" role="listbox" aria-label="Releases" tabIndex={0} aria-activedescendant={optionId(index)} onKeyDown={onListKeyDown}>
              {releases.map((note, i) => {
                const isLatest = i === 0
                const isCurrent = note.version === current
                return (
                  <div key={note.version} id={optionId(i)} role="option" aria-selected={i === index} className={`whats-new__row${isCurrent ? ' whats-new__row--current' : ''}`} onClick={() => setPicked(note.version)}>
                    <span className="whats-new__row-head">
                      <span className="whats-new__row-version">{note.version}</span>
                      <span className="whats-new__row-date">{shortDate(note.date)}</span>
                    </span>
                    {bareTitle(note) !== '' && <span className="whats-new__row-title">{bareTitle(note)}</span>}
                    {(isLatest || isCurrent) && (
                      <span className="whats-new__tags">
                        {isLatest && <span className="whats-new__tag whats-new__tag--latest">Latest</span>}
                        {isCurrent && <span className="whats-new__tag whats-new__tag--current">Your current version</span>}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div ref={pane} className="whats-new__notes" onClick={onNotesClick}>
              <section key={selected.version} className="whats-new__release">
                <h3 className="whats-new__release-title">{bareTitle(selected) || selected.version}</h3>
                <p className="whats-new__meta">{[selected.version, shortDate(selected.date)].filter((part) => part !== '').join(' · ')}</p>
                {/* Sanitised HTML from `commentHtml`: Markdown in, document markup out, nothing that can run. */}
                <div className="comments__body whats-new__body" dangerouslySetInnerHTML={{ __html: html }} />
              </section>
            </div>
          </div>
        )}
        <div className="whats-new__actions">
          <button ref={firstButton} type="button" className="confirm__btn" onClick={onClose}>
            {action === undefined ? 'Close' : 'Later'}
          </button>
          {action !== undefined && (
            <button type="button" className="confirm__btn btn--primary" onClick={act}>
              {action}
            </button>
          )}
        </div>
        {/* Inside `.whats-new`, whose mousedown guard keeps the lightbox's backdrop click from closing the sheet (D12). */}
        {viewer !== null && <ImageModal images={viewer.images} index={viewer.index} onClose={() => setViewer(null)} />}
      </div>
    </div>
  )
}
