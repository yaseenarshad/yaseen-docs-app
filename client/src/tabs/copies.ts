/** Each tab's copy number (its place among the tabs of its path, strip order) and the count of each path (YAZ-3343 D1, D11). */
export function copiesOf(tabs: readonly { path: string }[]): { copy: number[]; count: Map<string, number> } {
  const count = new Map<string, number>()
  const copy = tabs.map(({ path }) => {
    const n = count.get(path) ?? 0
    count.set(path, n + 1)
    return n
  })
  return { copy, count }
}
