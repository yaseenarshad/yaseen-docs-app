import { type Group, compareValues } from './engine'
import type { ColumnTyping } from './editorType'
import { equals } from './expr'
import { groupByLevels, type ViewDef } from './viewSchema'

/**
 * Declared options supply ordering and writable empty destinations; observed values stay visible.
 * A Table gets them too (YAZ-3940 S11): its "Show empty groups" is the board's `showEmptyColumns`.
 */
export function boardOptionGroups(groups: Group[] | null, view: ViewDef, typing: (key: string) => ColumnTyping): Group[] | null {
  if (groups === null || (view.type !== 'board' && view.type !== 'table')) return groups
  const levels = groupByLevels(view).slice(0, 2)
  const build = (input: Group[], level: number, outerKey?: Group['key']): Group[] => {
    const spec = levels[level]
    if (!spec) return input
    const column = typing(spec.property)
    const select = column?.assigned === 'select' || column?.assigned === 'multi-select'
    let output = input
    if (select) {
      // The engine keeps matching inner values directly under their outer. Do not invent
      // an empty child for a destination whose cards would immediately merge out of it.
      const options = (column.options ?? []).filter(option => outerKey == null || !equals(option, outerKey))
      const destination = (group: Group, option: string): Group => ({ ...group, optionValue: option, fannedOut: column.assigned === 'multi-select' })
      const empty = (option: string): Group => destination({ key: option, label: option, rows: [], summaries: {}, fannedOut: false }, option)
      if (spec.by === 'value') {
        // A → Z or Z → A (YAZ-3940): the engine's value order stays, and an empty option goes in its place by value.
        const direction = spec.direction === 'DESC' ? 'DESC' : 'ASC'
        output = input.map(g => (typeof g.key === 'string' && options.includes(g.key) ? destination(g, g.key) : g))
        if (view.showEmptyColumns === true) {
          for (const option of options) {
            if (output.some(g => g.key === option)) continue
            const at = output.findIndex(g => g.key === null || compareValues(option, g.key, direction) < 0)
            output.splice(at < 0 ? output.length : at, 0, empty(option))
          }
        }
      } else {
        if (spec.direction === 'DESC') options.reverse()
        const ordered = options.flatMap(option => {
          const existing = input.find(g => g.key === option)
          if (!existing && view.showEmptyColumns !== true) return []
          return [existing ? destination(existing, option) : empty(option)]
        })
        output = [...ordered, ...input.filter(g => !options.some(option => g.key === option))]
      }
    }
    return level + 1 < levels.length ? output.map(g => ({ ...g, children: build(g.children ?? [], level + 1, g.key), direct: g.direct ?? [] })) : output
  }
  return build(groups, 0)
}
