/**
 * The folder views' hover panel (YAZ-3403): the sidebar's own panel beside an item of a folder's view — a card, a
 * list item, a table row, a board card. ONE dwell and ONE panel per folder (`ViewsPane` owns them); each layout gets
 * this handle as its `hover` prop and spreads `itemProps` on its item. No handle — the setting off, or a table or
 * board view whose own Preview is on, which keeps its own card — and the item takes nothing: never two panels.
 */
export interface ViewHover {
  /** The handlers an item spreads: `data-hover-item` finds it again when the dwell ends. */
  itemProps: (path: string) => { 'data-hover-item': string; onMouseEnter: () => void; onMouseLeave: () => void }
}
