import { createContext } from 'react'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'

/** What App tells every editor about the window's vaults (YAZ-3609). A mount without App has none. */
export interface VaultLinks {
  /**
   * The `[[` picker rows of the window's vault that holds a path, or null for a path in no vault of the window
   * (D14): a Markdown link to a page of any vault in the workspace opens in a tab, and a pasted path of one
   * becomes a link.
   */
  candidatesOf: (path: string) => WikilinkCandidateSource | null
  /**
   * A page in a vault the app knows but this window does not show (D21): ask to add that vault to the window,
   * then open the page (`background`: behind). False when no such vault holds the path; the caller goes on.
   */
  askToAdd: (path: string, background: boolean) => boolean
  /** The window's vaults. A change redraws the open notes' link pills (YAZ-3664): a vault that joins makes its links pills. */
  roots: readonly string[]
  /** The window's vault names, one per line, as the sidebar shows them: a rename redraws the "(Vault)" on pills (D22). */
  names: string
  /** The name of the window's vault that holds `path`, or null outside them (D22): a link into another vault says which one. */
  vaultOf: (path: string) => string | null
  /**
   * The names of the window's vaults that use the ID letters `letters` (capitals), now or before, read live off each
   * vault's index (YAZ-3905 S23): an unresolved `[[INL-4]]` names its vault. Absent: none.
   */
  vaultsOfLetters?: (letters: string) => string[]
  /** Each vault's ID letters, one vault per line: a change (an index that lands) draws the `[[links]]` again (S23). */
  letters?: string
}

export const VaultLinksContext = createContext<VaultLinks | null>(null)
