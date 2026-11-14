import { urlOf } from '@client/editor/card/localOnly'

/**
 * A tap on a link in a drawn page or card that the app does not open itself (YAZ-5243). The app's window never leaves the
 * app: a web or mail link opens in Safari (a new browsing context, no opener, no referrer; in a Home Screen app the
 * window would else go to the other host); a `#part` scrolls the page; anything else does nothing.
 * Returns true when it took the tap.
 */
export function guardLink(event: { target: EventTarget | null; preventDefault(): void }, open: (url: string) => void = (url) => void window.open(url, '_blank', 'noopener,noreferrer')): boolean {
  const a = event.target instanceof Element ? event.target.closest('a') : null
  if (a === null) return false
  const href = a.getAttribute('href') ?? ''
  const { kind, href: url } = urlOf(href)
  if (kind === 'path' && href.trim().startsWith('#')) return false
  event.preventDefault()
  if (kind === 'web' || kind === 'mail') open(url)
  return true
}
