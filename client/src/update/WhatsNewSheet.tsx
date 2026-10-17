/**
 * THE "WHAT'S NEW" SHEET (YAZ-2976 D5): the update pill and Help › What's New… (D8) open this one
 * sheet. It shows the GitHub release notes that main fetches live — each release newer than the
 * running app with an update (S14), the last few without one (S15) — and the button for the state.
 * A lazy chunk: App imports it with `React.lazy`, so launch never parses it.
 *
 * The notes are Markdown with GIFs and pictures. They go through `commentHtml`, the app's one
 * Markdown → HTML door (`marked` + DOMPurify), and wear the comments' Markdown look
 * (`.comments__body`), so a release reads like a comment and nothing here can run.
 *  - S16: each `<img>` gets `loading="lazy"` BEFORE it is in the document. The HTML is built in an
 *    inert `<template>`, where no image loads; an attribute set after insertion could be too late.
 *  - S17: a link click opens through `window.open`. Main's window-open policy sends an http(s)
 *    URL to the browser and denies the rest, so a link never navigates the app window.
 *  - S18: a failed read says so, and the buttons still work: a staged update does not need its notes.
 *
 * The keys are the overlay's, never `window`'s (the SettingsDialog rule, YAZ-888): Esc closes, and
 * a click on the backdrop closes (S19). The first button has the focus on open, and the element
 * that had it before (the pill, or the editor under the menu) gets it back on close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { ReleaseNote, UpdateState } from '@shared/types'
import { api } from '../api'
import { commentHtml } from '../comments/markdown'
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

/** The action button for the state (S14, S13): main decides what it does — the swap, or the release page. */
const ACTION: Partial<Record<UpdateState['kind'], string>> = { ready: 'Restart to update', manual: 'Download' }

export default function WhatsNewSheet({ update, onClose }: WhatsNewSheetProps) {
  const [notes, setNotes] = useState<ReleaseNote[] | 'loading' | 'failed'>('loading')
  const firstButton = useRef<HTMLButtonElement>(null)

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

  const html = useMemo(() => (Array.isArray(notes) ? notes.map((note) => noteHtml(note.body)) : []), [notes])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  const onNotesClick = (e: ReactMouseEvent): void => {
    const link = e.target instanceof Element ? e.target.closest('a') : null
    if (link === null) return
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
        <div className="whats-new__notes" aria-busy={notes === 'loading'} onClick={onNotesClick}>
          {notes === 'loading' && <p className="whats-new__msg">Loading…</p>}
          {notes === 'failed' && <p className="whats-new__msg">Can't load the notes. Check your connection.</p>}
          {Array.isArray(notes) && notes.length === 0 && <p className="whats-new__msg">No release notes.</p>}
          {Array.isArray(notes) &&
            notes.map((note, i) => (
              <section key={note.version} className="whats-new__release">
                <h3 className="whats-new__release-title">{note.title.trim() === '' ? note.version : note.title}</h3>
                <p className="whats-new__meta">{[note.version, shortDate(note.date)].filter((part) => part !== '').join(' · ')}</p>
                {/* Sanitised HTML from `commentHtml`: Markdown in, document markup out, nothing that can run. */}
                <div className="comments__body whats-new__body" dangerouslySetInnerHTML={{ __html: html[i] }} />
              </section>
            ))}
        </div>
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
      </div>
    </div>
  )
}
