import { describe, expect, it } from 'vitest'
import { githubClient } from '../github/client'
import type { PhoneVault } from '../store'
import { createSyncEngine, type SyncEvent } from './engine'
import { githubRemote } from './githubRemote'
import { INDEX_RULES, INDEX_STATE, type PhoneIndex } from './phoneIndex'
import { BRANCH, REPO, VAULT, fakeClock, syncSetup } from './testing'

/**
 * YAZ-5309: the phone keeps its index (`INDEX_STATE`) between starts, as the Mac keeps its cache (`CACHE_VERSION`). An
 * index built by an older build's rules (a card's title off its first line, a card file's off its `title` property)
 * must never be shown after an update as if it had the new rules (YAZ-5308: the title off the card line). Its records
 * are built again from the stored files, with no network, before any screen reads them.
 */
const ROW: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }
const FILES = {
  'p.md': '---\ntitle: P\n---\n\n```card\nWhich river runs through Paris?\n---\nThe Seine\n```\n<!-- card: OLD-1 -->\n\n```card\nWhich is it?\n```\n<!-- card: OLD-2, title "Longest river" -->\n',
  'cards/capital-of-france-old-3.md': '---\nkind: card\n---\n```card\nThe capital is {{Paris}}.\n```\n<!-- card: OLD-3, title "Capital of France" -->\n',
}

async function synced() {
  const s = await syncSetup(FILES)
  const clock = fakeClock()
  const make = () =>
    createSyncEngine({ store: s.store, tokens: s.tokens, clock, yieldToUi: async () => {}, makeRemote: (v, tok) => githubRemote(githubClient(tok, { fetch: s.github.fetch, now: clock.now }), v.repo, v.branch) })
  const first = make()
  await first.open(ROW)
  await first.idle()
  first.stop()
  return { s, make }
}

describe('the stored index and the rules it was built by (YAZ-5309)', () => {
  it('a pass writes the rules number with the index', async () => {
    const { s } = await synced()
    const saved = await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE)
    expect(saved?.rules).toBe(INDEX_RULES)
    expect(saved?.records['p.md'].cards?.map((c) => c.title)).toEqual([undefined, 'Longest river'])
  })

  it('an index of an older build (no rules number; first-line titles) is built again from the stored files at open, offline, before the screens hear of it', async () => {
    const { s, make } = await synced()
    const saved = (await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
    // What a build from before YAZ-5308 stored: the question as a title, a card file titled by a property.
    const stale: PhoneIndex = {
      commit: saved.commit,
      records: {
        ...saved.records,
        'p.md': { ...saved.records['p.md'], cards: saved.records['p.md'].cards!.map((c) => ({ ...c, title: c.id === 'OLD-1' ? 'Which river runs through Paris?' : 'Which is it?' })) },
        'cards/capital-of-france-old-3.md': { ...saved.records['cards/capital-of-france-old-3.md'], title: 'Old property title' },
      },
    }
    await s.store.setState(VAULT, INDEX_STATE, stale)
    s.github.offline = true
    const second = make()
    const heard: SyncEvent[] = []
    second.subscribe((e) => heard.push(e))
    await second.open(ROW)
    const index = second.index()!
    expect(index.rules).toBe(INDEX_RULES)
    expect(index.records['p.md'].cards?.map((c) => c.title)).toEqual([undefined, 'Longest river'])
    expect(index.records['cards/capital-of-france-old-3.md'].title).toBe('Capital of France')
    // The times of each file stay (they come from the old index), and the screens heard only the new index.
    expect(index.records['p.md'].ctime).toBe(saved.records['p.md'].ctime)
    for (const e of heard) if (e.type === 'changed') expect(e.index?.rules).toBe(INDEX_RULES)
    // It is stored, so the next open reads it as it is.
    expect((await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))?.rules).toBe(INDEX_RULES)
    await second.idle()
    second.stop()
  })

  it('a pass with an index of older rules builds every record again, also the files that did not change', async () => {
    const { s, make } = await synced()
    const saved = (await s.store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
    await s.store.setState(VAULT, INDEX_STATE, { commit: saved.commit, records: { ...saved.records, 'cards/capital-of-france-old-3.md': { ...saved.records['cards/capital-of-france-old-3.md'], title: 'Old' } } } satisfies PhoneIndex)
    // A new commit on GitHub that changes another file only.
    await s.git.push({ 'other.md': '---\ntitle: Other\n---\nHi\n' })
    const engine = make()
    await engine.open(ROW)
    await engine.idle()
    expect(engine.index()!.records['cards/capital-of-france-old-3.md'].title).toBe('Capital of France')
    engine.stop()
  })
})
