/**
 * The selection toolbar's setting in the renderer (YAZ-3806 T5, T6).
 *
 * `toolbarPrefs` is a Vue ref because Crepe's toolbar is a Vue component: it builds its strip in a `computed` that
 * calls `buildToolbar` (`createCrepe.ts`), which reads this ref. So a change here rebuilds the strip of EVERY open
 * editor at once. `App.tsx` sets it from the settings. The bundle has one copy of Vue, the one Crepe imports.
 */
import { shallowRef } from 'vue'
import { DEFAULT_TOOLBAR, TOOLBAR_LAYOUT, type ToolbarPrefs } from '@shared/types'

export const toolbarPrefs = shallowRef<ToolbarPrefs>(DEFAULT_TOOLBAR)

/** The shape of Crepe's toolbar groups that the order needs. */
interface Group<Item extends { key: string }> {
  key: string
  label: string
  items: Item[]
}

/**
 * Put Crepe's groups in the user's order, in place (Crepe's `GroupBuilder.build` hands back its own array): each
 * group of `prefs.groups` with its shown buttons in `prefs.buttons` order. A group with no button left is dropped,
 * else Crepe draws a divider with nothing beside it. An item no group knows (a Crepe feature this app turns off
 * today, like Latex) keeps a last group of its own.
 */
export function arrangeToolbar<Item extends { key: string }>(groups: Group<Item>[], prefs: ToolbarPrefs): void {
  const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.key, item] as const)))
  const rank = new Map<string, number>(prefs.buttons.map((key, index) => [key, index]))
  const hidden = new Set<string>(prefs.hidden)
  const arranged: Group<Item>[] = prefs.groups.map((key) => ({
    key,
    label: key,
    items: [...TOOLBAR_LAYOUT[key]]
      .sort((a, b) => rank.get(a)! - rank.get(b)!)
      .flatMap((id) => (hidden.has(id) ? [] : (items.get(id) ?? []))),
  }))
  const others = [...items.values()].filter((item) => !rank.has(item.key))
  if (others.length > 0) arranged.push({ key: 'other', label: 'Other', items: others })
  groups.splice(0, groups.length, ...arranged.filter((group) => group.items.length > 0))
}
