/**
 * Tests' reading of a place name (YAZ-5402, `PlaceName`): what the spot says it is, the icon the tree's resolver gave
 * it, and its tooltip. `null` when the spot is no place name (a bare span, as before YAZ-5402).
 */
export function placeOf(el: Element | null | undefined): { kind: string | null; icon: string | null; title: string | null } | null {
  if (el == null || !el.classList.contains('place-name')) return null
  return { kind: el.getAttribute('data-place'), icon: el.querySelector('.place-name__icon')?.getAttribute('data-kind') ?? null, title: el.getAttribute('title') }
}
