import { useEffect, useState } from 'react'
import { linkPillVars } from '@client/editor/wikilink/linkPillLook'
import { headingVars } from '@client/settings/headingStyles'
import { DEFAULT_LINK_CLICK, LINK_CLICK_FILE, sanitizeLinkClick, type LinkClick } from '@shared/linkClick'
import { LINK_PILLS_FILE, NO_LINK_PILLS, isDefaultLinkPills, sanitizeLinkPills, type LinkPills } from '@shared/linkPills'
import { TEXT_FORMATTING_FILE, sanitizeTextFormatting, spacingVars } from '@shared/textFormatting'
import { VAULT_CONFIG_DIR } from '@shared/types'
import type { VaultStore } from '../store'
import type { VaultData } from '../search/vaultData'
import { readCardLook } from '../media/ui/cardDraw'
import './linkPills.css'

/**
 * THE VAULT'S OWN LOOK IN THE READER (YAZ-5455), read only, from the phone's copy of `.yaseendocs/`:
 *  - the link pills (`link-pills.json`, YAZ-4924): sanitised by the Mac's `sanitizeLinkPills`; the box and the parts'
 *    styles as the Mac's CSS variables (`linkPillVars`), the format's ends drawn on a page's links (`pageLook.ts`).
 *    No file, or a file that is not JSON: today's look (`NO_LINK_PILLS`), as the Mac.
 *  - the headings' sizes, weight and underline (`text-formatting.json`, `sanitizeTextFormatting`), as the Mac's
 *    `headingVars` (`--h1-size` …), which the reader's CSS reads. The text size and the lines stay the phone's.
 *  - the page spacing (`text-formatting.json` › `spacing`, YAZ-5485): line spacing, space between blocks, bullet
 *    indent and gap, as the Mac's `--edit-line-height`, `--edit-block-gap`, `--page-bullet-indent`, `--page-bullet-gap`
 *    (`spacingVars`), which `reader.css` reads. No `spacing`: the reader's own defaults (the Mac's defaults).
 *  - the card look (`card-look.json`, YAZ-5484, `cardLook.ts`): the Mac's card variables, so a card in a page and the
 *    card view draw with the vault's text and title size, hidden-word look, next mark and spacing. No file: none.
 *  - "Clicking a link" (`link-click.json`), for the link door (`openLink.ts`).
 * Read once for each version of the vault's data (a sync that brings a new file makes a new version).
 */
export interface VaultLook {
  pills: LinkPills
  click: LinkClick
  /** The CSS variables for the reader's root. */
  style: Record<string, string>
}

export const NO_LOOK: VaultLook = { pills: NO_LINK_PILLS, click: DEFAULT_LINK_CLICK.click, style: {} }

async function readJson(store: VaultStore, vault: string, name: string): Promise<unknown> {
  const file = await store.read(vault, `${VAULT_CONFIG_DIR}/${name}`)
  if (file === null) return undefined
  try {
    return JSON.parse(typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content))
  } catch {
    return undefined
  }
}

const looks = new WeakMap<VaultData, Promise<VaultLook>>()

export function loadVaultLook(store: VaultStore, data: VaultData): Promise<VaultLook> {
  let held = looks.get(data)
  if (held === undefined) {
    held = (async () => {
      const [rawPills, rawText, rawClick, card] = await Promise.all([readJson(store, data.vault, LINK_PILLS_FILE), readJson(store, data.vault, TEXT_FORMATTING_FILE), readJson(store, data.vault, LINK_CLICK_FILE), readCardLook(store, data.vault)])
      const clean = sanitizeLinkPills(rawPills)
      const pills = isDefaultLinkPills(clean) ? NO_LINK_PILLS : clean
      const text = sanitizeTextFormatting(rawText)
      return { pills, click: sanitizeLinkClick(rawClick).click, style: { ...linkPillVars(pills), ...headingVars(text), ...spacingVars(text.spacing), ...card } }
    })().catch(() => NO_LOOK)
    looks.set(data, held)
  }
  return held
}

/** The open vault's look; undefined until it is first read (a page waits for it, a few ms, so its links draw once). */
export function useVaultLook(store: VaultStore, data: VaultData | null): VaultLook | undefined {
  const [look, setLook] = useState<{ data: VaultData; look: VaultLook } | null>(null)
  useEffect(() => {
    if (data === null) return
    let live = true
    void loadVaultLook(store, data).then((next) => live && setLook({ data, look: next }))
    return () => {
      live = false
    }
  }, [store, data])
  // A new version of the data keeps the look it had until its own is read: the page does not wait again.
  return data === null ? undefined : look?.look
}
