/**
 * The fold of a list that holds its own folds (YAZ-3511 D19): Sessions' rows and Recents' days. The list reports it after
 * each change, and `null` when it goes, so the tab row's expand-all button can read and drive it as on the tree tabs.
 */
export interface ListFold {
  /** Something is open: the button reads "Collapse all". */
  open: boolean
  /** Something can fold: else the button is dimmed. */
  any: boolean
  /** Open (`true`) or close every row. */
  setAll: (open: boolean) => void
}

export type OnListFold = (fold: ListFold | null) => void
