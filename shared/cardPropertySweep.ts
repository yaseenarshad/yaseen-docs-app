/**
 * THE ONE-TIME MOVE OF A CARD FILE'S PROPERTIES ONTO ITS CARD LINE (YAZ-5384, YAZ-5349 option A: "every card's
 * properties live on its card line, card files and cards in pages alike"). Before it, a card file kept the person's own
 * properties in its front matter (YAZ-5037, YAZ-5308). This module is the move: the index's sweep runs it one time for
 * each vault (`desktop/src/main/vaultIndex/idSweep.ts`), as it moved the titles (`cardTitleSweep.ts`).
 *
 * A card file's front matter keeps what is the FILE's, never the card's: `kind: card`, the app's own keys and the file's
 * switches (`id`, `title`, `in`, `also_in`, `aliases`, `comments`, Read only, the page switches). It also keeps what the
 * card line cannot take or must not: a value that is a map, or a list holding one; a name that is a card line word
 * (`isCardPropertyName`); and a key the card line holds already (in any capitals), so no value is ever lost.
 * Everything else moves onto the card's line, in its order, after the card's title; the rest of the file stays byte for
 * byte, with its own line end (YAZ-5146). Pure: no DOM, no Node.
 */
import { ALSO_IN_KEY } from './alsoIn'
import { CARD_KIND_KEY, isCardFileContent } from './cardFileFormat'
import { cardPropertiesOf, isCardPropertyName, rewritePageCards, withCardProperty } from './cardLine'
import { COMMENTS_KEY } from './comments'
import { FOLDER_VALUES_KEY } from './folderValues'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { inLineEnds } from './lineEnds'
import { PAGE_ID_KEY } from './pageId'
import { TITLE_KEY } from './pageName'
import { CODE_WIDTH_KEY, FIND_FOLDS_KEY, OUTSIDE_GLOW_KEY, PAGE_POSITION_KEY, PAGE_SWITCH_KEYS, PAGE_WIDTH_KEY, TABLE_WIDTH_KEY } from './pageSwitches'
import { CARD_SIDES_KEY } from './pageSwitches'
import { keyFold } from './propertyKeys'
import { READ_ONLY_KEY } from './readOnly'

/** The keys that are the file's, not the card's: they stay in a card file's front matter. */
const FILE_KEYS: ReadonlySet<string> = new Set(
  [CARD_KIND_KEY, PAGE_ID_KEY, TITLE_KEY, FOLDER_VALUES_KEY, ALSO_IN_KEY, 'aliases', COMMENTS_KEY, READ_ONLY_KEY, ...PAGE_SWITCH_KEYS, OUTSIDE_GLOW_KEY, FIND_FOLDS_KEY, CODE_WIDTH_KEY, TABLE_WIDTH_KEY, PAGE_WIDTH_KEY, PAGE_POSITION_KEY, CARD_SIDES_KEY].map(keyFold),
)

/** A value the card line holds: one scalar (or none), or a list of scalars. */
const isLineValue = (value: unknown): boolean => {
  const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date
  return Array.isArray(value) ? value.every(scalar) : scalar(value)
}

/** The card file `content` with its own properties on its card line, or null when nothing moves (a page, nothing to move, no card). */
export function cardFilePropertiesMoved(content: string): string | null {
  if (!isCardFileContent(content)) return null
  const moved = inLineEnds(content, (file) => {
    const { properties } = parseFrontmatter(splitFrontmatter(file).frontmatter)
    let keys: string[] = []
    const next = rewritePageCards(file, (card, index) => {
      if (index !== 0) return undefined
      const held = new Set(Object.keys(cardPropertiesOf(card.line)).map(keyFold))
      keys = Object.keys(properties).filter((key) => !FILE_KEYS.has(keyFold(key)) && isCardPropertyName(key) && !held.has(keyFold(key)) && isLineValue(properties[key]))
      if (keys.length === 0) return undefined
      return keys.reduce((line, key) => withCardProperty(line, key, properties[key]), card.line)
    })
    // Only once the line holds them do they leave the front matter: one write of the file, both together.
    return next === file ? file : keys.reduce((out, key) => setFrontmatterProperty(out, key, undefined), next)
  })
  return moved === content ? null : moved
}
