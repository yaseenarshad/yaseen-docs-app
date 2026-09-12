import { COMMENTS_KEY } from '@shared/comments'
import { SETTINGS_KEY } from '../views/folderPageSettings'
import { FOLDER_PAGE_KEY } from './folderPages'

/**
 * The frontmatter keys the app OWNS (YAZ-1513, lifted out of the properties panel so there is one
 * list): the folder-page flag, its settings block and the comments store. The panel shows them as
 * "Reserved" with no editor, and a column with one of these keys can be hidden but never deleted.
 * Spelled from the real constants — never a local literal.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([FOLDER_PAGE_KEY, SETTINGS_KEY, COMMENTS_KEY])
