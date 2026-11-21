import { describe, expect, it, vi } from 'vitest'
import { PLAIN_VAULT, TABS, navigate, openingTab, showsTabBar, tabIn, tabsOf, topRoute, type NavState } from './nav'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

describe('the shell navigation (decision 21)', () => {
  it('has three tabs, Friends · Review · Search, and no Pages tab', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Friends', 'Review', 'Search'])
  })

  it('opens on Friends; with no friend yet, on Review; in a vault with Review off, on Search', () => {
    const cards = { review: true, daily: false }
    expect(openingTab(true, cards)).toBe('friends')
    expect(openingTab(false, cards)).toBe('review')
    expect(openingTab(true, PLAIN_VAULT)).toBe('search')
    expect(openingTab(false, { review: false, daily: true })).toBe('search')
  })

  it('YAZ-5499: swap puts a screen in place of the top one (the page arrows), in one step; Back goes to the screen under', () => {
    let s: NavState = { tab: 'search', stack: [{ kind: 'page', path: 'a.md' }] }
    s = navigate(s, { type: 'swap', route: { kind: 'page', path: 'b.md' } })
    expect(s.stack).toEqual([{ kind: 'page', path: 'b.md' }])
    expect(navigate(s, { type: 'back' }).stack).toEqual([])
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

describe('YAZ-5476: the tabs follow the open vault', () => {
  const label = (v: { review: boolean; daily: boolean }) => tabsOf(v).map((t) => t.label)

  it('Search always; Review and Friends only with Review on', () => {
    expect(label(PLAIN_VAULT)).toEqual(['Search'])
    expect(label({ review: false, daily: true })).toEqual(['Search'])
    expect(label({ review: true, daily: false })).toEqual(['Friends', 'Review', 'Search'])
  })

  it('a plain vault: Search alone, and no tab bar; Today alone with Search brings the bar', () => {
    expect(showsTabBar(PLAIN_VAULT)).toBe(false)
    expect(showsTabBar({ review: false, daily: true })).toBe(true)
    expect(showsTabBar({ review: true, daily: false })).toBe(true)
  })

  it('a tab the vault does not have shows Search', () => {
    expect(tabIn('review', PLAIN_VAULT)).toBe('search')
    expect(tabIn('friends', { review: false, daily: true })).toBe('search')
    expect(tabIn('friends', { review: true, daily: false })).toBe('friends')
    expect(tabIn('search', PLAIN_VAULT)).toBe('search')
  })
})
