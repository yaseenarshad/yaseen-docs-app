/**
 * Live spacing previews in Settings (YAZ-5050 round 2, Yaseen: "its annoying to have to go back and forth, can we add a
 * preview in the settings itself?"). Loaded only when Settings shows one (`registry.tsx`, lazy).
 *
 * - `CardSpacingPreview` (Settings › Review › Card spacing): a small sample card, drawn by the card's own render
 *   (`renderNoteCard`) in the card's own classes, one word shown and one still hidden.
 * - `PageSpacingPreview` (Settings › Appearance › Spacing): a heading and two paragraphs in the page editor's classes
 *   (`.editor-instance .milkdown .ProseMirror`).
 *
 * Neither copies a style: both sit inside `.app`, so the page's and the card's own rules and CSS variables
 * (`--edit-line-height`, `--edit-block-gap`, `--card-*`, `data-shown-hidden-words`) draw them, and they redraw the
 * moment a setting changes. The text is made up; nothing reads the vault.
 */
import { useEffect, useRef } from 'react'
import { renderNoteCard } from '../editor/noteCard/noteCardRender'
import '../editor/noteCard/noteCard.css'

/** The sample card: a title line, a paragraph with two hidden words, and a list with a child, so every spacing shows. */
export const PREVIEW_CARD = ['**Rivers of Europe**', '', 'The {{Seine}} runs through Paris and reaches the sea at {{Le Havre}}.', '', 'Its valley is known for its bridges.', '', '- It is 777 km long', '  - its source is in Burgundy'].join('\n')

export function CardSpacingPreview() {
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // The first hidden word shows, the second waits: both looks of Shown hidden words at once.
    body.current?.replaceChildren(renderNoteCard(PREVIEW_CARD, { shown: 1 }))
  }, [])
  return (
    <div className="spacing-preview" aria-hidden="true" data-preview="card">
      <span className="spacing-preview__label">Preview</span>
      <div className="note-card spacing-preview__card">
        <div ref={body} className="note-card__body" />
      </div>
    </div>
  )
}

export function PageSpacingPreview() {
  return (
    <div className="spacing-preview" aria-hidden="true" data-preview="page">
      <span className="spacing-preview__label">Preview</span>
      <div className="editor-instance spacing-preview__page">
        <div className="milkdown">
          <div className="ProseMirror">
            <h3>Rivers of Europe</h3>
            <p>The Seine runs through Paris and reaches the sea at Le Havre. It is 777 km long, and its source is in Burgundy.</p>
            <p>The Loire is the longest river in France. Its valley is known for its castles.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
