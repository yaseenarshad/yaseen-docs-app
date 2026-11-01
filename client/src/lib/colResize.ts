/**
 * A drag's hold on the page (YAZ-3719 1A, 1B): no iframe in the hit test while it lasts (`body.drag-held` in app.css).
 * A frame is another page, draw.io's `app://drawio` above all: over it the window and the document get no `mousemove`
 * and no `mouseup`, so a release there left the drag running with the button up.
 */
export function holdFrames(held: boolean): void {
  document.body.classList.toggle('drag-held', held)
}

/**
 * A drag-to-resize edge's hold: the col-resize cursor everywhere, and the frames held off. The sidebar edge (`App.tsx`),
 * the right panel's (`RightPanel.tsx`), the table of contents' (`tocFrame.tsx`) and a folder view's column edge
 * (`TableView.tsx`). A handle with a cursor of its own (an image's, a line's) holds the frames alone.
 */
export function holdColResize(held: boolean): void {
  document.body.style.cursor = held ? 'col-resize' : ''
  holdFrames(held)
}
