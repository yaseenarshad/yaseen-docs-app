/**
 * Explore's empty box (YAZ-4945): two sections, newest first.
 *
 *   Opened   up to `SECTION_CAP`: the files opened in Explore or in a tab — Explore's own list (`exploreRecents.ts`,
 *            kept after a restart) and the vault's open history (`storage.getOpens`, every window's tabs, kept by main),
 *            each file once, at its newest open.
 *   Edited   up to `SECTION_CAP`: the vault's save log (`storage.getEdits`), the list the sidebar's Recents tab reads
 *            (YAZ-3235); a file already under Opened is not repeated.
 *
 * Notes, drawings and diagrams only (they open as layers); only this window's vaults, and in a folder-of-a-vault
 * window only the files under that folder (`inPlace`). Pure; the stack calls it when its list may have changed (an
 * open, a step), never per keystroke.
 */
import { rootOfPath, type OpenStat } from '@shared/types'
import { inPlace } from '../vault/placeScope'
import type { ExploreOpen } from './exploreRecents'
import { layerKindOf } from './layers'

export const SECTION_CAP = 8

export interface RecentSections {
  opened: readonly ExploreOpen[]
  edited: readonly ExploreOpen[]
}

export const NO_SECTIONS: RecentSections = { opened: [], edited: [] }

export interface RecentSources {
  /** The window's vaults: each root, and the folder a folder-of-a-vault window shows. */
  vaults: readonly { root: string; folder?: string | null }[]
  /** Explore's own opens, newest first. */
  explore: readonly ExploreOpen[]
  /** A vault's open history (main's, `last` = the last open). */
  opensOf: (root: string) => Readonly<Record<string, OpenStat>>
  /** A vault's save log (path → the save's time). */
  editsOf: (root: string) => Readonly<Record<string, number>>
}

const newestFirst = (a: ExploreOpen, b: ExploreOpen): number => b.at - a.at || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

export function recentSections({ vaults, explore, opensOf, editsOf }: RecentSources, cap = SECTION_CAP): RecentSections {
  const roots = vaults.map((v) => v.root)
  /** A file of this window that opens as a layer: in a vault of it, under its folder, a note or a board. */
  const shown = (path: string): boolean => {
    const root = rootOfPath(roots, path)
    if (root === null || layerKindOf(path) === null) return false
    return inPlace(vaults[roots.indexOf(root)]?.folder ?? undefined, path)
  }
  const opened = new Map<string, number>()
  const add = (into: Map<string, number>, path: string, at: number) => {
    if (!shown(path)) return
    const held = into.get(path)
    if (held === undefined || at > held) into.set(path, at)
  }
  for (const e of explore) add(opened, e.path, e.at)
  for (const root of roots) for (const [path, stat] of Object.entries(opensOf(root))) add(opened, path, stat.last)
  const openedList = [...opened].map(([path, at]) => ({ path, at })).sort(newestFirst).slice(0, cap)
  const taken = new Set(openedList.map((e) => e.path))
  const edited = new Map<string, number>()
  for (const root of roots) for (const [path, at] of Object.entries(editsOf(root))) if (!taken.has(path)) add(edited, path, at)
  return { opened: openedList, edited: [...edited].map(([path, at]) => ({ path, at })).sort(newestFirst).slice(0, cap) }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** A row's time, muted on the right: "now", "5 min", "3 h", "yesterday", "4 d", then the date ("Oct 3"). */
export function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`
  const then = new Date(at)
  const today = new Date(now)
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / (24 * HOUR))
  if (days <= 0) return `${Math.floor(ms / HOUR)} h`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} d`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: then.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
