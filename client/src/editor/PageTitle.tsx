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
 *
 * ONE TITLE FOR BOTH KINDS OF CARD (YAZ-5164 part 3): a card file's tab shows its title here, and so does the head of a
 * card in a page (`text`: the card's title, `editor/card/cardTitle.ts`), the Inbox's head and Explore's card window. A
 * click renames it the same way everywhere; where the title is stored is the caller's.
 *
 * A TITLE THAT IS A FILE NAME (YAZ-5580, `useTitleCheck`): in a vault that does not use IDs, a character a file name
 * cannot hold shows a short message under the field as it is typed. Enter or leaving the field then keeps the field,
 * the text and the message: nothing is renamed and nothing is cleared, until the character goes. A card in a page's
 * title (`text`) is no file's name: any character goes.
 */
import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import type { NoticeKind, NoticeType } from '../lib/notice'
import { tellReadOnlyEdit, type ReadOnlyWhat } from './readOnlyEdit'
import { useTitleCheck } from '../lib/titleRule'

interface PageTitleProps {
  /** The open page; its title is what the field edits. */
  path: string
  /** The window's titles (YAZ-2420 🔒 D14): the heading shows the page's title. */
  titles: PathTitles
  /** The title itself, when it is no file's title (YAZ-5164: a card in a page's, off its card line). Absent: the path's. */
  text?: string
  /** Shown while the title is empty (a card with no title yet). */
  placeholder?: string
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

export function PageTitle({ path, titles, text, placeholder, onRetitle, onArrowDown, kind = 'file', readOnly = false, locked = readOnly, id, onNotice }: PageTitleProps) {
  const title = text ?? pageLabel(path, kind === 'dir', titles)
  const [editing, setEditing] = useState(false)
  // The message under the field (YAZ-5580): a character the file's name cannot hold, said as it is typed.
  const check = useTitleCheck(text === undefined ? path : null)
  const [problem, setProblem] = useState<string | null>(null)
  const problemId = useId()
  // ONE door (YAZ-1553): leaving the field is the commit, so `onBlur` is `leave`'s only caller.
  // `settled` flips the moment the edit is over — Chromium fires one last blur when a focused
  // field is removed, and that blur must do nothing. Same three verbs as `RenameInline`.
  const settled = useRef(false)
  const open = (): void => {
    settled.current = false
    setProblem(null)
    setEditing(true)
  }
  const discard = (): void => {
    settled.current = true
    setProblem(null)
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
    // A title its file cannot be named (YAZ-5580): the field stays, with the text and the message; nothing is renamed.
    const bad = check(value)
    if (bad !== null) {
      setProblem(bad)
      return
    }
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
          aria-invalid={problem !== null || undefined}
          aria-describedby={problem !== null ? problemId : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setProblem(check(e.currentTarget.value))}
          onKeyDown={(e) => {
            // Enter and ArrowDown only take focus away; onBlur is the one commit door.
            // preventDefault on Enter stays load-bearing: the sheet focuses CANCEL on mount,
            // and Enter's own default activation would land on it and cancel the rename.
            if (e.key === 'Enter') {
              e.preventDefault()
              // A title that cannot be saved keeps the keyboard: Enter only says so (YAZ-5580).
              const bad = check(e.currentTarget.value)
              if (bad !== null) setProblem(bad)
              else e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              discard()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const bad = check(e.currentTarget.value)
              if (bad !== null) return setProblem(bad)
              e.currentTarget.blur()
              onArrowDown?.()
            }
          }}
          onBlur={(e) => leave(e.currentTarget.value)}
        />
        {problem !== null && (
          <p id={problemId} className="title-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="page-title">
      {/* Keyboard path too (⚡ YAZ-891 polish): the heading is focusable and Enter opens the
          input, so a rename never REQUIRES the mouse. */}
      <h1
        className={`page-title__text${title === '' ? ' page-title__text--empty' : ''}`}
        tabIndex={!readOnly ? 0 : locked !== false ? -1 : undefined}
        aria-readonly={readOnly || undefined}
        onClick={!readOnly ? open : locked !== false ? tell : undefined}
        onKeyDown={(e) => {
          if (readOnly || e.key !== 'Enter') return
          e.preventDefault()
          open()
        }}
      >
        {title === '' ? placeholder : title}
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
