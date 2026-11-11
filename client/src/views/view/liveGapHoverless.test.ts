/**
 * No hover look while a folder list's items part (YAZ-4606, the tab bar's 6F): the page hears no mouse move during a
 * drag, so its hover would stay on the item that slid into the grab point. jsdom draws nothing, so the rules are read
 * off the stylesheets, as `TabBar.test.tsx` reads `tabbar--hoverless`.
 */
import { describe, expect, it } from 'vitest'
import viewsCss from '../views.css?inline'
import optionsCss from './propertyDefinitionEditor.css?inline'

const rule = (css: string, selector: string): string =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''

describe('hover off while the items part (YAZ-4606)', () => {
  it('the view tabs, the Properties and Sort rows and their buttons', () => {
    expect(rule(viewsCss, '[data-live-parting] .view-tab__btn:hover')).toMatch(/background:\s*transparent;/)
    const rows = rule(viewsCss, '[data-live-parting] .view-prop__open:hover,\n[data-live-parting] .view-rule__remove:hover:not(:disabled),\n[data-live-parting] .view-rule__nav:hover:not(:disabled)')
    expect(rows).toMatch(/background:\s*transparent;/)
    expect(rows).toMatch(/color:\s*var\(--fg-muted\);/)
    expect(rule(viewsCss, '[data-live-parting] .sort-menu .view-prop__handle:hover,\n.sort-menu[data-live-parting] .view-prop__handle:hover')).toMatch(/opacity:\s*0\.65;/)
  })

  it('the table headers: the sort arrow and the resize grip', () => {
    expect(rule(viewsCss, '.view-table[data-live-parting] .view-table__sort:hover,\n.view-table[data-live-parting] .view-table__resize:hover:not(.view-table__resize--active)')).toMatch(/background:\s*none;/)
  })

  it('a Select column’s options and their hover-only buttons', () => {
    expect(rule(optionsCss, '[data-live-parting] .property-def__option:hover')).toMatch(/background:\s*transparent;/)
    expect(rule(optionsCss, '[data-live-parting] .property-def__option:hover .property-def__more,\n[data-live-parting] .property-def__option:hover .property-def__remove')).toMatch(/opacity:\s*0;/)
  })

  it('the dead marker classes of the first live-gap build are gone from the stylesheets and the code', () => {
    for (const css of [viewsCss, optionsCss]) {
      expect(css).not.toMatch(/--insert-before|--insert-after|view-prop--dragging|view-tab--dragging|th--drag-source|data-insert|data-dragging/)
    }
  })
})
