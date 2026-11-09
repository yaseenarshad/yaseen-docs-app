import { createContext, useContext } from 'react'
import { DEFAULT_FOLDER_PAGES, type FolderPagesSettings } from '@shared/types'
import type { Mutate, ViewDef } from './viewSchema'

/**
 * Settings › Folder pages as the views read them (YAZ-4585, D34 of YAZ-4501): a view reads its OWN key first, then
 * Settings. `ViewsPane` hands its menus these through `ViewDefaults`, and gives every reader the view with Settings
 * filled in (`withDefaults`). A choice in a view's menu that equals Settings removes the view's key (`chooseOwn`),
 * as each "the default removes the key" rule did before, so with the default Settings every file stays as it was.
 */
export const ViewDefaults = createContext<FolderPagesSettings>(DEFAULT_FOLDER_PAGES)
export const useViewDefaults = (): FolderPagesSettings => useContext(ViewDefaults)

/**
 * The view keys that have a Settings default, each with the Settings part it reads; the values are the view's words.
 * `showEmptyColumns` is the one key with TWO parts (YAZ-4608 C2): a Board reads "Show empty columns", every other
 * view "Show empty groups" (`partOf`).
 */
const DEFAULTED = {
  rowHeight: 'rowHeight',
  textInCells: 'textInCells',
  rowNumbers: 'rowNumbers',
  groupIndent: 'groupIndent',
  showEmptyColumns: 'showEmptyGroups',
  subfolders: 'subfolders',
  foldersFirst: 'foldersFirst',
  calendarScale: 'calendarScale',
  cardTitles: 'cardTitles',
  hideWeekends: 'hideWeekends',
} as const satisfies Partial<Record<keyof ViewDef, keyof FolderPagesSettings>>
export type DefaultedKey = keyof typeof DEFAULTED
const DEFAULTED_KEYS = Object.keys(DEFAULTED) as DefaultedKey[]

/** The Settings part a view key reads, by the view's type (C2). */
const partOf = (key: DefaultedKey, view: Pick<ViewDef, 'type'>): keyof FolderPagesSettings => (key === 'showEmptyColumns' && view.type === 'board' ? 'showEmptyColumns' : DEFAULTED[key])

/** The value Settings gives a view key of this view. */
export const settingsValue = (key: DefaultedKey, defaults: FolderPagesSettings, view: Pick<ViewDef, 'type'>): unknown => defaults[partOf(key, view)]

/**
 * What a reader takes for each key when the view has none: the look before Settings › Folder pages. It is not
 * `DEFAULT_FOLDER_PAGES`: a Settings default may differ from it (Show empty groups is on since the YAZ-3746 demo
 * round 2, while a reader takes no `showEmptyColumns` as off).
 */
const ABSENT: { readonly [K in DefaultedKey]: unknown } = {
  rowHeight: 'short',
  textInCells: 'kind',
  rowNumbers: true,
  groupIndent: 'medium',
  showEmptyColumns: false,
  subfolders: 'notes',
  foldersFirst: true,
  calendarScale: 'month',
  cardTitles: 'clip',
  hideWeekends: false,
}

/**
 * The view as every reader sees it: each key the view does not set takes Settings' value. A Settings value that a
 * reader takes for no key anyway is left out, so a view that needs nothing filled is the view itself, the same object.
 */
export function withDefaults(view: ViewDef, defaults: FolderPagesSettings): ViewDef {
  let out: ViewDef | null = null
  for (const key of DEFAULTED_KEYS) {
    const value = settingsValue(key, defaults, view)
    if (view[key] !== undefined || value === ABSENT[key]) continue
    out ??= { ...view }
    ;(out as Record<string, unknown>)[key] = value
  }
  return out ?? view
}

/** A menu's choice for `key`: the view's own value, or no key when it equals Settings. */
export function chooseOwn<K extends DefaultedKey>(view: ViewDef, key: K, value: NonNullable<ViewDef[K]>, defaults: FolderPagesSettings): void {
  if (value === settingsValue(key, defaults, view)) delete view[key]
  else view[key] = value
}

/**
 * The slot after a menu row's control (D34, polished in the YAZ-3746 demo): empty while the view follows Settings
 * (the View tab's footer says where defaults come from); once the view has its own value, an accent ↺ that removes
 * the key, so the view follows Settings again. The empty slot keeps every control in the same place.
 * `own` is the view as written, never `withDefaults`'.
 */
export function FromSettings({ own, viewKey, viewIndex, onUpdate }: { own: ViewDef; viewKey: DefaultedKey; viewIndex: number; onUpdate: Mutate }) {
  if (own[viewKey] === undefined) return <span className="view-from-settings" aria-hidden="true" />
  return (
    <button
      type="button"
      className="view-from-settings view-from-settings--reset"
      aria-label="Reset to Settings"
      title="Changed for this view. Click to use the value from Settings › Folder pages."
      onClick={(e) => {
        e.preventDefault()
        onUpdate((d) => {
          delete d.views[viewIndex][viewKey]
        })
      }}
    >
      <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H6M5.5 3.5 2.5 6.5l3 3" />
      </svg>
    </button>
  )
}
