/**
 * The vault's people file in the renderer (YAZ-4615 D1): read through the generic `vaultConfig`
 * door, followed while it changes (a sync brings a teammate's card), and written only to put YOUR
 * card in. A file that is not valid JSON is never written over.
 */
import { createContext, useEffect, useState } from 'react'
import { EMPTY_PEOPLE, PEOPLE_FILE, parsePeople, withCard, type PeopleConfig } from '@shared/people'
import { nowIso } from '@shared/comments'
import type { CommentProfile, CommentsResolvedPlace } from '@shared/types'
import { api } from '../api'

/** What every comment block reads from the app, without threading it through each host (YAZ-4615). */
export interface CommentPrefs {
  /** Your profile, or null: the block then signs nothing (D2). */
  me: CommentProfile | null
  /** D5: a folded group at the bottom, or in place. */
  resolvedPlace: CommentsResolvedPlace
  /** D7: the composer's "+" opens Settings › You. */
  openProfile: () => void
}

export const CommentPrefsContext = createContext<CommentPrefs>({ me: null, resolvedPlace: 'bottom', openProfile: () => undefined })

/** The config door, or none: a test's partial bridge may have no `api`, no `vaultConfig`, or no `onChange`. */
const door = (): Partial<typeof api.vaultConfig> | undefined => (api as typeof api | undefined)?.vaultConfig

/** The people file of the vault at `root`; empty while it loads, when there is none, or when it does not parse. */
export function usePeople(root: string | null): PeopleConfig {
  const [people, setPeople] = useState<PeopleConfig>(EMPTY_PEOPLE)
  useEffect(() => {
    setPeople(EMPTY_PEOPLE)
    if (root === null) return
    let live = true
    // A bridge without the config door (a test's partial one) reads as no people file, never a throw.
    const load = (): void => {
      Promise.resolve().then(() => door()?.read?.(root, PEOPLE_FILE) ?? null).then(
        (raw) => live && setPeople(parsePeople(raw)),
        () => live && setPeople(EMPTY_PEOPLE),
      )
    }
    load()
    let unsubscribe = (): void => undefined
    try {
      unsubscribe =
        door()?.onChange?.((c) => {
          if (c.root === root && c.name === PEOPLE_FILE) load()
        }) ?? unsubscribe
    } catch {
      // No bridge under this host (a test's jsdom): nothing to follow.
    }
    return () => {
      live = false
      unsubscribe()
    }
  }, [root])
  return people
}

/**
 * Your card into the vault's people file (D1): on your first comment there, and when your profile
 * changes (`onlyIfThere`: only a vault that already has your card). Nothing is written when the card
 * already matches, or when the file is not valid JSON. Never throws: a card is a nicety, not the comment.
 */
export async function saveCard(root: string, profile: CommentProfile, onlyIfThere = false): Promise<void> {
  try {
    const config = parsePeople(await api.vaultConfig.read(root, PEOPLE_FILE))
    if (onlyIfThere && config.people[profile.handle] === undefined) return
    if (withCard(config, profile, nowIso()) === null) return
    // Read once more right before the write and build on THAT: a sync pull that landed meanwhile
    // keeps a teammate's new card (audit 22). The door has no compare-and-set; this narrows the gap.
    const fresh = withCard(parsePeople(await api.vaultConfig.read(root, PEOPLE_FILE)), profile, nowIso())
    if (fresh !== null) await api.vaultConfig.write(root, PEOPLE_FILE, fresh)
  } catch {
    // INVALID_CONFIG (a hand edit, a file half synced) or a vault that went away: leave it.
  }
}
