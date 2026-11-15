/**
 * THE TITLE'S NAME RULE (YAZ-5580). Where a vault does not use IDs a page's (and a folder's) title IS its file's name, so a
 * title field says at once, under the field, when the title has a character a file name cannot hold
 * (`titleNameProblem`): the field keeps the text, and nothing is renamed until the character goes. A vault with IDs keeps
 * the title in front matter: any character goes, and the rule says nothing. A card in a page has no file name: its title
 * field never asks.
 *
 * App knows each vault's kind (`scopeOf(path).wikilinks.ids`) and hands it down here; a mount without App has no rule.
 */
import { createContext, useContext } from 'react'
import { titleNameProblem } from '@shared/entryName'

/** Is the title of the page or folder at `path` its file's name (its vault does not use IDs)? */
export const TitleIsName = createContext<(path: string) => boolean>(() => false)

/** The check of a title field, for the path it renames: the message to show under it, or null. Hooks once for a list of rows. */
export function useTitleChecks(): (path: string | null) => (title: string) => string | null {
  const isName = useContext(TitleIsName)
  return (path) => (path !== null && isName(path) ? titleNameProblem : noProblem)
}

/** The check of the title field of `path` (`useTitleChecks`). A title that is no file's name (`null`): none. */
export function useTitleCheck(path: string | null): (title: string) => string | null {
  return useTitleChecks()(path)
}

const noProblem = (): null => null
