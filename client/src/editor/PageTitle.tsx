/**
 * THE PAGE TITLE (⚡ YAZ-888) — block ZERO of the note's own scroller, above `.editor-mount`.
 *
 * It shows the page's TITLE (YAZ-2420 🔒 D14, `pageLabel`) and edits it (🔒 D16): the name on
 * disk is built from the title, never typed. It is React-side chrome and never a ProseMirror
 * node — the note's markdown round-trips byte-identically past it, and an in-document
 * `# Heading` is a block of the note like any other (syncing the two is deliberately out of scope).
 *
 * Editing copies `RenameInline`'s patterns: click swaps the heading for an input prefilled with
 * the current title, and LEAVING the field commits (YAZ-1553) — click-away, Enter, ArrowDown and
 * Cmd-Tab all go through the one `onBlur` door; Escape is the only discard. ArrowDown then hands
 * focus to the editor below. The commit hands the title typed — free text — to App's ONE rename
 * door, which asks first (the name changes with it) and routes every failure to the passive
 * notice — so nothing here duplicates that.
 */
import { useRef, useState } from 'react'
import { pageLabel, usePathTitles } from '../lib/pageLabel'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

interface PageTitleProps {
  /** The open page; its title is what the field edits. */
  path: string
  /** The window's index snapshot (YAZ-2420 🔒 D14): the heading shows the page's title. Absent, its file name. */
  source?: WikilinkResolveSource
  /** Commit: the new title, straight to App's rename door (which confirms). */
  onRetitle: (title: string) => void
  /** ArrowDown out of the title: focus the editor below it. */
  onArrowDown?: () => void
  /** `dir` = a folder's title (YAZ-2290 D9). */
  kind?: 'file' | 'dir'
}

export function PageTitle({ path, source, onRetitle, onArrowDown, kind = 'file' }: PageTitleProps) {
  const title = pageLabel(path, kind === 'dir', usePathTitles(source))
  const [editing, setEditing] = useState(false)
  // ONE door (YAZ-1553): leaving the field is the commit, so `onBlur` is `leave`'s only caller.
  // `settled` flips the moment the edit is over — Chromium fires one last blur when a focused
  // field is removed, and that blur must do nothing. Same three verbs as `RenameInline`.
  const settled = useRef(false)
  const open = (): void => {
    settled.current = false
    setEditing(true)
  }
  const discard = (): void => {
    settled.current = true
    setEditing(false)
  }

  /** The one door: the title the user left behind, whichever way they left. */
  const leave = (value: string): void => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    const next = value.trim()
    // An empty/whitespace title never commits, and the same title is not an edit at all.
    if (next !== '' && next !== title) onRetitle(next)
  }

  if (editing) {
    return (
      <div className="page-title">
        {/* A textarea, not an input (YAZ-918): a long title WRAPS at the title's own size while
            edited — `field-sizing: content` grows it to the text; a title has no newlines,
            so Enter stays commit. */}
        <textarea
          autoFocus
          rows={1}
          className="page-title__input"
          defaultValue={title}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            // Enter and ArrowDown only take focus away; onBlur is the one commit door.
            // preventDefault on Enter stays load-bearing: the sheet focuses CANCEL on mount,
            // and Enter's own default activation would land on it and cancel the rename.
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              discard()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              e.currentTarget.blur()
              onArrowDown?.()
            }
          }}
          onBlur={(e) => leave(e.currentTarget.value)}
        />
      </div>
    )
  }

  return (
    <div className="page-title">
      {/* Keyboard path too (⚡ YAZ-891 polish): the heading is focusable and Enter opens the
          input, so a rename never REQUIRES the mouse. */}
      <h1
        className="page-title__text"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          open()
        }}
      >
        {title}
      </h1>
    </div>
  )
}
