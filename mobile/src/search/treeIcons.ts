import { createContext, useContext, useEffect, useState } from 'react'
import { ICONS_FILE, cleanIconColors, globRegExp, parseIconsConfig, type IconRuleKind } from '@shared/vaultIcons'
import { VAULT_CONFIG_DIR, type SidebarIconColors } from '@shared/types'
import type { CSSProperties } from 'react'
import type { VaultStore } from '../store'
import type { VaultData } from './vaultData'

/**
 * THE VAULT'S OWN ICONS IN THE SEARCH TREE, read only, from the phone's copy of `.yaseendocs/icons.json`
 * (`parseIconsConfig`, the Mac's): a row's own pick (`paths`, by vault-relative path), then the first name rule
 * (`rules`, the Mac's glob on the NAME, any case) of the row's kind, as the Mac's sidebar (`rowIcons.ts`); and the
 * kinds' colours (`colors`) as the Mac's `--kind-<kind>` variables on the tree. The icon is Material's file
 * (`/material-icons/<id>.svg`, the Mac's), fetched when a row shows it; one that does not load shows the kind's glyph.
 * No file, a file that is not JSON, or one with no rules or colours: the phone's look before (the Mac's app values
 * are not on the phone). Part of the Search chunk: nothing here is in the first load.
 */
export interface TreeIcons {
  pick: (path: string, name: string, kind: IconRuleKind) => string | null
  /** The tree's style: `--kind-<kind>` for each colour the vault set. */
  style: Record<string, string>
  /** The kinds with a colour, for the tree's `data-icon-colors` (the Mac's on `.app`), or undefined. */
  colored: string | undefined
  /**
   * The glyph's own style where the vault set a colour the phone's CSS does not read (the card, drawing and diagram
   * glyphs read `--kind-<kind>` already): a page's glyph in the page colour (else grey), Material's default folder as a
   * silhouette in the folder colour, as the Mac's `app.css` draws them. Inline, so no stylesheet joins the first load.
   */
  glyph: (kind: string, open: boolean) => CSSProperties | undefined
}

export const NO_TREE_ICONS: TreeIcons = { pick: () => null, style: {}, colored: undefined, glyph: () => undefined }

/** The phone's folder glyphs (`styles.css`) as masks. */
const FOLDER_MASK = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232' fill='black'/%3E%3C/svg%3E\") center / 16px 16px no-repeat"
const FOLDER_OPEN_MASK = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6' fill='black'/%3E%3C/svg%3E\") center / 16px 16px no-repeat"

function glyphOf(colors: SidebarIconColors): TreeIcons['glyph'] {
  const { page, folder } = colors
  if (page === undefined && folder === undefined) return NO_TREE_ICONS.glyph
  return (kind, open) => {
    if (kind === 'markdown' && page !== undefined) return { background: page }
    if (kind === 'folder' && folder !== undefined) return { background: folder, mask: open ? FOLDER_OPEN_MASK : FOLDER_MASK }
    return undefined
  }
}

/** The Mac's kind names (`SIDEBAR_ICON_KINDS`) as the phone's CSS variables. */
const colourVars = (colors: SidebarIconColors): Record<string, string> => Object.fromEntries(Object.entries(colors).map(([kind, colour]) => [`--kind-${kind}`, colour]))

export function treeIconsOf(raw: unknown): TreeIcons {
  const config = parseIconsConfig(raw)
  if (config === null) return NO_TREE_ICONS
  const paths = new Map(Object.entries(config.paths))
  const rules = (config.rules ?? []).map((rule) => ({ kind: rule.kind, icon: rule.icon, test: globRegExp(rule.match) }))
  const colors = cleanIconColors(config.colors)
  const style = colourVars(colors)
  const colored = Object.keys(colors).join(' ') || undefined
  const glyph = glyphOf(colors)
  if (paths.size === 0 && rules.length === 0) return { pick: NO_TREE_ICONS.pick, style, colored, glyph }
  return {
    pick: (path, name, kind) => paths.get(path) ?? rules.find((rule) => rule.kind === kind && rule.test.test(name))?.icon ?? null,
    style,
    colored,
    glyph,
  }
}

const read = new WeakMap<VaultData, Promise<TreeIcons>>()

export function loadTreeIcons(store: VaultStore, data: VaultData): Promise<TreeIcons> {
  let held = read.get(data)
  if (held === undefined) {
    held = store
      .read(data.vault, `${VAULT_CONFIG_DIR}/${ICONS_FILE}`)
      .then((file) => {
        if (file === null) return NO_TREE_ICONS
        try {
          return treeIconsOf(JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)))
        } catch {
          return NO_TREE_ICONS
        }
      })
      .catch(() => NO_TREE_ICONS)
    read.set(data, held)
  }
  return held
}

/** The vault's tree icons, once read (a new version of the data keeps the icons it had until its own are read). */
export function useTreeIcons(store: VaultStore, data: VaultData): TreeIcons {
  const [icons, setIcons] = useState<TreeIcons>(NO_TREE_ICONS)
  useEffect(() => {
    let live = true
    void loadTreeIcons(store, data).then((next) => live && setIcons(next))
    return () => {
      live = false
    }
  }, [store, data])
  return icons
}

/** The rows' icons, for `RowIcon` below the tree. */
export const TreeIconsContext = createContext<TreeIcons>(NO_TREE_ICONS)
export const useTreeIconsHere = (): TreeIcons => useContext(TreeIconsContext)
