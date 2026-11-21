import { createContext } from 'react'
import type { LinkActions } from '../editor/linkMenu'

/**
 * App's page doors for a menu about a page (YAZ-3746 13AW): the folder page's row and card menus read Favorites, Focus
 * and "Open in ›" here, the same doors the tab menu and the link menu use (`App.linkActions`). Null outside App.
 */
export const PageActions = createContext<LinkActions | null>(null)
