/**
 * THE COURSE'S VAULT VIEW (YAZ-5124, YAZ-5201): the live `CourseVault` that App gives the course layer for the run's
 * ONE vault. In the startup bundle (App builds it), so it imports types and `DEFAULT_REVIEW_SETTINGS` only.
 */
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { VaultScope } from '../vault/useVaultScope'
import type { CourseVault } from './courseHost'

/** The parts of a vault's scope the course reads. */
export type CourseScope = Pick<VaultScope, 'root' | 'ids' | 'wikilinks' | 'readOnlyVault' | 'reviewSettings'>

/** The view, and `changed()`: App calls it when the bound vault's index changed, or when the vault moved to another slot. */
export type LiveCourseVault = CourseVault & { changed(): void }

/**
 * The view of the vault at `root`. `live()` gives the scope that holds `root` NOW (undefined: not in the window). Each
 * field is read when the course needs it, from that scope only: never a scope that holds another vault. A vault removed
 * from the window and added again comes back in another slot, and its old slot may hold another vault by then
 * (YAZ-5201, the checker's round 2), so the view never keeps a slot's index.
 */
export function courseVaultView(root: string, live: () => CourseScope | undefined, cardSkill: string | null): LiveCourseVault {
  const here = (): CourseScope | undefined => {
    const scope = live()
    return scope?.root === root ? scope : undefined
  }
  const listeners = new Set<() => void>()
  return {
    root,
    index: {
      get records() {
        return here()?.wikilinks.records ?? []
      },
      get folders() {
        return here()?.wikilinks.folders ?? []
      },
      get ids() {
        return here()?.wikilinks.ids ?? false
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    },
    // A scope gone from the window (the vault was removed) reads as not ready: the course only shows.
    ready: () => here()?.ids !== undefined,
    readOnly: () => here()?.readOnlyVault.settings.on ?? true,
    review: () => {
      const review = here()?.reviewSettings
      return { ready: review?.ready === true, on: review?.settings.enabled === true, settings: review?.settings ?? DEFAULT_REVIEW_SETTINGS }
    },
    cardSkill,
    changed: () => listeners.forEach((l) => l()),
  }
}
