/**
 * THE CARD LOOK AS CSS VARIABLES ON THE MAC (YAZ-5484, which replaces YAZ-5005's one look for the whole app): the 13
 * Card look settings draw every card through inherited CSS variables (`cardLookStyle`, `shared/cardLook.ts`), so each
 * surface that shows a card carries its OWN card's vault's look, and two vaults side by side never clash. What were
 * attributes on `.app` (`data-shown-hidden-words`, `data-mark-next-hidden`, `data-card-clean`) are `--shown-hidden-words`,
 * `--mark-next-hidden` and `--card-clean`, which `card.css` reads with style queries (the nearest value wins; an
 * attribute matched on ANY ancestor, so two values would clash).
 *
 * `.app` carries the app's values (the fallback: a window with no vault, a vault with no card-look.json yet, and any
 * place outside a surface), only the ones set. A surface of a vault that has its file carries `whole` variables: every
 * one set, `initial` where the vault sets none, so nothing of `.app`'s look leaks in. YAZ-5164 stays: a read card with
 * no Card text size reads its page's size (`--card-text-size` unset). Card width "Same as pages" is the app's Content
 * width (`--card-text-width`, `contentWidthVars`), a habit of this Mac.
 */
import { cardLookOf, cardLookStyle } from '@shared/cardLook'
import type { LinkPills } from '@shared/linkPills'
import type { SettingsState } from '@shared/types'
import { DEFAULT_WEB_LINKS, webLinkVars, type WebLinksStyle } from '@shared/webLinks'
import { linkPillVars } from '../editor/wikilink/linkPillLook'
import { contentWidthVars } from '../lib/contentWidth'
import type { CSSProperties } from 'react'

/** The card look of `s` (the app's settings, or the app's with a vault's look over them) as CSS variables. */
export function cardLookVars(s: SettingsState, whole = false): Record<string, string> {
  const style = { ...cardLookStyle(cardLookOf(s)), '--card-text-width': contentWidthVars(s)['--card-text-width'] }
  return whole ? style : Object.fromEntries(Object.entries(style).filter(([, value]) => value !== 'initial'))
}

/**
 * A vault's whole look over the app's settings, cached on the look object and the settings object: the same two give the
 * same style object, so a layer's style keeps its identity while neither changes.
 */
const cache = new WeakMap<object, WeakMap<SettingsState, CSSProperties>>()
export function vaultCardVars(look: object, settings: SettingsState, resolve: () => SettingsState): CSSProperties {
  let bySettings = cache.get(look)
  if (bySettings === undefined) cache.set(look, (bySettings = new WeakMap()))
  let vars = bySettings.get(settings)
  if (vars === undefined) {
    vars = cardLookVars(resolve(), true) as CSSProperties
    bySettings.set(settings, vars)
  }
  return vars
}

const cardSurfaceStyles = new WeakMap<LinkPills, WeakMap<CSSProperties, WeakMap<WebLinksStyle, CSSProperties>>>()
const cardSurfaceResetStyles = new WeakMap<LinkPills, WeakMap<CSSProperties, WeakMap<WebLinksStyle, CSSProperties>>>()
const NO_WEB_LINKS_SENTINEL: WebLinksStyle = Object.freeze({})
/**
 * The style of a surface that shows a vault's cards outside a page layer — the Inbox, Preview a card, Explore's card
 * layer (YAZ-5792, YAZ-5822, YAZ-6589): its card look, its link pills look (`linkPillVars`), and its resolved external
 * web links look (`webLinkVars`; with `resetDefaults: true` when `resetWebLinks` is set so a vault override cleanly
 * isolates from non-default Global `.app` variables, while emitting zero `--ext-link-*` variables when default).
 * Cached on all inputs, as App's `layerStyleOf`, so a surface's style keeps its identity between renders.
 */
export function cardSurfaceStyleOf(pills: LinkPills, cardVars: CSSProperties, webLinks?: WebLinksStyle, resetWebLinks = false): CSSProperties {
  const root = resetWebLinks ? cardSurfaceResetStyles : cardSurfaceStyles
  let byCard = root.get(pills)
  if (byCard === undefined) root.set(pills, (byCard = new WeakMap()))
  let byWeb = byCard.get(cardVars)
  if (byWeb === undefined) byCard.set(cardVars, (byWeb = new WeakMap()))
  const key = webLinks ?? NO_WEB_LINKS_SENTINEL
  let style = byWeb.get(key)
  if (style === undefined) {
    const ext = webLinks === undefined && !resetWebLinks ? {} : webLinkVars(webLinks ?? DEFAULT_WEB_LINKS, resetWebLinks ? { resetDefaults: true } : undefined)
    byWeb.set(key, (style = { ...linkPillVars(pills), ...cardVars, ...ext } as CSSProperties))
  }
  return style
}
