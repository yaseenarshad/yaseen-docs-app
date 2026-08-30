/**
 * Renderer ownership policy for YAZ-1280's Cmd+B sidebar shortcut.
 *
 * Editors and modal tools get first refusal because App installs its listener in bubble phase.
 * This predicate is the second boundary: it accepts only ordinary, non-editing app chrome.
 */
export function ownsSidebarHotkey(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.key.toLowerCase() !== 'b'
  ) return false

  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.ownerDocument.querySelector('[aria-modal="true"]') !== null) return false

  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    if (el.matches('input, textarea, select')) return false
    const contenteditable = el.getAttribute('contenteditable')
    if (contenteditable !== null && contenteditable.toLowerCase() !== 'false') return false
  }
  return true
}
