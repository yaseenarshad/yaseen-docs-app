import { ALSO_IN_KEY } from '@shared/alsoIn'
import { COMMENTS_KEY } from '@shared/comments'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { NOTE_ID_KEY } from '@shared/noteId'
import { TITLE_KEY } from '@shared/noteName'
import { REVIEWS_KEY } from '@shared/reviews'

const PLAIN: ReadonlySet<string> = new Set([COMMENTS_KEY, REVIEWS_KEY])
const ID_VAULT: ReadonlySet<string> = new Set([...PLAIN, NOTE_ID_KEY, TITLE_KEY, ALSO_IN_KEY, FOLDER_VALUES_KEY])

/**
 * The frontmatter keys the app OWNS on a note (YAZ-1513/1549), spelled from the real constants —
 * never a local literal: the comments store, the note id (YAZ-2293 — editing it would orphan every
 * link to the note), the review log (YAZ-2322), the note's shortcuts (YAZ-2290 D2 — folder ids,
 * set from the folder's own menu) and the folders' values (D19 — `in`, written by each folder's
 * views) — keys whose VALUE is the app's, not the user's — and the title (YAZ-2420 🔒 D14), which is the
 * user's but is written only by a title edit, because that edit also names the file. None is a name a property can be added
 * under, and none is deleted as a column: `deleteColumn.ts` refuses them. The properties panel
 * shows them as "Reserved" with no editor — `in` as no row at all: its blocks are the panel's
 * folder rows. A folder's settings block is the app's only in the folder's own `.folder.md`, whose
 * panel hides it; on a note that key is an ordinary property.
 *
 * Where the vault does not use IDs (YAZ-2523 🔒 V12) only the comments store and the review log are
 * the app's: `id`, `title`, `also_in` and `in` are ordinary properties there. As columns they are
 * still never deleted: `deleteColumn.ts` asks for the ID vault's keys in either kind of vault.
 */
export const reservedKeys = (ids: boolean): ReadonlySet<string> => (ids ? ID_VAULT : PLAIN)
