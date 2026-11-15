/** The course's vault view (YAZ-5201): every read goes to the bound vault's CURRENT scope, as every write goes to its root. */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { courseVaultView, type CourseScope } from './courseVaultView'

const rec = (path: string): IndexRecord =>
  ({ path, name: 'a.md', basename: 'a', title: 'a', folder: 'course-cards', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }) as IndexRecord

/** One slot of the window: a scope whose `wikilinks` source is stable and is fed the records of whatever vault the slot holds. */
function slot(root: string | null, records: IndexRecord[]) {
  const listeners = new Set<() => void>()
  const wikilinks = { records, folders: [] as IndexRecord[], ids: true, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) }
  const scope = {
    root,
    ids: { enabled: true },
    wikilinks,
    readOnlyVault: { settings: { on: false } },
    reviewSettings: { ready: true, settings: { ...DEFAULT_REVIEW_SETTINGS, enabled: true } },
  } as unknown as CourseScope & { root: string | null }
  return {
    scope,
    /** The slot now holds another vault (`assignSlots` reuses a free slot). */
    hold(next: string | null, nextRecords: IndexRecord[]) {
      scope.root = next
      wikilinks.records = nextRecords
      listeners.forEach((l) => l())
    },
  }
}

describe('courseVaultView (YAZ-5201)', () => {
  it('after vault A is removed from the window, C takes its slot, and A is added again in another slot, the course reads A`s files, never C`s', () => {
    const x = slot('/a', [rec('/a/course-cards/one.md')])
    const y = slot(null, [])
    let now: CourseScope | undefined = x.scope
    const view = courseVaultView('/a', () => now, null)
    expect(view.index.records.map((r) => r.path)).toEqual(['/a/course-cards/one.md'])
    const heard = vi.fn()
    view.index.subscribe(heard)

    // A leaves the window: nothing to read, and the course only shows.
    now = undefined
    view.changed()
    expect(view.ready()).toBe(false)
    expect(view.index.records).toEqual([])
    // C takes A's old slot; A comes back in another slot.
    x.hold('/c', [rec('/c/course-cards/theirs.md')])
    y.hold('/a', [rec('/a/course-cards/one.md'), rec('/a/course-cards/two.md')])
    now = y.scope
    view.changed()
    expect(view.ready()).toBe(true)
    expect(view.index.records.map((r) => r.path)).toEqual(['/a/course-cards/one.md', '/a/course-cards/two.md'])
    expect(heard).toHaveBeenCalled()
  })

  it('reads nothing from a scope that holds another vault', () => {
    const x = slot('/c', [rec('/c/x.md')])
    const view = courseVaultView('/a', () => x.scope, null)
    expect(view.ready()).toBe(false)
    expect(view.index.records).toEqual([])
    expect(view.index.folders).toEqual([])
    expect(view.index.ids).toBe(false)
  })
})
