import { inlineDrawingRowPath } from '@shared/inlineRef'

/** Copy-badge identity key: distinguishes a page tab from an inline drawing tab of the same page (YAZ-6468). */
export const copyKey = (tab: { path: string; inlineDrawing?: number }): string =>
  tab.inlineDrawing === undefined ? tab.path : inlineDrawingRowPath(tab.path, tab.inlineDrawing)

/** Each tab's copy number (its place among the tabs of its copy key, strip order) and the count of each key (YAZ-3343 D1, D11; YAZ-6468). */
export function copiesOf(tabs: readonly { path: string; inlineDrawing?: number }[]): { copy: number[]; count: Map<string, number> } {
  const count = new Map<string, number>()
  const copy = tabs.map((tab) => {
    const key = copyKey(tab)
    const n = count.get(key) ?? 0
    count.set(key, n + 1)
    return n
  })
  return { copy, count }
}
