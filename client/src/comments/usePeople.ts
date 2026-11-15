/**
 * The vault's people file in the renderer (YAZ-4615 D1): read through the generic `vaultConfig`
 * door, followed while it changes (a sync brings a teammate's card), and written only to put YOUR
 * card in. A file that is not valid JSON is never written over.
 */
import { createContext, useEffect, useRef, useState } from 'react'
import { EMPTY_PEOPLE, own, PEOPLE_FILE, parsePeople, withCard, type PeopleRead } from '@shared/people'
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

/** One read of a vault's people file, shared by every comment block that shows it. */
interface Shared {
  people: PeopleRead
  users: Set<(people: PeopleRead) => void>
  stop: () => void
}
const shared = new Map<string, Shared>()

/**
 * Follows the people file of `root` for `onPeople`; returns the stop. The first block of a vault
 * reads it and follows its changes; the rest share that read, so ten open notes parse it once.
 */
function follow(root: string, onPeople: (people: PeopleRead) => void): () => void {
  let entry = shared.get(root)
  if (entry === undefined) {
    const made: Shared = { people: EMPTY_PEOPLE, users: new Set(), stop: () => undefined }
    // Two quick changes start two reads; only the newest may land, whichever answers last.
    let reads = 0
    // A bridge without the config door (a test's partial one) reads as no people file, never a throw.
    const load = (): void => {
      const mine = ++reads
      void Promise.resolve()
        .then(() => door()?.read?.(root, PEOPLE_FILE) ?? null)
        .then(parsePeople, () => EMPTY_PEOPLE)
        .then((people) => {
          if (shared.get(root) !== made || mine !== reads) return
          made.people = people
          for (const user of made.users) user(people)
        })
    }
    try {
      made.stop =
        door()?.onChange?.((c) => {
          if (c.root === root && c.name === PEOPLE_FILE) load()
        }) ?? made.stop
    } catch {
      // No bridge under this host (a test's jsdom): nothing to follow.
    }
    shared.set(root, made)
    entry = made
    load()
  }
  const here = entry
  here.users.add(onPeople)
  onPeople(here.people)
  return () => {
    here.users.delete(onPeople)
    if (here.users.size > 0 || shared.get(root) !== here) return
    here.stop()
    shared.delete(root)
  }
}

/** The people file of the vault at `root`; empty while it loads, when there is none, or when it does not parse. */
export function usePeople(root: string | null): PeopleRead {
  const [people, setPeople] = useState<PeopleRead>(EMPTY_PEOPLE)
  useEffect(() => {
    setPeople(EMPTY_PEOPLE)
    if (root === null) return
    return follow(root, setPeople)
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
    const file = await api.vaultConfig.read(root, PEOPLE_FILE)
    if (onlyIfThere && own(parsePeople(file).people, profile.handle) === undefined) return
    if (withCard(file, profile, nowIso()) === null) return
    // Read once more right before the write and build on THAT: a sync pull that landed meanwhile
    // keeps a teammate's new card (audit 22). The door has no compare-and-set; this narrows the gap.
    const fresh = withCard(await api.vaultConfig.read(root, PEOPLE_FILE), profile, nowIso())
    if (fresh !== null) await api.vaultConfig.write(root, PEOPLE_FILE, fresh)
  } catch {
    // INVALID_CONFIG (a hand edit, a file half synced) or a vault that went away: leave it.
  }
}

/**
 * D1 rule 3: your card follows your profile in each vault of the window that already has one —
 * after a change, and in a vault when it joins the window (it may hold an old card). Each vault is
 * asked once for each version of the profile; a card that already matches writes nothing.
 */
export function useCardFollowsProfile(roots: readonly string[], profile: CommentProfile | null): void {
  const carded = useRef(new Set<string>())
  const rootsKey = roots.join('\n')
  useEffect(() => {
    if (profile === null) return
    const version = JSON.stringify(profile)
    for (const root of rootsKey === '' ? [] : rootsKey.split('\n')) {
      const key = `${root}\n${version}`
      if (carded.current.has(key)) continue
      carded.current.add(key)
      void saveCard(root, profile, true)
    }
  }, [profile, rootsKey])
}
