/**
 * A CODE FILE'S HOVER CARD (YAZ-3508; YAZ-3439 "Decision — Demo round 2"): the top of the file with its colours,
 * read only, in the note card's frame and place (`NotePreview`: the same box, header, portal and
 * `pointer-events: none`). The places, their switches and the dwell are the hover preview's own (YAZ-3403):
 * `PreviewPanel` mounts this for a `text` kind file, `key={path}`.
 *
 * LIGHT. No editor and no model: `monaco.editor.colorize` turns the first `TEXT_HEAD_LINES` lines into coloured
 * spans, with the language Monaco would give a tab of this file (`languageForPath`), in the app's Monaco theme
 * (`applyAppTheme`, light and dark), defined and set only when the appearance changes, never for each card. Its
 * own chunk, with Monaco's: the hover host starts loading it when a code row's dwell starts.
 *
 * SMALL READS. `api.readTextHead` reads at most `TEXT_HEAD_READ_BYTES` off disk, so a rest on a 5 MB file sends a
 * few KB. A file the code tab cannot open (too big, not UTF-8, a NUL) shows "Preview unavailable", as a note
 * that cannot be read does.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TEXT_HEAD_LINES } from '@shared/types'
import { api } from '../api'
import { boardFolder } from '../lib/paths'
import { useAppliedTheme } from '../lib/theme'
import { portalTarget, usePlacement, type PreviewAnchor } from '../sidebar/previewPlacement'
import { languageForPath } from './languageForPath'
import { applyAppTheme, monaco } from './monaco'
import '../sidebar/boardPreview.css'
import './codeHoverPreview.css'

/** The line a code file that cannot be read shows: the hover preview's words for every unreadable file. */
export const CODE_HOVER_UNREADABLE = 'Preview unavailable'

export interface CodeHoverPreviewProps {
  /** The vault that holds the file: the header names its folder relative to it. */
  root: string
  path: string
  /** The file's name as the tree shows it. */
  name: string
  anchor: PreviewAnchor
}

type Card = { kind: 'loading' } | { kind: 'ready'; html: string; empty: boolean } | { kind: 'gone' }

/** The appearance the cards last set Monaco's theme for. The theme is one for the page, so a card only sets a new one. */
let themedFor: 'light' | 'dark' | null = null

/** The first `TEXT_HEAD_LINES` lines of `text` as Monaco's coloured HTML (escaped by Monaco), for `path`'s language. */
export function colorizeHead(text: string, path: string): Promise<string> {
  const head = text.split('\n').slice(0, TEXT_HEAD_LINES).join('\n')
  return monaco.editor.colorize(head, languageForPath(path, monaco.languages.getLanguages()), { tabSize: 4 })
}

export default function CodeHoverPreview({ root, path, name, anchor }: CodeHoverPreviewProps) {
  const theme = useAppliedTheme()
  const placement = usePlacement(anchor, 'note')
  const [card, setCard] = useState<Card>({ kind: 'loading' })
  // The app's colours for the `mtkN` classes: the same theme a code tab sets, again on each Appearance change.
  useEffect(() => {
    if (themedFor === theme) return
    themedFor = theme
    applyAppTheme(theme)
  }, [theme])
  useEffect(() => {
    let live = true
    api
      .readTextHead(path)
      .then(async (head) => ({ html: await colorizeHead(head.text, path), empty: head.text === '' }))
      .then(
        ({ html, empty }) => {
          if (live) setCard({ kind: 'ready', html, empty })
        },
        () => {
          if (live) setCard({ kind: 'gone' })
        },
      )
    return () => {
      live = false
    }
  }, [path])
  if (placement === null) return null
  return createPortal(
    // No live region on the frame: it would read the code out on each rest. The header says which file.
    <div className="board-preview note-preview code-hover" role="group" aria-label={`Preview of ${name}`} style={placement}>
      <div className="board-preview__header" role="status">
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, path)}</span>
      </div>
      {card.kind === 'ready' && !card.empty && <pre className="code-hover__body" dangerouslySetInnerHTML={{ __html: card.html }} />}
      {card.kind === 'ready' && card.empty && (
        <div className="code-hover__body">
          <p className="editor-msg">Empty file</p>
        </div>
      )}
      {card.kind === 'gone' && (
        <div className="code-hover__body">
          <p className="editor-msg">{CODE_HOVER_UNREADABLE}</p>
        </div>
      )}
    </div>,
    portalTarget(anchor),
  )
}
