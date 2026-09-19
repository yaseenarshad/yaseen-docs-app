/**
 * THE IMAGE LIGHTBOX (YAZ-1656 / YAZ-1665): double-click a rendered image → it opens full-window →
 * Esc, backdrop click or ✕ closes. Nothing to save: this is a viewer, never an editor.
 *
 * A MODAL BESIDE THE EDITOR, the `DrawingModal` precedent (YAZ-879): `Editor`'s `CrepeHost` holds
 * `openImage`, the node view's double-click sets it (`image.onOpenImage`), and this renders over
 * the window. It is given the RESOLVED src — the same URL the inline `<img>` loaded — so what the
 * lightbox shows is exactly what the note showed, cache and all.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s (the YAZ-888 lesson, as DrawingModal states it):
 * React flushes mount effects inside the dispatch of the event that opened this, so a `window`
 * listener would hear the very double-click that opened it. Bound to the overlay, it only hears
 * what happens inside itself — and the overlay takes focus on mount so Esc lands at once.
 *
 * FOCUS COMES BACK. The double-click that opens this happens with the editor focused; the overlay
 * takes that focus, and on unmount hands it back to whatever had it — so Esc returns the user to
 * their caret instead of dropping focus on `<body>`, where the next keystroke goes nowhere.
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import './imageModal.css'

interface ImageModalProps {
  /** The RESOLVED src (what the inline `<img>` loaded), never the markdown's relative path. */
  src: string
  /** The alt's text half (`parseAlt`'s `text`) — the caption, and what a screen reader says. */
  alt: string
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
}

export function ImageModal({ src, alt, onClose }: ImageModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Focus lands here on mount so Esc works without a click first; it goes back where it came from on unmount.
  useEffect(() => {
    const opener = document.activeElement
    overlayRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <div ref={overlayRef} className="image-modal-overlay" tabIndex={-1} onMouseDown={onClose} onKeyDown={onKeyDown}>
      <figure className="image-modal" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onMouseDown={(e) => e.stopPropagation()}>
        <img className="image-modal__img" src={src} alt={alt} />
        {alt !== '' && <figcaption className="image-modal__caption">{alt}</figcaption>}
      </figure>
      <button type="button" className="image-modal__close" aria-label="Close image" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
        ✕
      </button>
    </div>
  )
}
