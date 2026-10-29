import { createContext } from 'react'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'

/**
 * The `[[` picker rows of the window's vault that holds a path, or null for a path in no vault of the
 * window (YAZ-3609 D14): a Markdown link to a page of any vault in the workspace opens in a tab, and a
 * pasted path of one becomes a link. App provides it; a mount without App has none.
 */
export const VaultLinksContext = createContext<((path: string) => WikilinkCandidateSource | null) | null>(null)
