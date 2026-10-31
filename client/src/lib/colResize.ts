/**
 * A drag-to-resize edge's hold on the page (YAZ-3719 1A), shared by the sidebar edge (`App.tsx`), the right panel's
 * (`RightPanel.tsx`) and the table of contents' (`tocFrame.tsx`): the col-resize cursor everywhere, and no iframe in the
 * hit test (`body.col-resizing` in app.css). A frame is another page, draw.io's `app://drawio` above all: over it the
 * window gets no `mousemove` and no `mouseup`, so a release there left the drag running with the button up.
 */
export function holdColResize(held: boolean): void {
  document.body.style.cursor = held ? 'col-resize' : ''
  document.body.classList.toggle('col-resizing', held)
}
