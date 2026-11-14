/**
 * THE PAGE TITLE (⚡ YAZ-888) — block ZERO of the page's own scroller, above `.editor-mount`.
 *
 * It shows the page's TITLE (YAZ-2420 🔒 D14, `pageLabel`) and edits it (🔒 D16): the name on
 * disk is built from the title, never typed. It is React-side chrome and never a ProseMirror
 * node — the page's markdown round-trips byte-identically past it, and an in-document
 * `# Heading` is a block of the page like any other (syncing the two is deliberately out of scope).
 *
 * Editing copies `RenameInline`'s patterns: click swaps the heading for an input prefilled with
 * the current title, and LEAVING the field commits (YAZ-1553) — click-away, Enter, ArrowDown and
 * Cmd-Tab all go through the one `onBlur` door; Escape is the only discard. ArrowDown then hands
 * focus to the editor below. The commit hands the title typed — free text — to App's ONE rename
 * door, which asks first (the name changes with it) and routes every failure to the passive
 * notice — so nothing here duplicates that.
 *
 * READ ONLY (YAZ-3076 S22; YAZ-5141, Yaseen: "if someone clicks the title it means they are trying to rename the page
 * ... the alert for read only show show so they can hit enter"): a click on the title of a page locked by Read only is
 * an edit attempt, told as the page's own guard tells one (`tellReadOnlyEdit`): the pane's "Read only" chip shows the
 * same card, "This page is Read only. Press Enter to allow edits.", and Enter opens its "Allow edits?" box. The title
 * takes the keyboard (not a tab stop), so that Enter is heard. Once a choice unlocks the page, the title opens its
 * field at once: the rename the click meant (the attempt's `resume`, YAZ-5145 round 2). Cancel opens nothing.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { tellReadOnlyEdit, type ReadOnlyWhat } from './readOnlyEdit'

interface PageTitleProps {
  /** The open page; its title is what the field edits. */
  path: string
  /** The window's titles (YAZ-2420 🔒 D14): the heading shows the page's title. */
  titles: PathTitles
  /** Commit: the new title, straight to App's rename door (which confirms). */
  onRetitle: (title: string) => void
  /** ArrowDown out of the title: focus the editor below it. */
  onArrowDown?: () => void
  /** `dir` = a folder's title (YAZ-2290 D9). */
  kind?: 'file' | 'dir'
  /**
   * The page is read only (YAZ-3076 D2, S22): the heading does not open the field, and a field that
   * is open when the switch turns on is put down unchanged. The sidebar still renames the file.
   */
  readOnly?: boolean
  /**
   * Read only by the Read only switch (the page's, the vault's), not only for want of a rename door (YAZ-5141): a click
   * on the title then shows the chip's read-only card, with Enter to allow edits; `card` for a card file's title.
   * Default: `readOnly`, as a page.
   */
  locked?: boolean | ReadOnlyWhat
  /**
   * The page's ID (YAZ-4940 "In the title"): drawn after the title, small and muted, as its own element — never part
   * of the title text, so a rename and a copy of the title never take it. A click copies it. Absent: nothing drawn.
   */
  id?: string
  /** "Copied EMB-46" after the ID's click, through the window's one passive notice. */
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType) => void
}

export function PageTitle({ path, titles, onRetitle, onArrowDown, kind = 'file', readOnly = false, locked = readOnly, id, onNotice }: PageTitleProps) {
  const title = pageLabel(path, kind === 'dir', titles)
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

  // The switch turned on mid-edit (an agent, another window): Escape's discard, never a commit.
  useEffect(() => {
    if (readOnly) discard()
  }, [readOnly])
  /**
   * A click on the locked title (YAZ-5141): an edit attempt that carries the rename it meant (YAZ-5145 round 2, the
   * read-only module's one "unlock, then continue" path): the chip runs it once the person allows edits.
   */
  const tell = (event: ReactMouseEvent<HTMLHeadingElement>): void => {
    const heading = event.currentTarget
    heading.focus({ preventScroll: true })
    tellReadOnlyEdit(heading, locked === true ? 'page' : (locked as ReadOnlyWhat), open)
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
        tabIndex={!readOnly ? 0 : locked !== false ? -1 : undefined}
        aria-readonly={readOnly || undefined}
        onClick={!readOnly ? open : locked !== false ? tell : undefined}
        onKeyDown={(e) => {
          if (readOnly || e.key !== 'Enter') return
          e.preventDefault()
          open()
        }}
      >
        {title}
      </h1>
      {id !== undefined && (
        <button
          type="button"
          className="page-title__id"
          title="Copy the ID"
          onClick={() =>
            void navigator.clipboard.writeText(id).then(
              () => onNotice?.(`Copied ${id}`, 'info', 'clipboard'),
              (error: unknown) => onNotice?.(`Can't copy the ID: ${error instanceof Error ? error.message : String(error)}`, 'error'),
            )
          }
        >
          {id}
        </button>
      )}
    </div>
  )
}
