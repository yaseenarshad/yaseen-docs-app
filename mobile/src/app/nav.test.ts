import { describe, expect, it } from 'vitest'
import { TABS, navigate, openingTab, topRoute, type NavState } from './nav'

describe('the shell navigation (decision 21)', () => {
  it('has three tabs, Friends · Review · Search, and no Pages tab', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Friends', 'Review', 'Search'])
  })

  it('opens on Friends; with no friend yet, on Review', () => {
    expect(openingTab(true)).toBe('friends')
    expect(openingTab(false)).toBe('review')
  })

  it('stacks screens over the tabs; Back closes the top one; a tab closes all', () => {
    let s: NavState = { tab: 'review', stack: [] }
    s = navigate(s, { type: 'open', route: { kind: 'settings' } })
    s = navigate(s, { type: 'open', route: { kind: 'add-vault' } })
    s = navigate(s, { type: 'open', route: { kind: 'guide' } })
    expect(topRoute(s)).toEqual({ kind: 'guide' })
    s = navigate(s, { type: 'back' })
    expect(topRoute(s)).toEqual({ kind: 'add-vault' })
    s = navigate(s, { type: 'tab', tab: 'search' })
    expect(s).toEqual({ tab: 'search', stack: [] })
    expect(topRoute(navigate(s, { type: 'home' }))).toBeNull()
  })
})
