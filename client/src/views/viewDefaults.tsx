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

/** The view keys that have a Settings default, each with the Settings part it reads; the values are the view's words. */
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

/** The value Settings gives a view key. */
export const settingsValue = (key: DefaultedKey, defaults: FolderPagesSettings): unknown => defaults[DEFAULTED[key]]

/**
 * The view as every reader sees it: each key the view does not set takes Settings' value. A Settings value that is the
 * built-in one is left out, so with the default Settings this is the view itself, the same object.
 */
export function withDefaults(view: ViewDef, defaults: FolderPagesSettings): ViewDef {
  let out: ViewDef | null = null
  for (const key of DEFAULTED_KEYS) {
    const value = settingsValue(key, defaults)
    if (view[key] !== undefined || value === settingsValue(key, DEFAULT_FOLDER_PAGES)) continue
    out ??= { ...view }
    ;(out as Record<string, unknown>)[key] = value
  }
  return out ?? view
}

/** A menu's choice for `key`: the view's own value, or no key when it equals Settings. */
export function chooseOwn<K extends DefaultedKey>(view: ViewDef, key: K, value: NonNullable<ViewDef[K]>, defaults: FolderPagesSettings): void {
  if (value === settingsValue(key, defaults)) delete view[key]
  else view[key] = value
}

/**
 * The grey "from Settings" beside a menu row whose view has no key of its own; once it has one, a Reset that removes
 * the key, so the view follows Settings again (D34). `own` is the view as written, never `withDefaults`'.
 */
export function FromSettings({ own, viewKey, viewIndex, onUpdate }: { own: ViewDef; viewKey: DefaultedKey; viewIndex: number; onUpdate: Mutate }) {
  if (own[viewKey] === undefined) return <span className="view-from-settings">from Settings</span>
  return (
    <button
      type="button"
      className="view-from-settings view-from-settings--reset"
      title="Use the value from Settings › Folder pages"
      onClick={(e) => {
        e.preventDefault()
        onUpdate((d) => {
          delete d.views[viewIndex][viewKey]
        })
      }}
    >
      Reset
    </button>
  )
}
