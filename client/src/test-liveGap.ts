/**
 * jsdom has no layout, and a live-gap drag (YAZ-4606) reads its slot from where the layout puts each item. This lays
 * the items of the list around `target` out one after another, `size` px each from 0, and turns `offset` — px from
 * the target item's midpoint (negative: its first half) — into the client coordinate on the axis. A target in no item
 * (the list's own room, a hidden row) is past the last item. A target in no live list keeps `offset` as it is.
 */
export function liveGapPoint(target: Element, axis: 'x' | 'y', offset: number, size = 100): number {
  const list = target.closest('[data-live-list]')
  if (list === null) return offset
  const items = [...list.querySelectorAll<HTMLElement>('[data-live-item]')]
  const [at, length] = axis === 'x' ? ['offsetLeft', 'offsetWidth'] : ['offsetTop', 'offsetHeight']
  items.forEach((item, i) => Object.defineProperties(item, { [at]: { value: i * size, configurable: true }, [length]: { value: size, configurable: true } }))
  const item = target.closest<HTMLElement>('[data-live-item]')
  const i = item === null ? -1 : items.indexOf(item)
  return i === -1 ? items.length * size + offset : i * size + size / 2 + offset
}
