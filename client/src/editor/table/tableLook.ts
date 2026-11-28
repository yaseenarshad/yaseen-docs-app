/**
 * THE TABLE LOOK ON THE MAC, PER VAULT (YAZ-5487, as YAZ-5484 did the card look): the 21 table settings of
 * `shared/tableLook.ts` draw every table through inherited CSS variables, so each surface (a page layer, the right
 * panel, a hover preview, Quick Look, Explore's layers) carries its OWN vault's look and two vaults side by side never
 * clash. What were attributes on `.app` (`data-table-row-band`, `data-table-band-bold`, `data-table-now`,
 * `data-table-dim-past`, `data-table-text`, `data-table-sticky-subheaders`, `data-table-width`, `data-table-header-*`,
 * `data-table-subheader-*`) are variables now, which `table.css`, `app.css` and `views.css` read with style queries
 * (the nearest value wins; an attribute matched on ANY ancestor, so two values would clash). The header rows' parts are
 * their resolved variables (`--table-header-hue` …), which the CSS already read, nearest first.
 *
 * `.app` carries the app's values (the fallback: a window with no vault, a vault with no table-look.json yet). A
 * surface of a vault with its file carries `whole` variables: every one set, `initial` where the look sets none, so
 * nothing of `.app`'s look leaks in.
 *
 * The values the editor reads in script (a table menu's Default, the sticky header and subheaders, a new table's style,
 * time format, day and cell note template) follow the same rule: `tableLookAt(view or node)` walks up from the
 * editor's DOM to the nearest surface that says which vault it is (`--table-look`, a key per vault) and reads that
 * vault's look; none, the app's (`setAppTableLook`).
 */
import { TABLE_LOOK_DEFAULTS, type TableLookSettings } from '@shared/tableLook'
import type { HeaderRow } from '@shared/types'

/** A row band colour: the accent, a table colour (its full strength, as a fill swatch), or a picked one. */
export const bandColour = (value: string): string => (value === 'accent' ? 'var(--accent)' : value.startsWith('#') ? value : `var(--table-fill-solid-${value})`)

/** The next slot's colour (YAZ-5541): the band colour's choices, but a table colour is its text colour, the now mark's (`red` is `--table-text-red`). */
export const nextColour = (value: string): string => (value === 'accent' ? 'var(--accent)' : value.startsWith('#') ? value : `var(--table-text-${value})`)

/** A header row's parts as the variables `table.css` reads (`--table-<kind>-hue` …), its `:is(.app, …)[data-table-<kind>-*]` rules written out. */
export function headerRowVars(row: HeaderRow, kind: 'header' | 'subheader'): Record<string, string> {
  const v = (name: string) => `--table-${kind}-${name}`
  const text = row.text
  return {
    [v('hue')]: row.color === 'gray' ? 'initial' : row.color.startsWith('#') ? row.color : `var(--table-fill-solid-${row.color})`,
    [v('scale')]: row.color === 'gray' || row.color.startsWith('#') ? '1' : row.color === 'black' ? '5' : '2.5',
    [v('strength')]: { off: '0', light: '6', medium: '12', strong: '20' }[row.strength],
    [v('weight')]: row.weight === 'regular' ? '400' : 'initial',
    [v('mute')]: text === 'muted' ? '1' : text === 'full' ? '0' : 'initial',
    [v('ink')]: text === null || text === 'muted' || text === 'full' ? 'initial' : text === 'white' ? '#fff' : text.startsWith('#') ? text : `var(--table-text-${text})`,
    [v('align')]: row.align === 'follow' ? 'initial' : row.align,
    // The row's Align for every header cell of a table with none of its own (a style query: `!important` over a column's).
    [v('aligned')]: row.align === 'follow' ? 'off' : 'on',
  }
}

/**
 * The 21 settings as CSS variables. `whole` (a vault's surface): every variable set, `initial` where the look sets none.
 * Else (`.app`, the app's look) only the ones set.
 */
export function tableLookVars(s: TableLookSettings, whole = false): Record<string, string> {
  const style: Record<string, string> = {
    ...headerRowVars(s.tableHeaderRow, 'header'),
    ...headerRowVars(s.tableSubheaderRow, 'subheader'),
    '--table-sticky-subheaders': s.tableStickySubheaders ? 'on' : 'off',
    '--table-row-band': s.tableRowBand,
    '--table-band-colour': bandColour(s.tableBandColour),
    '--table-band-strength': `${s.tableBandStrength}%`,
    '--table-band-bold': s.tableBandBold ? 'on' : 'off',
    '--table-text': s.tableTextInCells,
    '--page-table-inline': s.tablePosition === 'center' ? 'auto' : 'initial',
    '--table-width': s.tableWidth !== null ? `${s.tableWidth}px` : 'initial',
    '--table-width-set': s.tableWidth !== null ? 'on' : 'off',
    '--cell-bullet-indent': `${s.tableCellBulletIndent}px`,
    '--cell-bullet-gap': `${s.tableCellBulletGap}px`,
    '--table-dim-past': s.tableDimPast,
    '--table-past-shade': `${s.tableShadeDarkness}%`,
    '--table-now-mark': s.tableNowMark,
    '--table-next-shade': s.tableNextShade ? 'on' : 'off',
    '--table-next-colour': nextColour(s.tableNextColour),
  }
  return whole ? style : Object.fromEntries(Object.entries(style).filter(([, value]) => value !== 'initial'))
}

/** The app's look (the fallback), as App last set it. */
let app: TableLookSettings = TABLE_LOOK_DEFAULTS
/** Each vault's look, by its key; a vault with no file has none (it reads the app's). */
const looks = new Map<string, TableLookSettings>()
const keys = new Map<string, string>()
/** Called on each change of the sticky defaults, so the frozen rows and sticky subheaders of every editor draw again. */
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const listener of listeners) listener()
}
/** Called on each change of Time in slot or Show seconds (YAZ-5602), so every calendar clock draws its pill again. */
const slotListeners = new Set<() => void>()
const slotChanged = (a: TableLookSettings | undefined, b: TableLookSettings | undefined | null): boolean => a?.tableSlotTime !== b?.tableSlotTime || a?.tableSlotSeconds !== b?.tableSlotSeconds
const tellSlot = (): void => {
  for (const listener of slotListeners) listener()
}

/** A vault's key (`--table-look` on its surfaces): one short name per root for this window's life. */
export function tableLookKey(root: string): string {
  let key = keys.get(root)
  if (key === undefined) keys.set(root, (key = `v${keys.size + 1}`))
  return key
}

/** App's door: the app's 21 settings (every one set). */
export function setAppTableLook(next: TableLookSettings): void {
  const sticky = app.tableStickyHeader !== next.tableStickyHeader || app.tableStickySubheaders !== next.tableStickySubheaders
  const slot = slotChanged(app, next)
  app = next
  if (sticky) tell()
  if (slot) tellSlot()
}

/** App's door: a vault's look (null: it has no table-look.json, so it reads the app's). */
export function setVaultTableLook(root: string, next: TableLookSettings | null): void {
  const key = tableLookKey(root)
  const before = looks.get(key)
  if (next === null) looks.delete(key)
  else looks.set(key, next)
  if (before?.tableStickyHeader !== next?.tableStickyHeader || before?.tableStickySubheaders !== next?.tableStickySubheaders) tell()
  // A vault with no file reads the app's, so its clocks compare against the app's look.
  if (slotChanged(before ?? app, next ?? app)) tellSlot()
}

/** Calls `listener` on each change of a sticky default (the app's or a vault's); returns the unsubscribe. */
export function onTableLookSticky(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Calls `listener` on each change of Time in slot or Show seconds (the app's or a vault's); returns the unsubscribe. */
export function onTableLookSlot(listener: () => void): () => void {
  slotListeners.add(listener)
  return () => slotListeners.delete(listener)
}

/** What `at` is: an editor's view (its `dom`), or a node in the page. */
export type TableLookPlace = { dom: Element } | Node | null | undefined

/**
 * The look of the vault that holds `at`: the nearest element whose own style says `--table-look` names the vault;
 * none (a window with no vault, a vault with no file, nothing given), the app's.
 */
export function tableLookAt(at?: TableLookPlace): TableLookSettings {
  let node: Node | null = at === null || at === undefined ? null : 'dom' in at ? at.dom : at
  while (node !== null) {
    if (node instanceof HTMLElement) {
      const key = node.style.getPropertyValue('--table-look').trim()
      if (key !== '') return looks.get(key) ?? app
    }
    node = node.parentNode
  }
  return app
}

/** The app's look as last set (a door that changes one of its settings, as the tests' `setCellNoteTemplate`). */
export const appTableLookNow = (): TableLookSettings => app

/** The look of the vault at `root` (a folder page knows its vault, `ImageVault`); none, or no file, the app's. */
export const tableLookOfRoot = (root: string | null | undefined): TableLookSettings => (root == null ? app : (looks.get(tableLookKey(root)) ?? app))
