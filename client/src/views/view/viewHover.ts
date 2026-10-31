/**
 * The folder views' hover panel (YAZ-3403): the sidebar's own panel beside an item of a folder's view — a card, a
 * list item, a table row, a board card. ONE dwell and ONE panel per folder (`ViewsPane` owns them); each layout gets
 * this handle as its `hover` prop and spreads `itemProps` on its item. Settings › Preview on hover › Folder views is
 * the one switch (YAZ-3743): the dwell does not start while it is off. There is no per-view switch.
 */
export interface ViewHover {
  /** The handlers an item spreads: `data-hover-item` finds it again when the dwell ends. */
  itemProps: (path: string) => { 'data-hover-item': string; onMouseEnter: () => void; onMouseLeave: () => void }
}
