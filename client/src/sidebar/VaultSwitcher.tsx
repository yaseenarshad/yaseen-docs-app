/**
 * The sidebar header's vault switcher (YAZ-1767): GitHub Desktop's repository panel, keyboard-first.
 * The header's top-left button is the trigger — bold vault name plus a small chevron (D6) — and the
 * panel it drops is a `ContextMenuSurface` hung off the header's own rect (D5), flush with the
 * sidebar and at least as wide — wider when a name needs it, so no name is ever cut (YAZ-1974 D7).
 * Its first element is the filter input, autofocused, query reset on every open (D7);
 * below it every vault as ONE line — name, then relative time (YAZ-1974 D2) — the CURRENT
 * vault included and marked `aria-current` (D3); and LAST, under a hairline, "Open folder…" — the
 * folder picker (D4), which opens the picked folder beside like a vault row does (YAZ-1914
 * amended D4 — it was in place). Two vaults can share a name, so the full path is one hover away:
 * a row's ⓘ, shown while the row is hovered, draws the WHOLE path wrapped at its slashes in a
 * tooltip portalled to <body> — the panel's scroll box never clips it. Mouse-only, by design.
 *
 * Two groups (YAZ-2555 D1): the vaults that have a window stand first, under a small "Open" label;
 * then a hairline and "Not open". The labels are not rows — never focused, never highlighted. The
 * rows (A1) are `listVaults`'s (shared with `yaseendocs vaults`, YAZ-2556 D2): the recents, plus every open vault,
 * plus every vault that has a number: each group is the recents in last-used order, then — with no
 * time, they have none — "Open" the open vaults that fell out of the recents, "Not open" the
 * numbered ones, in number order. A numbered row wears its key, `⌘<n>`, between the name and the
 * ⓘ (D4), always: ⌘<n> works with the panel up or down, so nothing is held to see it.
 *
 * ONE rule for every vault row (D1/D3): activating it — click or ⏎ — asks main's one open-recent
 * door, `window.openRecent(path)`, which brings that vault to the front: its open windows raised
 * (D9) or, with none, a NEW window on its remembered last file (D2) — and bumps the MRU either
 * way; the current vault's row simply raises this window. A folder that is gone answers `false`:
 * the row is disabled with "Folder not found" in the time slot and the panel STAYS open
 * (Welcome's behaviour), so the next choice is one keystroke away. `true` closes the panel.
 *
 * Names (YAZ-1974 D4): the trigger and every row show the vault's display name, the folder name
 * when none is set — the trigger through `storage.vaultName`, a row as `listVaults` names it. The
 * filter matches the display name AND the folder name (D6) — one row per vault, at its better rank.
 *
 * The keyboard model (D7): ranking is `matchLinkCandidates` over those names (the `[[` picker's
 * ranking: exact, then prefix, then substring; an empty query is MRU order), and the ranked rows
 * are then put in the two groups (YAZ-2555 A6) — a group with no match shows no label. One highlighted row;
 * with an EMPTY query it starts on the first row that is NOT the current vault — so ⌘O ⏎ jumps to
 * the last-used OTHER vault, an open one first, like ⌘Tab — with a typed query on the top row, and with no match on
 * Open folder…. ↑/↓ clamp at both ends (the `[[` picker's no-wrap rule), hover moves it too, ⏎
 * activates it — ⇧⏎ / ⇧-click open it IN this window instead, the menu's verb (YAZ-1974 D8), and
 * while ⇧ is held the highlighted row says so: "Open here" in its time slot (D9) — Esc
 * closes (the menu convention — not the search bar's two-press rule). Typing never leaves the input: rows swallow their own mousedown. "Open folder…" is not a candidate, so
 * it is visible whatever the query; a query with no vault match shows "No matching vaults" above it.
 *
 * ⌘O (D8): App bumps `openRequest`; each new value toggles the panel — opens it with the filter focused, or closes it.
 * Rows are read fresh from `storage` on every open, never cached across opens. The panel also closes
 * when its window loses focus (YAZ-2555 A4): ⌘<n> can take you to another window, and a panel left
 * up behind would show an old list. A row's menu and rename field go with it.
 *
 * Right-click (YAZ-1798): the trigger (= the current vault) and every live row open the vault
 * menu — `buildVaultMenuSections` drawn by the sidebar's own `ContextMenu`. "Open in this window"
 * is the ONE deliberate in-place switch (D8/D11); a `false` from it greys the row exactly like a
 * click's. The menu is the top layer while it stands (D4): Esc and click-away close it alone, and
 * the filter ignores ↑/↓/⏎/Esc until it is gone. Right-click never moves the highlight.
 *
 * "Set display name" (YAZ-1974 D5) turns the name into an inline field where it was right-clicked —
 * the header or the row, a `<div>` in place of the `<button>` meanwhile. ⏎ or blur saves, Esc
 * cancels, an empty field is the folder name again; the field is the top layer while it stands:
 * Esc and click-away end it alone, and a click on another row only ends it, never opens a vault.
 *
 * "Set shortcut" (YAZ-2555 D2) gives the vault a number, 1–9, in the same menu — the header's or a
 * row's: `storage.setVaultKey`, one vault per number — and the open panel's badges follow at once,
 * the one on the vault that lost the number too. "Remove from recent vaults" clears it (A2).
 *
 * Two or more vaults in the window (YAZ-2602 S15): the trigger names them, joined with " + " — two
 * names, then "+ N more" — or, while they are exactly a saved workspace, shows that workspace's
 * name; a click drops the same panel. "Current" is every vault of this window: each is marked
 * `aria-current`, the highlight starts on the first vault that is not one of them, and ⇧⏎ on one
 * is a plain open. A right-click on the trigger then shows one item, "Save as workspace…" (below):
 * the vault menu is one vault's, and the trigger is several. A vault that is not in the window gets
 * "Add to this window" (S8) above "Open in this window": App adds it beside the others and says why
 * when it cannot.
 *
 * Workspaces (YAZ-2602 D8): the saved sets of vaults — `vaultSets` in the code — stand FIRST, under
 * a "Workspaces" label, last used first: a name, and "N vaults" where a vault shows its time (S64).
 * With none saved the list has no such label. They are rows like the others: the filter matches the
 * name with the same ranking, and the highlight's index runs over them first — ↑ reaches them, and
 * a typed query starts on the top row, a workspace's when one matches. With an EMPTY query the
 * highlight starts below them, on a vault row: ⌘O ⏎ stays "the vault you used
 * last" (YAZ-2555), and a saved workspace never takes that key over. The workspace this window
 * shows is marked `aria-current`, like the current vault. Activating one asks main's `window.openSet`
 * (S65): `opened` closes the panel, and a folder that is gone is named in a notice; with no folder
 * left the row is disabled with "Folders not found" and the panel stays (S66). ⇧ means nothing on a
 * workspace: no cue, and ⇧⏎ is ⏎. Its menu is "Rename" — the display name's inline field, saved
 * through `window.renameSet`, an empty field or a name another workspace has changing nothing —
 * and "Remove from workspaces" (S67), and it stands on a dead row too: the workspace is still saved.
 *
 * "Save as workspace…" (S63), the header's one item with two or more vaults, turns the header's name
 * into that field, holding every vault name joined with " + ". ⏎ saves the window's vaults under
 * the name — as it stands, or edited — through `window.saveSet`; blur saves an edit only; Esc or an
 * empty field saves nothing. A name that exists replaces that workspace (S69); a new one when
 * MAX_VAULT_SETS are saved is refused with "Remove a workspace first" (S68). A window with one vault
 * has no such item (S70): its header's right-click is the vault menu.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { MAX_VAULT_SETS, cleanVaultName, sameVaults, type VaultEntry, type VaultSet } from '@shared/types'
import { api } from '../api'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { matchLinkCandidates } from '../links/completion'
import { basename } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { storage } from '../lib/storage'
import { TextField } from '../views/view/TextField'
import { InfoIcon, TriangleIcon } from '../views/view/icons'
import { ContextMenu } from './ContextMenu'
import { buildVaultMenuSections, buildVaultSetMenuSections } from './vaultMenuSections'

export interface VaultSwitcherProps {
  /** The vaults of this window, in the order they were added (YAZ-2602 D1); never empty. */
  roots: readonly string[]
  /** "Open folder…" (D4): App's folder picker — the picked vault opens beside, never in place (YAZ-1914). */
  onPickFolder: () => void
  /** True while the native folder dialog is open; the "Open folder…" row is disabled meanwhile. */
  pickDisabled: boolean
  /** ⌘O (D8): a counter App bumps per request; 0 = nothing requested. Each new value TOGGLES the panel — open with the filter focused, or close. */
  openRequest: number
  /** The menu's "Open in this window" (YAZ-1798 D8): App's in-place switch; `false` = the folder is gone (MRU already pruned). */
  onOpenHere: (path: string) => Promise<boolean>
  /** The menu's "Add to this window" (YAZ-2602 S8): App's add; `false` = not added, and App has said why. */
  onAddHere: (path: string) => Promise<boolean>
  /** The menu's OS verbs (D9): the Sidebar's own, stale-path notice included. */
  onReveal: (path: string) => void
  onOpenVsCode: (path: string) => void
  /** The Sidebar's passive notice — the copies confirm through it (D9). */
  onNotice: (message: string) => void
}

/**
 * One vault as the panel ranks and draws it: `listVaults`'s row (YAZ-2556 D2) plus `folder`, its
 * basename — the filter matches `name` (the display name) and `folder` (YAZ-1974 D6). `lastUsed`
 * null is an empty time slot (a vault that is not in the recents, YAZ-2555 A1), `open` puts the row
 * in the first group (D1), and `key` is its ⌘<key> badge (D4).
 */
export type VaultRow = VaultEntry & { folder: string }

/** Where a vault's name stands — and so where "Set display name" turns it into a field (YAZ-1974 D5). */
type RenameAt = 'header' | 'row'

interface PanelState {
  rows: VaultRow[]
  /** The saved workspaces (YAZ-2602 D8), read with the rows: last used first. */
  sets: VaultSet[]
  /** Captured once per open, so every row's relative time is measured against the same instant. */
  now: number
  anchor: { x: number; y: number; width: number }
}

export const NO_MATCH_TEXT = 'No matching vaults'
export const MISSING_TEXT = 'Folder not found'
export const OPEN_FOLDER_TEXT = 'Open folder…'
/** The highlighted row's time slot while ⇧ is held (YAZ-1974 D9): what ⇧⏎ / ⇧-click will do. */
export const OPEN_HERE_TEXT = 'Open here'
/** The two groups' labels (YAZ-2555 D1): the vaults that have a window, then the ones that have none. */
export const GROUP_OPEN_TEXT = 'Open'
export const GROUP_NOT_OPEN_TEXT = 'Not open'
/** The label of the group that stands first (YAZ-2602 S64): the saved workspaces. */
export const GROUP_SETS_TEXT = 'Workspaces'
/** A workspace with no folder left (YAZ-2602 S66): `MISSING_TEXT`, for several. */
export const SETS_MISSING_TEXT = 'Folders not found'
/** The header's one menu item while the window has two or more vaults (YAZ-2602 S63). */
export const SAVE_SET_TEXT = 'Save as workspace…'

/**
 * The rows `query` keeps, ranked (D7): an empty query is MRU order untouched; otherwise the `[[`
 * picker's ranking, uncapped, over one candidate per name a row answers to — its display name and,
 * when it differs, its folder name (YAZ-1974 D6, the picker's alias idea) — each row once, at its best rank.
 */
export function rankVaultRows(rows: readonly VaultRow[], query: string): VaultRow[] {
  if (query.trim() === '') return [...rows]
  const candidates = rows.flatMap((row) => (row.folder === row.name ? [{ name: row.name, row }] : [{ name: row.name, row }, { name: row.folder, row }]))
  return [...new Set(matchLinkCandidates(candidates, query, candidates.length).map((c) => c.row))]
}

/**
 * Where the highlight starts (D7). The index is over `[...matches, Open folder…]`, so with no
 * match at all it lands on the Open folder… row (= `matches.length`). `roots` are the vaults of
 * this window (YAZ-2602): an empty query starts on the first row that is none of them.
 */
export function defaultHighlight(matches: readonly { path: string }[], query: string, ...roots: string[]): number {
  if (query.trim() !== '') return 0
  const other = matches.findIndex((m) => !roots.includes(m.path))
  return other === -1 ? 0 : other
}

/** The trigger's text (YAZ-2602 S15): one vault's name; two joined with " + "; more as the first two, then "+ N more". */
export const vaultsLabel = (names: readonly string[]): string => (names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names[1]} + ${names.length - 2} more`)

export function VaultSwitcher({ roots, onPickFolder, pickDisabled, openRequest, onOpenHere, onAddHere, onReveal, onOpenVsCode, onNotice }: VaultSwitcherProps) {
  // The first vault: the one a window with one vault has, and so the one the trigger's own menu and rename are about.
  const root = roots[0]
  const several = roots.length > 1
  const inputRef = useRef<HTMLInputElement>(null)
  /** The header's name slot — the trigger, or its rename field (YAZ-1974 D5) — so the panel finds its anchor either way. */
  const slotRef = useRef<HTMLElement | null>(null)
  const setSlot = useCallback((el: HTMLElement | null) => {
    slotRef.current = el
  }, [])
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /** The rows whose folder is gone: a vault by its path, a workspace (YAZ-2602 S66) by its id. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  /** The right-click menu (YAZ-1798), pinned to the vault it was opened on — and where: its rename happens there (YAZ-1974 D5). */
  const [vaultMenu, setVaultMenu] = useState<{ path: string; at: RenameAt; x: number; y: number } | null>(null)
  /** The name currently an inline field (YAZ-1974 D5): the header's, or a row's. */
  const [renaming, setRenaming] = useState<{ path: string; at: RenameAt } | null>(null)
  /** A workspace's menu (YAZ-2602 D8): a saved one's on its row (S67), pinned to its id — or with `id: null` the header's, "Save as workspace…" (S63). */
  const [vaultSetMenu, setVaultSetMenu] = useState<{ id: string | null; x: number; y: number } | null>(null)
  /** The workspace name that is an inline field: a saved one's on its row (S67) — or with `id: null` the header's, the name to save this window's vaults under (S63). */
  const [vaultSetField, setVaultSetField] = useState<{ id: string | null } | null>(null)
  // One menu and one field stand at a time, a vault's or a workspace's: the layer rules below are about either.
  const menuUp = vaultMenu !== null || vaultSetMenu !== null
  const fieldUp = renaming !== null || vaultSetField !== null
  /** The ⓘ tooltip (YAZ-1974 D2): the hovered row's path and rect, while the pointer is on its ⓘ. */
  const [pathTip, setPathTip] = useState<{ path: string; rect: DOMRect } | null>(null)
  /** Set by a row's mousedown mid-rename, so the click it starts only ends the rename (D5). */
  const dropClick = useRef(false)
  /** ⇧ held while the panel is up (YAZ-1974 D9) — tracked on window so the cue shows before any ⏎ or click. */
  const [shiftHeld, setShiftHeld] = useState(false)
  // The trigger's text, live: a change made in ANY window lands through `storage.subscribe`. The saved workspace that is
  // exactly this window's vaults (YAZ-2602 S15) — the first that matches — else each vault's display name (YAZ-1974 D4).
  // One vault is never a workspace (S70), so its header asks the saved ones nothing.
  const name = useSyncExternalStore(storage.subscribe, () => (several ? storage.getVaultSets().find((set) => sameVaults(set.roots, roots))?.name : undefined) ?? vaultsLabel(roots.map(storage.vaultName)))
  const open = panel !== null

  const openPanel = useCallback(() => {
    // Anchor = the `.sidebar__header` rect (the name slot's parent): the panel hangs off the whole header, flush with the sidebar (D5).
    const rect = slotRef.current?.parentElement?.getBoundingClientRect()
    // The rows (YAZ-2555 A1) are `listVaults`'s: the one list that `yaseendocs vaults` prints too (YAZ-2556 D2).
    const rows = storage.listVaults().map((vault) => ({ ...vault, folder: basename(vault.path) }))
    setPanel({ rows, sets: storage.getVaultSets(), now: Date.now(), anchor: rect === undefined ? { x: 0, y: 0, width: 280 } : { x: rect.left, y: rect.bottom, width: rect.width } })
    setQuery('')
    setMissing(new Set())
  }, [])
  // A row's rename field, its menu and the ⓘ tooltip go with the panel (a field that unmounts is a cancel); the header's stay.
  const closePanel = useCallback(() => {
    setPanel(null)
    setRenaming((r) => (r?.at === 'row' ? null : r))
    setVaultMenu((m) => (m?.at === 'row' ? null : m))
    setVaultSetField((f) => (f?.id === null ? f : null))
    setVaultSetMenu((m) => (m?.id === null ? m : null))
    setPathTip(null)
  }, [])
  const closeMenu = useCallback(() => {
    setVaultMenu(null)
    setVaultSetMenu(null)
  }, [])

  // The filter takes focus whenever the panel mounts (D7).
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const sync = (e: globalThis.KeyboardEvent) => setShiftHeld(e.shiftKey)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    // The panel goes when its window loses focus (YAZ-2555 A4), and the ⇧ cue with it (the cleanup below).
    window.addEventListener('blur', closePanel)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', closePanel)
      setShiftHeld(false)
    }
  }, [open, closePanel])

  // ⌘O (D8) TOGGLES: each new request value opens the panel with a fresh query, or closes it when
  // it is already up — so ⌘O ⌘O is a no-op round trip, the way ⌘K's search bar answers a second press.
  // `openRef` mirrors `open` so this effect runs on the REQUEST alone, never on the open/close itself.
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (openRequest === 0) return
    if (openRef.current) {
      closePanel()
      return
    }
    openPanel()
    inputRef.current?.focus()
  }, [openRequest, openPanel, closePanel])

  // The two groups (YAZ-2555 D1, A6): the ranked rows, open vaults first — a stable split, so each group keeps its rank (last-used order with no query).
  const matches = useMemo(() => {
    const ranked = panel === null ? [] : rankVaultRows(panel.rows, query)
    return [...ranked.filter((r) => r.open), ...ranked.filter((r) => !r.open)]
  }, [panel, query])
  // The workspaces (YAZ-2602 S64) stand above the two groups: last used first, or ranked by name like a vault.
  const sets = useMemo(() => (panel === null ? [] : matchLinkCandidates(panel.sets, query, panel.sets.length)), [panel, query])
  /** The first vault row's index in the highlight space: the workspace rows come before it. */
  const first = sets.length
  /** The Open folder… row's index in the highlight space. */
  const openFolderIndex = first + matches.length

  // The highlight re-seeds exactly when `matches` does — on open and on every keystroke (D7).
  const inWindow = roots.join('\n')
  useEffect(() => {
    // A typed query starts on the top row, a workspace's or a vault's. An empty one starts below the workspace
    // rows, on a vault row (YAZ-2602 S64): ⌘O ⏎ stays "the vault you used last" (YAZ-2555), never a workspace.
    setActive(query.trim() === '' ? sets.length + defaultHighlight(matches, query, ...inWindow.split('\n')) : 0)
  }, [sets, matches, query, inWindow])

  /** A door that failed is logged, and reads as its "no". */
  const failed = (what: string) => (err: unknown): false => {
    console.error(`[vault-switcher] ${what} failed:`, err)
    return false
  }
  /**
   * One rule for both ways a row opens — a click (beside, `openRecent`) and the menu's "Open in
   * this window" (in place, D8): `true` closes the panel; `false` or a rejection greys the row with
   * "Folder not found" and keeps the panel up, the filter focused (D5). `row` is the row's key in
   * `missing`: a vault's path, or a workspace's id.
   */
  const settle = (row: string, opening: Promise<boolean>, what: string): void => {
    void opening.catch(failed(what)).then((opened) => {
      if (opened) {
        closePanel()
        return
      }
      setMissing((prev) => new Set(prev).add(row))
      inputRef.current?.focus()
    })
  }
  const choose = (path: string): void => settle(path, api.window.openRecent(path), 'openRecent')
  /**
   * A workspace row opens through its own door (YAZ-2602 S65): main raises the window that shows
   * exactly its vaults, else opens one on them. A folder that is gone is left out, and named here
   * as the app names a vault (S66); with no folder left the answer is a dead row's — `settle`'s rule.
   */
  const chooseSet = (id: string): void =>
    settle(
      id,
      api.window.openSet(id).then(({ opened, missing: gone }) => {
        if (opened && gone.length > 0) onNotice(`Not found: ${gone.map(storage.vaultName).join(', ')}`)
        return opened
      }),
      'openSet',
    )

  /** Remove from recent vaults (D3): forgets the MRU entry and the vault's number (YAZ-2555 A2) — the folder is untouched — and the row leaves at once. */
  const removeRow = (path: string): void => {
    storage.removeRecentRoot(path)
    // Its number goes with it (YAZ-2555 A2): with no row, it would be a key you cannot see or change.
    if (storage.vaultKey(path) !== null) storage.setVaultKey(path, null)
    setPanel((p) => (p === null ? p : { ...p, rows: p.rows.filter((r) => r.path !== path) }))
    inputRef.current?.focus()
  }

  /** Save a display name (YAZ-1974 D5) — `null` is Reset to folder name — and redraw the open panel's row with it, `removeRow`'s idiom. */
  const saveName = (path: string, raw: string | null): void => {
    storage.setVaultName(path, raw)
    const next = storage.vaultName(path)
    setPanel((p) => (p === null ? p : { ...p, rows: p.rows.map((r) => (r.path === path ? { ...r, name: next } : r)) }))
    inputRef.current?.focus()
  }
  /** Give a vault its number, or with `null` take it away (YAZ-2555 D2), and redraw the open panel's badges — every row's, the number may have left another vault — `saveName`'s idiom. */
  const saveKey = (path: string, key: number | null): void => {
    storage.setVaultKey(path, key)
    setPanel((p) => (p === null ? p : { ...p, rows: p.rows.map((r) => ({ ...r, key: storage.vaultKey(r.path) })) }))
    inputRef.current?.focus()
  }
  /** Rename a workspace (YAZ-2602 S67). Main refuses a name that another workspace has; the open panel's row follows a yes, `saveName`'s idiom. */
  const renameSet = (id: string, name: string): void => {
    void api.window
      .renameSet(id, name)
      .catch(failed('renameSet'))
      .then((renamed) => {
        if (renamed) setPanel((p) => (p === null ? p : { ...p, sets: p.sets.map((s) => (s.id === id ? { ...s, name } : s)) }))
        else onNotice("Can't rename: a workspace has that name")
      })
  }
  /** Remove from workspaces (YAZ-2602 S67): main forgets the entry — the folders are untouched — and the row leaves at once, `removeRow`'s idiom. */
  const removeSet = (id: string): void => {
    void api.window.removeSet(id).catch(failed('removeSet'))
    setPanel((p) => (p === null ? p : { ...p, sets: p.sets.filter((s) => s.id !== id) }))
    inputRef.current?.focus()
  }
  /**
   * "Save as workspace…" (YAZ-2602 S63): main saves THIS window's vaults under `name`, and a name
   * that exists replaces that workspace (S69). A NEW name when the list is full is refused here, in
   * its own words (S68, R12): main's `false` does not say which of its reasons it was.
   */
  const saveSet = (name: string): void => {
    const sets = storage.getVaultSets()
    if (sets.length >= MAX_VAULT_SETS && !sets.some((set) => set.name === name)) {
      onNotice('Remove a workspace first')
      return
    }
    void api.window
      .saveSet(name)
      .catch(failed('saveSet'))
      .then((saved) => onNotice(saved ? `Saved workspace "${name}"` : "Can't save the workspace"))
  }
  const endRename = (): void => {
    setRenaming(null)
    setVaultSetField(null)
    inputRef.current?.focus()
  }
  /** The inline field (D5): the display name selected, the folder name as placeholder; ⏎ / blur save, Esc cancels, empty = the folder name. */
  const nameField = (path: string, value: string) => (
    <TextField
      className="vault-switcher__rename"
      value={value}
      placeholder={basename(path)}
      aria-label="Display name"
      autoFocus
      selectOnMount
      normalize={(draft) => draft.trim()}
      onCommit={(next) => saveName(path, next)}
      onDone={endRename}
    />
  )

  /**
   * The same field for a workspace's name (YAZ-2602 S63, S67). No folder name stands behind it, so an
   * empty field is no name: nothing is saved. `asItStands`: ⏎ also takes a name that was not edited (S63).
   */
  const vaultSetNameField = (value: string, onCommit: (name: string) => void, asItStands = false) => (
    <TextField className="vault-switcher__rename" value={value} aria-label="Workspace name" autoFocus selectOnMount normalize={cleanVaultName} commitOnEnter={asItStands} onCommit={onCommit} onDone={endRename} />
  )

  /** The vault menu's target (YAZ-1974 D4/D5): what the app calls it, and whether that is a display name at all — and who has which number (YAZ-2555 D2). */
  const menuTarget = (path: string) => {
    const name = storage.vaultName(path)
    return { path, name, isCurrent: roots.includes(path), renamed: name !== basename(path), keyed: storage.keyedVaults() }
  }

  /**
   * Right-click (D1): ALWAYS swallow the native text menu (G1); a dead row gets no vault menu — the
   * door has pruned its MRU entry. A vault that has a number is listed again on the next open
   * (YAZ-2555 A1), and that row's menu can clear the number (A3).
   */
  const openVaultMenu = (path: string, at: RenameAt, e: MouseEvent): void => {
    e.preventDefault()
    if (missing.has(path)) return
    setPathTip(null)
    setVaultMenu({ path, at, x: e.clientX, y: e.clientY })
  }

  /**
   * A workspace's right-click (YAZ-2602 D8): a row's (S67) — a dead row's too, its workspace is
   * still saved and can be removed — or with `id: null` the header's while it names several vaults (S63).
   */
  const openVaultSetMenu = (id: string | null, e: MouseEvent): void => {
    e.preventDefault()
    setVaultSetMenu({ id, x: e.clientX, y: e.clientY })
  }

  /**
   * Rows swallow their mousedown so typing never leaves the filter (D7). Mid-rename (YAZ-1974 D5)
   * it ends the rename instead — the filter takes focus, the field's blur saves — and the click it
   * starts is dropped, so a vault never opens by accident.
   */
  const rowMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    dropClick.current = fieldUp
    if (dropClick.current) inputRef.current?.focus()
  }

  /** `here` = ⇧ held (YAZ-1974 D8): "Open in this window" instead of beside; on the current vault it is a plain ⏎. */
  const activate = (index: number, here = false): void => {
    if (index === openFolderIndex) {
      if (pickDisabled) return
      closePanel()
      onPickFolder()
      return
    }
    // A workspace has no "open here" (YAZ-2602 S65): ⇧ or not, it opens through its one door.
    const set = sets[index]
    if (set !== undefined) {
      if (!missing.has(set.id)) chooseSet(set.id)
      return
    }
    const row = matches[index - first]
    if (row === undefined || missing.has(row.path)) return
    if (here && !roots.includes(row.path)) settle(row.path, onOpenHere(row.path), 'openHere')
    else choose(row.path)
  }
  const clickRow = (index: number, e: MouseEvent): void => {
    if (!dropClick.current) activate(index, e.shiftKey)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // The menu is the top layer (D4): its own window listener takes Esc; nothing else reaches the panel.
    if (menuUp) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(openFolderIndex, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Enter':
        e.preventDefault()
        activate(active, e.shiftKey)
        return
      case 'Escape':
        e.preventDefault()
        closePanel()
        return
      default:
        return
    }
  }

  return (
    <>
      {renaming?.at === 'header' || vaultSetField?.id === null ? (
        <div ref={setSlot} className="sidebar__root">
          {/* "Save as workspace…" (YAZ-2602 S63) starts from EVERY vault name: the trigger's "+ N more" is no name to save. */}
          {renaming?.at === 'header' ? nameField(root, name) : vaultSetNameField(roots.map(storage.vaultName).join(' + '), saveSet, true)}
        </div>
      ) : (
        // stopPropagation on mousedown: the surface closes on any window mousedown, so without it a
        // second click on the trigger would close and immediately reopen the panel.
        <button
          ref={setSlot}
          type="button"
          className="sidebar__root"
          title={roots.join('\n')}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (open ? closePanel() : openPanel())}
          // The vault menu is ONE vault's: with several the trigger offers "Save as workspace…" instead (YAZ-2602 S15, S63).
          onContextMenu={(e) => (several ? openVaultSetMenu(null, e) : openVaultMenu(root, 'header', e))}
        >
          <span className="sidebar__root-name">{name}</span>
          <span className="sidebar__root-hint" aria-hidden="true"><TriangleIcon up={open} /></span>
        </button>
      )}
      {panel !== null && (
        // The top layer closes alone (D4): the vault menu first; a rename field ends on its own blur, so click-away keeps the panel.
        <ContextMenuSurface x={panel.anchor.x} y={panel.anchor.y} minWidth={panel.anchor.width} className="ctx-menu--panel" onClose={menuUp ? closeMenu : fieldUp ? () => undefined : closePanel}>
          <div className="vault-switcher" onWheel={() => setPathTip(null)}>
            <input
              ref={inputRef}
              className="vault-switcher__filter"
              type="text"
              placeholder="Switch vault…"
              aria-label="Switch vault"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="vault-switcher__rows">
              {sets.length === 0 && matches.length === 0 && <div className="vault-switcher__empty">{NO_MATCH_TEXT}</div>}
              {sets.map((set, i) => {
                const gone = missing.has(set.id)
                const when = <span className={`vault-switcher__when${gone ? ' vault-switcher__when--missing' : ''}`}>{gone ? SETS_MISSING_TEXT : `${set.roots.length} vaults`}</span>
                return (
                  <Fragment key={set.id}>
                    {/* The label stands above the first workspace (YAZ-2602 S64), like a group's below: not a row. */}
                    {i === 0 && <div className="vault-switcher__label">{GROUP_SETS_TEXT}</div>}
                    {vaultSetField?.id === set.id ? (
                      <div className="vault-switcher__row vault-switcher__row--renaming">
                        {vaultSetNameField(set.name, (name) => renameSet(set.id, name))}
                        {when}
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className={`vault-switcher__row${i === active ? ' vault-switcher__row--active' : ''}`}
                        aria-current={sameVaults(set.roots, roots) ? 'true' : undefined}
                        disabled={gone}
                        onMouseDown={rowMouseDown}
                        onMouseEnter={() => setActive(i)}
                        onClick={(e) => clickRow(i, e)}
                        onContextMenu={(e) => openVaultSetMenu(set.id, e)}
                      >
                        <span className="vault-switcher__name">{set.name}</span>
                        {when}
                      </button>
                    )}
                  </Fragment>
                )
              })}
              {matches.map((row, at) => {
                const i = first + at
                const gone = missing.has(row.path)
                const here = shiftHeld && i === active && !roots.includes(row.path) && !gone
                const when = (
                  <span className={`vault-switcher__when${gone ? ' vault-switcher__when--missing' : here ? ' vault-switcher__when--here' : ''}`}>
                    {gone ? MISSING_TEXT : here ? OPEN_HERE_TEXT : row.lastUsed === null ? '' : relativeTime(row.lastUsed, panel.now)}
                  </span>
                )
                // A group's label stands above its first row (YAZ-2555 D1) — not a row itself, so outside the highlight's index space.
                const label = row.open !== matches[at - 1]?.open && <div className="vault-switcher__label">{row.open ? GROUP_OPEN_TEXT : GROUP_NOT_OPEN_TEXT}</div>
                const line = renaming?.at === 'row' && renaming.path === row.path ? (
                  <div className="vault-switcher__row vault-switcher__row--renaming">
                    {nameField(row.path, row.name)}
                    {when}
                  </div>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`vault-switcher__row${i === active ? ' vault-switcher__row--active' : ''}`}
                    aria-current={roots.includes(row.path) ? 'true' : undefined}
                    disabled={gone}
                    onMouseDown={rowMouseDown}
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => clickRow(i, e)}
                    onContextMenu={(e) => openVaultMenu(row.path, 'row', e)}
                  >
                    <span className="vault-switcher__name">{row.name}</span>
                    {row.key !== null && <kbd className="vault-switcher__key">⌘{row.key}</kbd>}
                    {/* Part of its row (D2): a click is the row's click, a right-click the row's menu. */}
                    <span
                      className="vault-switcher__info"
                      aria-hidden="true"
                      onMouseEnter={(e) => setPathTip({ path: row.path, rect: e.currentTarget.parentElement!.getBoundingClientRect() })}
                      onMouseLeave={() => setPathTip(null)}
                    >
                      <InfoIcon />
                    </span>
                    {when}
                  </button>
                )
                return (
                  <Fragment key={row.path}>
                    {label}
                    {line}
                  </Fragment>
                )
              })}
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`vault-switcher__row vault-switcher__open${active === openFolderIndex ? ' vault-switcher__row--active' : ''}`}
              disabled={pickDisabled}
              onMouseDown={rowMouseDown}
              onMouseEnter={() => setActive(openFolderIndex)}
              onClick={(e) => clickRow(openFolderIndex, e)}
            >
              {OPEN_FOLDER_TEXT}
            </button>
          </div>
        </ContextMenuSurface>
      )}
      {pathTip !== null &&
        createPortal(
          // Under the row, or above it when there is more room there (the last rows); `<wbr>` after every `/` is where the WHOLE path wraps (D2).
          <div
            className="vault-switcher__tip"
            role="tooltip"
            style={{
              left: pathTip.rect.left,
              width: pathTip.rect.width,
              ...(window.innerHeight - pathTip.rect.bottom >= pathTip.rect.top ? { top: pathTip.rect.bottom } : { bottom: window.innerHeight - pathTip.rect.top }),
            }}
          >
            {pathTip.path.split(/(?<=\/)/).map((part, i) => (
              <Fragment key={i}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
      {vaultMenu !== null && (
        <ContextMenu
          x={vaultMenu.x}
          y={vaultMenu.y}
          sections={buildVaultMenuSections(
            menuTarget(vaultMenu.path),
            {
              onOpenHere: (path) => settle(path, onOpenHere(path), 'openHere'),
              // A refusal keeps the panel up, and the row as it is: App's notice has said why (YAZ-2602 S4 to S7).
              onAddHere: (path) => void onAddHere(path).then((added) => (added ? closePanel() : inputRef.current?.focus()), () => undefined),
              onRename: (path) => setRenaming({ path, at: vaultMenu.at }),
              onResetName: (path) => saveName(path, null),
              onSetKey: saveKey,
              onReveal,
              onOpenVsCode,
              onRemove: removeRow,
              onNotice,
            },
          )}
          onClose={closeMenu}
        />
      )}
      {vaultSetMenu !== null && (
        <ContextMenu
          x={vaultSetMenu.x}
          y={vaultSetMenu.y}
          sections={
            vaultSetMenu.id === null
              ? [[{ id: 'save-set', label: SAVE_SET_TEXT, onSelect: () => setVaultSetField({ id: null }) }]]
              : buildVaultSetMenuSections(vaultSetMenu.id, { onRename: (id) => setVaultSetField({ id }), onRemove: removeSet })
          }
          onClose={closeMenu}
        />
      )}
    </>
  )
}
