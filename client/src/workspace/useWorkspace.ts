import { useCallback, useRef, useState } from 'react'
import { cleanVaultName, defaultRightPanelIdentity, type RightPanelIdentity, type StoredTab } from '@shared/types'
import { storage } from '../lib/storage'
import { carryEditorAcrossPane, flushRenamedPath } from '../lib/renameContinuity'
import { hashFilePath } from '../lib/urlHash'

/**
 * The renderer-owned tab model (Tabs I2, GRO-2234). A window's open files are
 * `WindowEntry.tabs` with `file` doubling as the ACTIVE tab (GRO-2232); the boot identity
 * snapshot seeds this state, and from then on the renderer owns it, mirroring every change
 * down as ONE explicit complete workspace identity write — never a
 * `{ file }`-only patch, whose main-side normalization would prepend files into `tabs`
 * on its own (the legacy pre-tabs path).
 *
 * Each tab has its own id (YAZ-2940 D1), so two tabs may show one path: a copy. `active`,
 * `mounted`, `history` and `preview` name tabs by id; a file call always takes the tab's path.
 * The mirror writes `tabStrip(state)` — every tab, copies and display names included (YAZ-3057) — and
 * the active tab's path as `file`. Storage derives `WindowEntry.tabs` from it, each path once.
 *
 * Invariants: `active` is the id of a tab in `tabs` whenever non-null; `tabs: []` ⇔
 * `active: null`; ids are unique. `mounted` is renderer-only: `mounted ⊆ tab ids`,
 * `active ∈ mounted` whenever non-null.
 */
export interface TabsState {
  /** Open tabs, left→right. Two tabs may show one path (YAZ-2940 D1); `storedTabs` gives `WindowEntry.tabs`. */
  tabs: Tab[]
  /** The active tab's id; its path doubles as the window's `file` (title, URL hash, sidebar highlight) — `activePath`. */
  active: string | null
  /**
   * Tab ids visited since boot, in first-activation order: exactly the editors kept mounted.
   * A background tab's editor lazy-mounts on first activation — which is also why opening
   * one never steals focus (`focusEditor` only fires when an editor mounts).
   */
  mounted: string[]
  /**
   * Per-tab back/forward stacks (YAZ-721, LOCKED ruling D1): a side table keyed by tab id
   * (YAZ-2940 D1); the entries are paths. A tab with no record reads lazily as
   * `{ entries: [tab.path], index: 0 }`. Renderer- and session-only: it never reaches `storage`.
   */
  history: Record<string, TabHistory>
  /**
   * The id of the ONE preview tab (YAZ-2648 D1), or null. Renderer- and session-only, like `history`:
   * a tab of `tabs` whenever non-null. Every other tab is a kept tab, and a kept tab is never
   * replaced by an open from the sidebar.
   */
  preview: string | null
  /**
   * The ONE blank tab shows (YAZ-2655 D10): "New tab", last in the strip, and the active one for as
   * long as it is there. It is NOT in `tabs` and never reaches `storage`: while it shows, `active`
   * is still the last real active tab — the file the window stores, since main requires one for a
   * list of tabs that is not empty — and no page is on show. The next page opened fills it as a
   * kept tab; a trip to another tab drops it.
   */
  blank: boolean
}

/** One open tab (YAZ-2940 D1): its own id, the page it shows, and its display name (YAZ-2949 D1). */
export interface Tab {
  id: string
  path: string
  /**
   * "Set display name" (YAZ-2949): what this tab shows in place of its page name. Stored with the
   * window (YAZ-3057), never in a file call. A tab that shows a different page has none (D2).
   */
  name?: string
}

/** One tab's back/forward stack (YAZ-721 D1): `entries[index]` is the page the tab shows. */
export interface TabHistory {
  entries: string[]
  index: number
}

let lastTabId = 0
/** A new tab id (YAZ-2940 D1): unique in this window for the session. Ids never reach storage. */
export const newTabId = (): string => `tab-${++lastTabId}`

const newTab = (path: string): Tab => ({ id: newTabId(), path })

/** The tab with this id, or null. */
export const tabById = (s: Pick<TabsState, 'tabs'>, id: string | null): Tab | null => (id === null ? null : (s.tabs.find((t) => t.id === id) ?? null))

/** The tab a trip to `path` goes to (YAZ-2940 S7, S8): the active tab if it shows `path`, else the first from the left that does, else null. */
export function tabOf(s: Pick<TabsState, 'tabs' | 'active'>, path: string): Tab | null {
  const active = tabById(s, s.active)
  return active !== null && active.path === path ? active : (s.tabs.find((t) => t.path === path) ?? null)
}

/** The window's paths (S25): each once, in the order of its first tab — `WindowEntry.tabs`. */
export const storedTabs = (tabs: readonly Tab[]): string[] => [...new Set(tabs.map((t) => t.path))]

/**
 * What the window stores of its tabs (YAZ-3057): each tab left→right, copies included, with its display
 * name, and the active tab marked — so the copy that was on show is the one on show after a restart.
 */
export const tabStrip = (s: TabsState): StoredTab[] =>
  s.tabs.map((t) => ({ path: t.path, ...(t.name === undefined ? {} : { name: t.name }), ...(t.id === s.active ? { active: true as const } : {}) }))

/** The active tab's path: the window's `file`. */
export const activePath = (s: Pick<TabsState, 'tabs' | 'active'>): string | null => tabById(s, s.active)?.path ?? null

/** Whether any tab shows `path`. */
const shows = (s: Pick<TabsState, 'tabs'>, path: string): boolean => s.tabs.some((t) => t.path === path)

export interface WorkspaceState extends TabsState {
  rightPanel: RightPanelIdentity
  /** Right editors visited in this session, retained until their header closes. */
  rightMounted: string[]
  /** Session-only Back/Forward stacks, independent from main-tab history. */
  rightHistory: Record<string, TabHistory>
}

export type WorkspaceAction =
  | TabsAction
  | { type: 'open-right' | 'open-right-background'; path: string; at?: number }
  | { type: 'navigate-right'; from: string; to: string }
  | { type: 'toggle-right'; path: string }
  | { type: 'close-right'; path: string }
  | { type: 'move-right'; from: number; to: number }
  | { type: 'transfer-main-to-right'; path: string; at: number }
  | { type: 'transfer-right-to-main'; path: string; at: number }
  | { type: 'right-back' | 'right-forward' }
  | { type: 'set-right-open'; open: boolean }
  | { type: 'set-right-width'; width: number }

// Actions that name a TAB take its id; actions that name a FILE take a path (YAZ-2940 D1). A trip to
// a file that is open goes to `tabOf` it: the active tab if it shows it, else the first from the left.
export type TabsAction =
  | { type: 'open-current'; path: string } // sidebar click & friends: open in the PREVIEW tab, replacing the page it showed (go to `tabOf` instead when already open)
  | { type: 'navigate'; path: string } // a link inside a page: replace the ACTIVE tab in its slot, with history (go to `tabOf` instead when already open)
  | { type: 'open-new'; path: string } // the ONE door to a kept tab: append it at the end + activate; a page that is open is gone to, and the preview tab that shows it is kept
  | { type: 'open-background'; path: string } // append a KEPT tab at the end, do NOT activate (no-op when already open)
  | { type: 'duplicate'; id: string } // "Duplicate tab" (YAZ-2940 D6): a copy of the tab, right after it, active
  | { type: 'take'; path: string } // a tab another window moved here (YAZ-3091 D5): ALWAYS a new kept tab at the end, active — a copy when the page is open
  | { type: 'keep'; id: string } // double click, first edit: the preview tab becomes a kept tab (no-op for any other tab)
  | { type: 'set-name'; id: string; name: string | null } // "Set display name" / "Reset to page name" (YAZ-2949): null, empty or blank clears it
  | { type: 'new-tab' } // ⌘T, the strip's "+": the blank tab shows (no-op while it does)
  | { type: 'close-blank' } // ⌘W on the blank tab, its ✕: it goes, and the tab that was active is active again
  | { type: 'activate'; id: string } // tab-strip click
  | { type: 'close'; id: string } // ✕ / ⌘W: this tab only, a copy too (S11); the active tab closes to its right neighbour, else left
  | { type: 'close-many'; ids: readonly string[] } // the tab board's "Close them", "Close the others" and an island's ✕: each tab by `close`, in ONE change
  | { type: 'move'; from: number; to: number } // drag-to-reorder (I3): the tab at `from` lands at final index `to`
  | { type: 'cycle'; dir: 1 | -1 } // ⌃Tab / ⌃⇧Tab: wraparound, plain left→right order
  | { type: 'back' } // the active tab steps back through its OWN stack (YAZ-721)
  | { type: 'forward' } // …and forward again, as far as the stack was walked back
  | { type: 'open-stored'; tabs: readonly StoredTab[] } // "Restore session" (YAZ-3147 D3): the pages that are not open join the END, in ONE change; an open page opens no copy
  | { type: 'reset'; tabs: readonly StoredTab[]; active: string | null } // boot + root switch: the STORED tabs and file; replace wholesale with new ids
  | { type: 'rename'; oldPath: string; newPath: string } // in-app rename (Links E1, GRO-2194): every tab of the file follows it in place (S17)
  | { type: 'rename-dir'; oldPath: string; newPath: string } // in-app FOLDER rename (Links E1b, GRO-2241): the folder's own tab and every tab under it follow in place
  | { type: 'delete'; path: string } // in-app delete (GRO-2272): every tab of the file goes, each closing as `close` does (S18)
  | { type: 'delete-dir'; path: string } // in-app FOLDER delete (GRO-2272): the folder's own tab and every tab under it go

const EMPTY: TabsState = { tabs: [], active: null, mounted: [], history: {}, preview: null, blank: false }

/** Go to the tab `active` (an id). A trip to a tab drops an unused blank tab (YAZ-2655 S73). */
function withActive(s: TabsState, active: string): TabsState {
  return { tabs: s.tabs, active, mounted: s.mounted.includes(active) ? s.mounted : [...s.mounted, active], history: s.history, preview: s.preview, blank: false }
}

/** A new KEPT tab for `path` at the end of the strip, active. */
function appendActive(s: TabsState, path: string, preview: boolean): TabsState {
  const tab = newTab(path)
  return { tabs: [...s.tabs, tab], active: tab.id, mounted: [...s.mounted, tab.id], history: s.history, preview: preview ? tab.id : s.preview, blank: false }
}

/**
 * A page opened while the blank tab is active FILLS it (YAZ-2655 D10, S71): a KEPT tab where the
 * blank tab stood, at the end of the strip. A page that is open already has its own tab, so the
 * app goes there (`tabOf`) and the blank tab goes away (S72). The preview tab is not touched either way.
 */
function fillBlank(s: TabsState, path: string): TabsState {
  const open = tabOf(s, path)
  return open !== null ? withActive(s, open.id) : appendActive(s, path, false)
}

/**
 * `path` takes over the tab `slot` (an id) in place (same-tab navigation): the tab keeps its id, and
 * App's layer mounts a new editor for the new page (→ the old one's autosave flush). The slot's stack
 * gains the page, any forward entries truncated — or, from Back and Forward, is the walked `stack`.
 * A slot that was the preview tab stays the preview tab.
 */
function replaceSlot(s: TabsState, slot: string, path: string, stack?: TabHistory): TabsState {
  const h = s.history[slot] ?? { entries: [tabById(s, slot)?.path ?? path], index: 0 }
  return {
    tabs: s.tabs.map((t) => (t.id === slot ? { id: slot, path } : t)),
    active: slot,
    mounted: [...s.mounted.filter((t) => t !== slot), slot],
    history: { ...s.history, [slot]: stack ?? { entries: [...h.entries.slice(0, h.index + 1), path], index: h.index + 1 } },
    preview: s.preview,
    blank: false,
  }
}

/** One stack's entries rewritten through `f` (renamed, or dropped with `null`); the index follows the entry it pointed at. */
function mapEntries(r: TabHistory, f: (p: string) => string | null): TabHistory {
  const entries: string[] = []
  let index = 0
  r.entries.forEach((e, i) => {
    const m = f(e)
    if (m === null) return
    if (i === r.index) index = entries.length
    entries.push(m)
  })
  return { entries, index }
}

/**
 * Rewrite every PATH-keyed stack (the right panel's) through `f` — renaming a path, or dropping it
 * with `null` (which drops the whole record when its own key goes). The index follows the entry it
 * pointed at, which always survives when the key does: a record's key IS its current entry.
 */
function rekey(h: Record<string, TabHistory>, f: (p: string) => string | null): Record<string, TabHistory> {
  const out: Record<string, TabHistory> = {}
  for (const [key, r] of Object.entries(h)) {
    const k = f(key)
    if (k !== null) out[k] = mapEntries(r, f)
  }
  return out
}

/** `rekey` for the main tabs' stacks, keyed by tab id (YAZ-2940 D1): the keys stay, and a record whose own page is dropped goes — its tab closes with it. */
function remapStacks(h: Record<string, TabHistory>, f: (p: string) => string | null): Record<string, TabHistory> {
  const out: Record<string, TabHistory> = {}
  for (const [id, r] of Object.entries(h)) {
    if (f(r.entries[r.index]) !== null) out[id] = mapEntries(r, f)
  }
  return out
}

/** Whether some stack still holds a page that `f` picks. */
const inStacks = (h: Record<string, TabHistory>, f: (p: string) => boolean): boolean => Object.values(h).some((r) => r.entries.some(f))

/** Every tab of a page that `f` picks closes, left to right, each through the SAME ladder as `close`: the heir is whatever survives. */
function closeWhere(s: TabsState, f: (path: string) => boolean): TabsState {
  return s.tabs.filter((t) => f(t.path)).reduce((acc, t) => tabsReducer(acc, { type: 'close', id: t.id }), s)
}

/**
 * Every page that `remap` changes follows it: each of its tabs IN PLACE, with its own id, so activation,
 * the mounted set and the preview mark stay on it; and every stack, by entry — a page reached through
 * history is the same file as the one on screen. Nothing to remap → the same state.
 */
function remapPages(s: TabsState, remap: (p: string) => string): TabsState {
  const moves = (p: string): boolean => remap(p) !== p
  if (!s.tabs.some((t) => moves(t.path)) && !inStacks(s.history, moves)) return s
  // A tab keeps its display name when its file or a folder above it is renamed (YAZ-2949 S16): it is the same page.
  return { ...s, tabs: s.tabs.map((t) => (moves(t.path) ? { ...t, path: remap(t.path) } : t)), history: remapStacks(s.history, remap) }
}

/** Every page that `gone` picks leaves every stack first — Back never steps onto a file that is gone — and then each of its tabs closes (`closeWhere`). */
function dropPages(s: TabsState, gone: (p: string) => boolean): TabsState {
  return closeWhere(inStacks(s.history, gone) ? { ...s, history: remapStacks(s.history, (p) => (gone(p) ? null : p)) } : s, gone)
}

/** `path` is the folder `dir` itself — a folder is a tab too (YAZ-2290 D3) — or sits below it. */
const atOrUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`)

/** Pure; returns the SAME state object for a no-op so callers can skip the identity mirror. */
export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open-current': {
      if (s.blank) return fillBlank(s, a.path)
      // Open already: go to its tab, never duplicate (S7). The active tab that shows it is a no-op.
      const open = tabOf(s, a.path)
      if (open !== null) return open.id === s.active ? s : withActive(s, open.id)
      // No preview tab yet: the page gets one, at the end of the strip. A kept tab is never replaced (YAZ-2648 D1).
      if (s.preview === null) return appendActive(s, a.path, true)
      // The page takes the PREVIEW tab's slot, wherever it stands, and that tab becomes the active one.
      return replaceSlot(s, s.preview, a.path)
    }
    case 'navigate': {
      // A link inside a page (YAZ-2648 D3): the page opens in the tab the link was clicked in, and
      // Back returns. The rule `open-current` had before the preview tab. The blank tab has no page
      // and so no link: a page that opens while it is active fills it, like any other.
      if (s.blank) return fillBlank(s, a.path)
      const open = tabOf(s, a.path)
      if (open !== null) return open.id === s.active ? s : withActive(s, open.id)
      if (s.active === null) return appendActive(s, a.path, false)
      return replaceSlot(s, s.active, a.path)
    }
    case 'open-new': {
      // A kept tab is asked for (YAZ-2648 D2): the preview tab that shows the page loses its mark first.
      const kept = tabById(s, s.preview)?.path === a.path ? { ...s, preview: null } : s
      if (kept.blank) return fillBlank(kept, a.path)
      const open = tabOf(kept, a.path)
      if (open !== null) return open.id === kept.active ? kept : withActive(kept, open.id)
      return appendActive(s, a.path, false)
    }
    case 'open-background': {
      if (shows(s, a.path)) return s // already open: stay where we are, steal nothing
      // The first tab of an empty window must activate: non-empty `tabs` requires a non-null `file`.
      // Under the blank tab too (YAZ-2655 S78): the page becomes the stored file, and the blank tab still shows.
      if (s.active === null) return { ...appendActive(s, a.path, false), blank: s.blank }
      return { ...s, tabs: [...s.tabs, newTab(a.path)] } // not mounted: the editor lazy-mounts on first activation
    }
    case 'duplicate': {
      // A copy (YAZ-2940 D6, S1, S3, S4): a new id on the same page, right after the source, active and
      // mounted, with the source's stack (none when it has none — the lazy default; a stack is never
      // changed in place, so the two share it until one of them moves). A preview source is kept, and so
      // is the copy. A copy of a copy is a copy like any other. A trip to a tab drops an unused blank tab.
      const i = s.tabs.findIndex((t) => t.id === a.id)
      if (i === -1) return s
      const copy = newTab(s.tabs[i].path)
      const h = s.history[a.id]
      return { tabs: insertAt(s.tabs, copy, i + 1), active: copy.id, mounted: [...s.mounted, copy.id], history: h === undefined ? s.history : { ...s.history, [copy.id]: h }, preview: s.preview === a.id ? null : s.preview, blank: false }
    }
    case 'take':
      // A moved tab (YAZ-3091 D5, S11, S13): never a trip to the tab that is open, so its name and page view
      // are not lost. Under the blank tab this is `fillBlank` for a page that is not open: the page fills it.
      return appendActive(s, a.path, false)
    case 'keep':
      // Nothing stored changes, so the caller mirrors nothing (YAZ-2648 D4).
      return a.id === s.preview ? { ...s, preview: null } : s
    case 'set-name': {
      // Stored with the window (YAZ-3057). Trimmed and cut like a vault's display
      // name (S5); empty is no name (S4). A preview tab that gets a name is kept (S8).
      const i = s.tabs.findIndex((t) => t.id === a.id)
      if (i === -1) return s
      const name = cleanVaultName(a.name)
      if (name === (s.tabs[i].name ?? null)) return s
      const tab: Tab = name === null ? { id: a.id, path: s.tabs[i].path } : { ...s.tabs[i], name }
      return { ...s, tabs: s.tabs.map((t, j) => (j === i ? tab : t)), preview: s.preview === a.id && name !== null ? null : s.preview }
    }
    case 'new-tab':
      // One blank tab at most (YAZ-2655 D10). Nothing stored changes, so the caller mirrors nothing.
      return s.blank ? s : { ...s, blank: true }
    case 'close-blank':
      return s.blank ? { ...s, blank: false } : s
    case 'activate':
      // The tab that was active under the blank tab is a tab to go to, like any other (S73).
      return (a.id === s.active && !s.blank) || tabById(s, a.id) === null ? s : withActive(s, a.id)
    case 'back':
    case 'forward': {
      // The step lands in the ACTIVE tab's slot, like any same-tab navigation — but records
      // nothing: the stack is walked, not extended. A target already open in ANOTHER tab
      // goes to that tab instead (`tabOf`, S8), leaving both stacks alone.
      // The blank tab has no stack (YAZ-2655): under it the arrows have nowhere to go.
      if (s.active === null || s.blank) return s
      const h = s.history[s.active]
      if (h === undefined) return s
      const i = h.index + (a.type === 'back' ? -1 : 1)
      if (i < 0 || i >= h.entries.length) return s
      const open = tabOf(s, h.entries[i])
      return open !== null ? withActive(s, open.id) : replaceSlot(s, s.active, h.entries[i], { entries: h.entries, index: i })
    }
    case 'close': {
      const i = s.tabs.findIndex((t) => t.id === a.id)
      if (i === -1) return s
      const history = { ...s.history }
      delete history[a.id] // the tab's stack closes with it
      const rest: TabsState = {
        tabs: s.tabs.filter((t) => t.id !== a.id),
        active: s.active,
        mounted: s.mounted.filter((t) => t !== a.id),
        history,
        preview: s.preview === a.id ? null : s.preview,
        blank: s.blank,
      }
      if (a.id !== s.active) return rest
      // ⌘W ladder (rule 7): the right neighbour takes over, else the left; closing the last
      // tab leaves the empty state — the window stays alive (App escalates to closeSelf only
      // on a ⌘W with zero tabs). A tab closed under the blank tab is no trip to its heir: the heir
      // is the stored file, and the blank tab still shows.
      const heir = s.tabs[i + 1] ?? s.tabs[i - 1] ?? null
      return heir === null ? { ...rest, active: null } : { ...withActive({ ...rest, active: null }, heir.id), blank: s.blank }
    }
    case 'close-many':
      // One fold over `close`, as `delete-dir` does: the heir is whatever is left when all of them are gone.
      return a.ids.reduce((acc, id) => tabsReducer(acc, { type: 'close', id }), s)
    case 'move': {
      // Reorder only: `active` and `mounted` are untouched — dragging never activates a tab.
      // A preview tab that is given a place is kept (YAZ-2648 D2).
      const to = Math.max(0, Math.min(a.to, s.tabs.length - 1))
      if (a.from < 0 || a.from >= s.tabs.length || a.from === to) return s
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(a.from, 1)
      tabs.splice(to, 0, moved)
      return { ...s, tabs, preview: moved.id === s.preview ? null : s.preview }
    }
    case 'cycle': {
      // From the blank tab, which stands last (YAZ-2655): on to the first tab, back to the last real one.
      if (s.blank) return s.tabs.length === 0 ? s : withActive(s, s.tabs[a.dir === 1 ? 0 : s.tabs.length - 1].id)
      if (s.active === null || s.tabs.length < 2) return s
      const i = s.tabs.findIndex((t) => t.id === s.active)
      return withActive(s, s.tabs[(i + a.dir + s.tabs.length) % s.tabs.length].id)
    }
    case 'open-stored': {
      // A restore (YAZ-3147 D3, S16–S19, S27): each page that no tab shows joins the end in the saved
      // order, with its copies and display names, as kept tabs. A page that is open opens no copy (S18,
      // S19): the check is against the strip as it was, so two saved copies of a closed page both open.
      const open = new Set(s.tabs.map((t) => t.path))
      const added: Tab[] = []
      let marked: string | null = null
      for (const t of a.tabs) {
        if (open.has(t.path)) continue
        const tab = t.name === undefined ? newTab(t.path) : { ...newTab(t.path), name: t.name }
        if (t.active === true && marked === null) marked = tab.id
        added.push(tab)
      }
      // The session's active tab is active: its new copy, else the open tab of its page (S18). With no
      // mark, an empty window takes the first new tab (a strip with tabs needs an active one), and a window with tabs keeps its own.
      const page = a.tabs.find((t) => t.active === true)?.path
      const active = marked ?? (page === undefined ? null : (tabOf(s, page)?.id ?? null)) ?? (s.active === null ? (added[0]?.id ?? null) : null)
      // A page of the session that shows in the preview tab is kept now: the next sidebar click must not replace it.
      const kept = s.preview !== null && a.tabs.some((t) => t.path === tabById(s, s.preview)?.path) ? null : s.preview
      if (added.length === 0 && kept === s.preview && (active === null || (active === s.active && !s.blank))) return s
      const grown: TabsState = { ...s, tabs: [...s.tabs, ...added], preview: kept }
      return active === null ? grown : withActive(grown, active)
    }
    case 'reset': {
      if (a.active === null) return s.tabs.length === 0 && s.active === null && s.mounted.length === 0 && !s.blank ? s : EMPTY
      // An active file missing from the list is PREPENDED — main's own normalization order. Every tab gets a new id.
      // Copies and display names come back (YAZ-3057): the list is the stored strip, not a set. The marked
      // copy of the active file is active, else its first copy (D4).
      const stored = a.tabs.some((t) => t.path === a.active) ? a.tabs : [{ path: a.active }, ...a.tabs]
      const tabs = stored.map(({ path, name }): Tab => (name === undefined ? newTab(path) : { ...newTab(path), name }))
      const marked = stored.findIndex((t) => t.path === a.active && t.active === true)
      const active = tabs[marked !== -1 ? marked : stored.findIndex((t) => t.path === a.active)].id
      return { tabs, active, mounted: [active], history: {}, preview: null, blank: false }
    }
    case 'rename':
      // EVERY tab of the file follows it in place (Links E1, YAZ-2940 S17). Two tabs of one path are
      // valid, so a tab whose new path is open already stays too. A file that no tab shows may still
      // move in a stack further back.
      return remapPages(s, (p) => (p === a.oldPath ? a.newPath : p))
    case 'delete':
      // Deleting a tab IS closing it, from the user's point of view — so reuse the `close`
      // case rather than re-implementing the heir ladder. Divergence between the two would
      // show up as "deleting the active note picks a different tab than ⌘W does", which is
      // the kind of inconsistency nobody reports but everybody feels. Every tab of the file
      // closes (S18), and the page leaves every other tab's stack.
      return dropPages(s, (p) => p === a.path)
    case 'delete-dir':
      // The folder's own tab (YAZ-2290 D3) and every tab under it close, left to right, each
      // through the SAME ladder. The fold means the heir is whatever survives after all of them
      // are gone.
      return dropPages(s, (p) => atOrUnder(p, a.path))
    case 'rename-dir':
      // A FOLDER moved (E1b): its own tab (YAZ-2290 D3) and every tab under `oldPath/` follow by
      // prefix, as `rename` (S19); a stack further back may still point inside it.
      return remapPages(s, (p) => (atOrUnder(p, a.oldPath) ? a.newPath + p.slice(a.oldPath.length) : p))
  }
}

const rightDefault = (): Pick<WorkspaceState, 'rightPanel' | 'rightMounted' | 'rightHistory'> => ({
  rightPanel: defaultRightPanelIdentity(),
  rightMounted: [],
  rightHistory: {},
})

const withMain = (s: WorkspaceState, main: TabsState): WorkspaceState => ({ ...s, ...main })

function closeRight(s: WorkspaceState, path: string): WorkspaceState {
  const i = s.rightPanel.items.indexOf(path)
  if (i === -1) return s
  const items = s.rightPanel.items.filter((item) => item !== path)
  const expanded = s.rightPanel.expanded === path
    ? (s.rightPanel.items[i + 1] ?? s.rightPanel.items[i - 1] ?? null)
    : s.rightPanel.expanded
  const rightHistory = { ...s.rightHistory }
  delete rightHistory[path]
  return {
    ...s,
    rightPanel: { ...s.rightPanel, items, expanded },
    rightMounted: s.rightMounted.filter((item) => item !== path),
    rightHistory,
  }
}

/** `item` at index `at` (clamped), moved there when it is in `items` already. */
function insertAt<T>(items: readonly T[], item: T, at = items.length): T[] {
  const next = items.filter((one) => one !== item)
  next.splice(Math.max(0, Math.min(at, next.length)), 0, item)
  return next
}

function openRight(s: WorkspaceState, path: string, foreground: boolean, at?: number): WorkspaceState {
  // One owner per file between the two areas (YAZ-2940 S15): EVERY main tab of the page closes.
  const main = closeWhere(s, (p) => p === path)
  const alreadyRight = s.rightPanel.items.includes(path)
  const items = alreadyRight && at === undefined ? s.rightPanel.items : insertAt(s.rightPanel.items, path, at)
  const expanded = foreground ? path : s.rightPanel.expanded
  const rightMounted = foreground && !s.rightMounted.includes(path) ? [...s.rightMounted, path] : s.rightMounted
  if (main === s && alreadyRight && s.rightPanel.open && expanded === s.rightPanel.expanded && items === s.rightPanel.items && rightMounted === s.rightMounted) return s
  return {
    ...s,
    ...main,
    rightPanel: { ...s.rightPanel, open: true, items, expanded },
    rightMounted,
  }
}

function navigateRight(s: WorkspaceState, from: string, to: string, historyIndex?: number): WorkspaceState {
  const fromIndex = s.rightPanel.items.indexOf(from)
  if (fromIndex === -1 || from === to) return s
  if (s.rightPanel.items.includes(to)) {
    return { ...s, rightPanel: { ...s.rightPanel, expanded: to } }
  }
  const main = closeWhere(s, (p) => p === to)
  const items = [...s.rightPanel.items]
  items[fromIndex] = to
  const prior = s.rightHistory[from] ?? { entries: [from], index: 0 }
  const record = historyIndex === undefined
    ? { entries: [...prior.entries.slice(0, prior.index + 1), to], index: prior.index + 1 }
    : { entries: prior.entries, index: historyIndex }
  const rightHistory = { ...s.rightHistory }
  delete rightHistory[from]
  rightHistory[to] = record
  return {
    ...s,
    ...main,
    rightPanel: { ...s.rightPanel, items, expanded: to },
    rightMounted: [...s.rightMounted.filter((item) => item !== from), to],
    rightHistory,
  }
}

function repairRightPaths(
  s: WorkspaceState,
  main: TabsState,
  map: (path: string) => string | null,
): WorkspaceState {
  const mainPaths = new Set(storedTabs(main.tabs))
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of s.rightPanel.items) {
    const next = map(item)
    if (next === null || mainPaths.has(next) || seen.has(next)) continue
    seen.add(next)
    items.push(next)
  }
  const mappedExpanded = s.rightPanel.expanded === null ? null : map(s.rightPanel.expanded)
  let expanded = mappedExpanded !== null && items.includes(mappedExpanded) ? mappedExpanded : null
  if (expanded === null && s.rightPanel.expanded !== null) {
    const i = s.rightPanel.items.indexOf(s.rightPanel.expanded)
    const heirCandidates = [...s.rightPanel.items.slice(i + 1), ...s.rightPanel.items.slice(0, i).reverse()]
    expanded = heirCandidates.map(map).find((path): path is string => path !== null && items.includes(path)) ?? null
  }
  const rightMounted = [...new Set(s.rightMounted.map(map).filter((path): path is string => path !== null && items.includes(path)))]
  const repairedHistory = rekey(s.rightHistory, map)
  const rightHistory = Object.fromEntries(Object.entries(repairedHistory).filter(([key]) => items.includes(key)))
  return { ...s, ...main, rightPanel: { ...s.rightPanel, items, expanded }, rightMounted, rightHistory }
}

/** One pure owner for main tabs, right headers, both histories, and all lifecycle repair. */
export function workspaceReducer(s: WorkspaceState, a: WorkspaceAction): WorkspaceState {
  switch (a.type) {
    case 'open-right':
      return openRight(s, a.path, true, a.at)
    case 'open-right-background':
      return openRight(s, a.path, false, a.at)
    case 'transfer-main-to-right':
      return shows(s, a.path) ? openRight(s, a.path, true, a.at) : s
    case 'transfer-right-to-main': {
      if (!s.rightPanel.items.includes(a.path)) return s
      const without = closeRight(s, a.path)
      // A right page is never a main tab (one owner), so the page gets a new tab at the exact slot.
      const tab = newTab(a.path)
      return {
        ...without,
        tabs: insertAt(without.tabs, tab, a.at),
        active: tab.id,
        mounted: [...without.mounted, tab.id],
        // The page is the active tab now: a trip to a tab, which drops an unused blank tab (YAZ-2655).
        blank: false,
      }
    }
    case 'navigate-right':
      return navigateRight(s, a.from, a.to)
    case 'toggle-right': {
      if (!s.rightPanel.items.includes(a.path)) return s
      const expanded = s.rightPanel.expanded === a.path ? null : a.path
      return {
        ...s,
        rightPanel: { ...s.rightPanel, expanded },
        rightMounted: expanded !== null && !s.rightMounted.includes(expanded) ? [...s.rightMounted, expanded] : s.rightMounted,
      }
    }
    case 'close-right':
      return closeRight(s, a.path)
    case 'move-right': {
      const to = Math.max(0, Math.min(a.to, s.rightPanel.items.length - 1))
      if (a.from < 0 || a.from >= s.rightPanel.items.length || a.from === to) return s
      const items = [...s.rightPanel.items]
      const [moved] = items.splice(a.from, 1)
      items.splice(to, 0, moved)
      return { ...s, rightPanel: { ...s.rightPanel, items } }
    }
    case 'right-back':
    case 'right-forward': {
      const current = s.rightPanel.expanded
      if (current === null) return s
      const history = s.rightHistory[current]
      if (history === undefined) return s
      const index = history.index + (a.type === 'right-back' ? -1 : 1)
      if (index < 0 || index >= history.entries.length) return s
      const target = history.entries[index]
      if (s.rightPanel.items.includes(target)) return { ...s, rightPanel: { ...s.rightPanel, expanded: target } }
      return navigateRight(s, current, target, index)
    }
    case 'set-right-open':
      return a.open === s.rightPanel.open ? s : { ...s, rightPanel: { ...s.rightPanel, open: a.open } }
    case 'set-right-width':
      return a.width === s.rightPanel.width ? s : { ...s, rightPanel: { ...s.rightPanel, width: a.width } }
    case 'reset': {
      const main = tabsReducer(s, a)
      if (main === s && s.rightPanel.items.length === 0 && !s.rightPanel.open) return s
      return { ...s, ...main, ...rightDefault() }
    }
    case 'rename': {
      if (a.oldPath === a.newPath) return s
      const map = (path: string) => path === a.oldPath ? a.newPath : path
      const main = tabsReducer(s, a)
      const rightReferenced = s.rightPanel.items.includes(a.oldPath)
        || s.rightMounted.includes(a.oldPath)
        || Object.values(s.rightHistory).some((history) => history.entries.includes(a.oldPath))
      return main === s && !rightReferenced ? s : repairRightPaths(s, main, map)
    }
    case 'rename-dir': {
      if (a.oldPath === a.newPath) return s
      const moved = (path: string) => atOrUnder(path, a.oldPath)
      const map = (path: string) => moved(path) ? a.newPath + path.slice(a.oldPath.length) : path
      const main = tabsReducer(s, a)
      const rightReferenced = s.rightPanel.items.some(moved)
        || Object.values(s.rightHistory).some((history) => history.entries.some(moved))
      return main === s && !rightReferenced ? s : repairRightPaths(s, main, map)
    }
    case 'delete': {
      const map = (path: string) => path === a.path ? null : path
      const main = tabsReducer(s, a)
      const rightReferenced = s.rightPanel.items.includes(a.path)
        || Object.values(s.rightHistory).some((history) => history.entries.includes(a.path))
      return main === s && !rightReferenced ? s : repairRightPaths(s, main, map)
    }
    case 'delete-dir': {
      const gone = (path: string) => atOrUnder(path, a.path)
      const map = (path: string) => gone(path) ? null : path
      const main = tabsReducer(s, a)
      const rightReferenced = s.rightPanel.items.some(gone)
        || Object.values(s.rightHistory).some((history) => history.entries.some(gone))
      return main === s && !rightReferenced ? s : repairRightPaths(s, main, map)
    }
    case 'open-stored': {
      // A page on the right panel is open too (one owner per file, YAZ-2940 S15): it stays there and opens no main tab (YAZ-3147 D3).
      const tabs = a.tabs.filter((t) => !s.rightPanel.items.includes(t.path))
      const main = tabsReducer(s, tabs.length === a.tabs.length ? a : { type: 'open-stored', tabs })
      return main === s ? s : withMain(s, main)
    }
    case 'open-current':
    case 'navigate':
    case 'open-new':
    case 'open-background':
    case 'take': {
      const withoutRight = s.rightPanel.items.includes(a.path) ? closeRight(s, a.path) : s
      const main = tabsReducer(withoutRight, a)
      return main === withoutRight ? withoutRight : withMain(withoutRight, main)
    }
    default: {
      const main = tabsReducer(s, a)
      return main === s ? s : withMain(s, main)
    }
  }
}

/**
 * The boot state (rule 15): `storage`'s identity is valid AT BOOT only (`storage.init()`
 * resolves before the first render). Active-file precedence (GRO-2069/2160): a pasted
 * `#/abs/path` hash wins, then this window's restored file, then the folder's remembered
 * lastFile; a hash file missing from the stored tabs is added (rule 12). Only the active
 * tab's editor mounts.
 */
export function bootTabs(root: string | null): TabsState {
  if (root === null) return EMPTY
  const active = hashFilePath(location.hash) ?? storage.getFile() ?? storage.getLastFile(root)
  // The copies and display names come back with the window (YAZ-3057), and with a tab "Move to new window" brought (S19).
  return tabsReducer(EMPTY, { type: 'reset', tabs: storage.getTabStrip(), active })
}

export function bootWorkspace(root: string | null): WorkspaceState {
  const main = bootTabs(root)
  if (root === null) return { ...main, ...rightDefault() }
  const stored = storage.getRightPanel()
  const mainPaths = new Set(storedTabs(main.tabs))
  const items = stored.items.filter((path) => !mainPaths.has(path))
  const expanded = stored.expanded !== null && items.includes(stored.expanded) ? stored.expanded : null
  return {
    ...main,
    rightPanel: { ...stored, items, expanded },
    rightMounted: expanded === null ? [] : [expanded],
    rightHistory: {},
  }
}

export interface UseWorkspace extends WorkspaceState {
  /** The active tab's path (`activePath`): the window's `file` — title, URL hash, sidebar highlight, every file call. */
  file: string | null
  /**
   * Rule 11, as YAZ-2648 D1 has it: a sidebar single click (Files, Search, Favorites, Focus) and a
   * deep link open the page in the PREVIEW tab. A kept tab is never replaced.
   */
  openCurrent: (path: string) => void
  /** A link inside a tab's page (YAZ-2648 D3): the page takes the ACTIVE tab's slot, and Back returns. */
  navigate: (path: string) => void
  /**
   * Rule 5, and a double click on a sidebar row (YAZ-2648 D2): the page is a KEPT tab — appended at
   * the end and activated when it is not open, and the preview tab the first click made keeps its page.
   */
  openKept: (path: string) => void
  /** "Duplicate tab" (YAZ-2940 D6): a copy of that tab, right after it and active; the copy's id, or null for an unknown tab. */
  duplicate: (id: string) => string | null
  /** A tab another window moved here (YAZ-3091 D5): a new kept tab at the end, active, a copy when the page is open; a right-panel page leaves the panel. The new tab's id. */
  take: (path: string) => string
  /** The preview tab (by id) becomes a kept tab (YAZ-2648 D2): a double click on it, the first edit of its page. A no-op for any other tab. */
  keep: (id: string) => void
  /** "Set display name" / "Reset to page name" (YAZ-2949): a name for this tab, or null for its page name. Never stored. */
  setName: (id: string, name: string | null) => void
  /** ⌘T, the strip's "+" (YAZ-2655 D10): the one blank tab shows; a second call changes nothing. Never mirrored. */
  newTab: () => void
  /** The blank tab's ✕: it goes, and the tab that was active before is active again (S75). Never mirrored. */
  closeBlank: () => void
  /** Rule 5: append at the end without activating (and so without stealing focus). */
  openBackground: (path: string) => void
  /** A tab, by id (YAZ-2940 D1). */
  activate: (id: string) => void
  /** That tab only: a copy closes alone (S11). */
  close: (id: string) => void
  /** The tab board's closes of several tabs (YAZ-2648 D9, D15), by id: each as `close`, and ONE identity write for all of them. */
  closeMany: (ids: readonly string[]) => void
  /** "Restore session" (YAZ-3147 D3): the stored tabs whose page is not open join the end, ONE change and ONE identity write (S27). */
  openStored: (tabs: readonly StoredTab[]) => void
  /** Drag-to-reorder (I3): the tab at `from` lands at final index `to`; activation untouched. */
  move: (from: number, to: number) => void
  /** ⌘W: closes the active tab — the blank tab alone, while it shows (YAZ-2655 S75); false when there is none (App escalates to `closeSelf`). */
  closeActive: () => boolean
  next: () => void
  prev: () => void
  /** YAZ-721 D1: step the ACTIVE tab through its own stack; no-ops at either bound. */
  back: () => void
  forward: () => void
  /** Whether that step exists — the toolbar arrows' enabled state. */
  canBack: boolean
  canForward: boolean
  /** The root switched to `nextRoot` (rule 13): replace the list with the restored file, or nothing. */
  reset: (nextRoot: string | null, file: string | null) => void
  /** An in-app rename landed (`file:renamed`, Links E1): remap every tab of the file in place (S17); no-op when absent. */
  renamePath: (oldPath: string, newPath: string) => void
  /**
   * A FOLDER rename landed (`file:renamed` kind `dir`, Links E1b — GRO-2241): remap every
   * tab under the old prefix in place. `nextRoot` overrides the mirror's root when THIS
   * window's own root moved with the folder (a subfolder opened as a vault) — the mirror's
   * lastFile write then lands under the repaired root, not a stale entry.
   */
  renameDirPath: (oldPath: string, newPath: string, nextRoot?: string) => void
  /** A delete landed (`file:deleted`, GRO-2272): drop every tab of the file (S18); the active one closes to its heir. */
  deletePath: (path: string) => void
  /**
   * A FOLDER delete landed (`file:deleted` kind `dir`): drop every tab under the prefix. `nextRoot`,
   * as above: the folder was this window's first vault, which left the window, and the mirror's
   * lastFile write lands under the vault that is first now (YAZ-2602 S52).
   */
  deleteDirPath: (path: string, nextRoot?: string) => void
  openRight: (path: string, at?: number) => void
  openRightBackground: (path: string, at?: number) => void
  navigateRight: (from: string, to: string) => void
  toggleRight: (path: string) => void
  closeRight: (path: string) => void
  moveRight: (from: number, to: number) => void
  transferMainToRight: (path: string, at: number) => void
  transferRightToMain: (path: string, at: number) => void
  rightBack: () => void
  rightForward: () => void
  canRightBack: boolean
  canRightForward: boolean
  setRightOpen: (open: boolean) => void
  setRightWidth: (width: number) => void
}

export function useWorkspace(root: string | null): UseWorkspace {
  const [state, setState] = useState<WorkspaceState>(() => bootWorkspace(root))
  // Dispatch reads/writes the ref so consecutive dispatches in one event see each other; the
  // mirror side effect stays OUT of the setState updater (StrictMode double-invokes updaters).
  const stateRef = useRef(state)
  const rootRef = useRef(root)
  rootRef.current = root

  const dispatch = useCallback((action: WorkspaceAction, opts?: { root?: string | null; mirror?: boolean }): void => {
    const prevState = stateRef.current
    const nextState = workspaceReducer(prevState, action)
    if (nextState === prevState) return
    for (const path of storedTabs(prevState.tabs)) {
      if (nextState.rightPanel.items.includes(path)) carryEditorAcrossPane(path)
    }
    for (const path of prevState.rightPanel.items) {
      if (shows(nextState, path)) carryEditorAcrossPane(path)
    }
    // A switch between two copies of one file (YAZ-2940 D4, S22) — a click, ⌃Tab, the board, a close to
    // its heir, a duplicate: the copy left behind saves now, and its save reaches the twin at once (`twinEditors.ts`).
    const was = activePath(prevState)
    if (nextState.active !== prevState.active && was !== null && was === activePath(nextState)) void flushRenamedPath(was)
    stateRef.current = nextState
    setState(nextState)
    // ONE explicit write per durable change carries both owners and the active main file. The strip keeps
    // copies and display names (YAZ-3057); storage derives `tabs` from it, each path once.
    if (opts?.mirror !== false) storage.setWorkspace(opts?.root !== undefined ? opts.root : rootRef.current, tabStrip(nextState), activePath(nextState), nextState.rightPanel)
  }, [])

  const openCurrent = useCallback((path: string) => dispatch({ type: 'open-current', path }), [dispatch])
  const navigate = useCallback((path: string) => dispatch({ type: 'navigate', path }), [dispatch])
  // `keep` changes no stored field (the mark is session-only, D4), so it is never mirrored — and
  // neither is `open-new` on the page the active preview tab shows, which only takes its mark off.
  const keep = useCallback((id: string) => dispatch({ type: 'keep', id }, { mirror: false }), [dispatch])
  // A display name is stored with the window (YAZ-3057): one write, like any other tab change.
  const setName = useCallback((id: string, name: string | null) => dispatch({ type: 'set-name', id, name }), [dispatch])
  const openKept = useCallback(
    (path: string) => {
      const s = stateRef.current
      dispatch({ type: 'open-new', path }, { mirror: !(s.preview === s.active && activePath(s) === path) })
    },
    [dispatch],
  )
  // A copy is stored with the window (YAZ-3057): one write, like any other tab change.
  const duplicate = useCallback((id: string): string | null => {
    const s = stateRef.current
    dispatch({ type: 'duplicate', id })
    return stateRef.current === s ? null : stateRef.current.active
  }, [dispatch])
  // A moved tab is stored with the window (YAZ-3091 D5), like any new tab: the caller then names it and gives it its page view.
  const take = useCallback((path: string): string => {
    dispatch({ type: 'take', path })
    return stateRef.current.active as string
  }, [dispatch])
  const openBackground = useCallback((path: string) => dispatch({ type: 'open-background', path }), [dispatch])
  const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), [dispatch])
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), [dispatch])
  const closeMany = useCallback((ids: readonly string[]) => dispatch({ type: 'close-many', ids }), [dispatch])
  const openStored = useCallback((tabs: readonly StoredTab[]) => dispatch({ type: 'open-stored', tabs }), [dispatch])
  const move = useCallback((from: number, to: number) => dispatch({ type: 'move', from, to }), [dispatch])
  // The blank tab is in no stored field (YAZ-2655 D10): showing it and closing it mirror nothing.
  const newTab = useCallback(() => dispatch({ type: 'new-tab' }, { mirror: false }), [dispatch])
  const closeBlank = useCallback(() => dispatch({ type: 'close-blank' }, { mirror: false }), [dispatch])
  const closeActive = useCallback((): boolean => {
    if (stateRef.current.blank) {
      closeBlank()
      return true
    }
    const active = stateRef.current.active
    if (active === null) return false
    dispatch({ type: 'close', id: active })
    return true
  }, [dispatch, closeBlank])
  const next = useCallback(() => dispatch({ type: 'cycle', dir: 1 }), [dispatch])
  const prev = useCallback(() => dispatch({ type: 'cycle', dir: -1 }), [dispatch])
  const back = useCallback(() => dispatch({ type: 'back' }), [dispatch])
  const forward = useCallback(() => dispatch({ type: 'forward' }), [dispatch])
  const reset = useCallback(
    (nextRoot: string | null, file: string | null) =>
      // An empty reset mirrors nothing: `storage.setRoot` already wrote {root, file: null,
      // tabs: []} in ONE identity patch (rule 13). A restored file is one {tabs, file} write
      // against the NEW root (App's root state has not re-rendered yet, hence explicit).
      dispatch({ type: 'reset', tabs: [], active: file }, { root: nextRoot, mirror: file !== null }),
    [dispatch],
  )
  const renamePath = useCallback((oldPath: string, newPath: string) => dispatch({ type: 'rename', oldPath, newPath }), [dispatch])
  const renameDirPath = useCallback(
    (oldPath: string, newPath: string, nextRoot?: string) =>
      dispatch({ type: 'rename-dir', oldPath, newPath }, nextRoot !== undefined ? { root: nextRoot } : undefined),
    [dispatch],
  )

  const deletePath = useCallback((path: string) => dispatch({ type: 'delete', path }), [dispatch])
  const deleteDirPath = useCallback(
    (path: string, nextRoot?: string) => dispatch({ type: 'delete-dir', path }, nextRoot !== undefined ? { root: nextRoot } : undefined),
    [dispatch],
  )
  const openRightCallback = useCallback((path: string, at?: number) => dispatch({ type: 'open-right', path, at }), [dispatch])
  const openRightBackground = useCallback((path: string, at?: number) => dispatch({ type: 'open-right-background', path, at }), [dispatch])
  const navigateRightCallback = useCallback((from: string, to: string) => dispatch({ type: 'navigate-right', from, to }), [dispatch])
  const toggleRight = useCallback((path: string) => dispatch({ type: 'toggle-right', path }), [dispatch])
  const closeRightCallback = useCallback((path: string) => dispatch({ type: 'close-right', path }), [dispatch])
  const moveRight = useCallback((from: number, to: number) => dispatch({ type: 'move-right', from, to }), [dispatch])
  const transferMainToRight = useCallback((path: string, at: number) => dispatch({ type: 'transfer-main-to-right', path, at }), [dispatch])
  const transferRightToMain = useCallback((path: string, at: number) => dispatch({ type: 'transfer-right-to-main', path, at }), [dispatch])
  const rightBack = useCallback(() => dispatch({ type: 'right-back' }), [dispatch])
  const rightForward = useCallback(() => dispatch({ type: 'right-forward' }), [dispatch])
  const setRightOpen = useCallback((open: boolean) => dispatch({ type: 'set-right-open', open }), [dispatch])
  const setRightWidth = useCallback((width: number) => dispatch({ type: 'set-right-width', width }), [dispatch])

  const h: TabHistory | undefined = state.history[state.active ?? '']
  const rightH: TabHistory | undefined = state.rightHistory[state.rightPanel.expanded ?? '']
  return {
    ...state,
    file: activePath(state),
    openCurrent, navigate, openKept, duplicate, take, keep, setName, newTab, closeBlank, openBackground, activate, close, closeMany, openStored, move, closeActive, next, prev, back, forward, reset, renamePath, renameDirPath, deletePath, deleteDirPath,
    openRight: openRightCallback,
    openRightBackground,
    navigateRight: navigateRightCallback,
    toggleRight,
    closeRight: closeRightCallback,
    moveRight,
    transferMainToRight,
    transferRightToMain,
    rightBack,
    rightForward,
    setRightOpen,
    setRightWidth,
    // The blank tab has no stack of its own (YAZ-2655): the arrows are off while it shows.
    canBack: !state.blank && h !== undefined && h.index > 0,
    canForward: !state.blank && h !== undefined && h.index < h.entries.length - 1,
    canRightBack: rightH !== undefined && rightH.index > 0,
    canRightForward: rightH !== undefined && rightH.index < rightH.entries.length - 1,
  }
}
