/**
 * THE PAGE TITLE (⚡ YAZ-888) — block ZERO of the note's own scroller, above `.editor-mount`.
 *
 * It SHOWS the page's title (YAZ-2420 🔒 D14, `pageLabel`); the field it edits is still the file
 * name. It is React-side chrome and never a ProseMirror node — the note's markdown round-trips
 * byte-identically past it, and an in-document `# Heading` is a block of the note like any other
 * (syncing the two is deliberately out of scope).
 *
 * Editing copies `RenameInline`'s patterns, because a title edit IS a rename: click swaps the
 * heading for an input prefilled with the current name, and LEAVING the field commits
 * (YAZ-1553) — click-away, Enter, ArrowDown and Cmd-Tab all go through the one `onBlur` door;
 * Escape is the only discard. ArrowDown then hands focus to the editor below. The commit builds
 * the new path with the sidebar's own `renamedPath` and hands it to App's ONE rename door, which
 * asks first (the name changed) and routes every failure to the passive notice — so nothing
 * here duplicates that.
 */
import { useRef, useState } from 'react'
import { pageLabel, usePathTitles } from '../lib/pageLabel'
import { basename, stripExt } from '../lib/paths'
import { renamedPath, validateEntryName } from '../sidebar/createEntry'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'

interface PageTitleProps {
  /** The open note; its file name minus the extension is the name the field edits. */
  path: string
  /** The window's index snapshot (YAZ-2420 🔒 D14): the heading shows the page's title. Absent, its file name. */
  source?: WikilinkResolveSource
  /** Commit: the renamed absolute path, straight to App's rename door (which confirms). */
  onRename: (newPath: string) => void
  /** The app's passive notice — any name the sidebar's rules reject. */
  onNotice?: (message: string) => void
  /** ArrowDown out of the title: focus the editor below it. */
  onArrowDown?: () => void
  /** `dir` = a folder's title (YAZ-2290 D9): its whole name, no extension logic, and the commit renames the directory. */
  kind?: 'file' | 'dir'
}

export function PageTitle({ path, source, onRename, onNotice, onArrowDown, kind = 'file' }: PageTitleProps) {
  const titles = usePathTitles(source)
  // The rename field's prefill, a file name: how a title edit commits is YAZ-2420 3C's.
  const name = kind === 'dir' ? basename(path) : stripExt(basename(path))
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

  /** The one door: the name the user left behind, whichever way they left. */
  const leave = (value: string): void => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    const next = value.trim()
    // An empty/whitespace name never commits, and the same name is not a rename at all.
    if (next === '' || next === name) return
    const invalid = validateEntryName(next)
    if (invalid !== null) {
      onNotice?.(invalid)
      return
    }
    onRename(renamedPath(path, next, kind))
  }

  if (editing) {
    return (
      <div className="page-title">
        {/* A textarea, not an input (YAZ-918): a long name WRAPS at the title's own size while
            edited — `field-sizing: content` grows it to the text; a file name has no newlines,
            so Enter stays commit. */}
        <textarea
          autoFocus
          rows={1}
          className="page-title__input"
          defaultValue={name}
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
        {pageLabel(path, kind === 'dir', titles)}
      </h1>
    </div>
  )
}
