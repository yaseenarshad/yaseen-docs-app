/**
 * launch: spawn → main JS → window navigates → first paint → the restored document painted, on a
 * warm profile with 2 tabs; then the same to the document on a fresh profile, with 10 restored tabs,
 * and with 3 restored windows (to the last one's document). Each is its own launch.
 * The window is created ~1 ms before it navigates (scope startup-runtime §1), so nav stands for both.
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeNote, writeVault } from '../genVault.mjs'
import { painted, session } from '../lib/session.mjs'

const NOTES = Array.from({ length: 10 }, (_, i) => `Tab ${i + 1}`)

export function setup(dir) {
  const vault = writeVault(path.join(dir, 'vault'), 200)
  return { dir, vault, tabs: NOTES.map((n) => writeNote(vault, n, 'bullets', 40)) }
}

export async function run(app, { dir, vault, tabs }) {
  const profile = (name) => path.join(dir, `profile-${name}`)
  const warm = await session(app, { profile: profile('warm'), wins: [{ id: 'w1', root: vault, tabs: tabs.slice(0, 2) }], doc: NOTES[0] }, async ({ proc, page, docAt }) => {
    const main = await (await proc.main()).ev('performance.timeOrigin + performance.nodeTiming.bootstrapComplete')
    const r = await page.ev(`({ nav: performance.timeOrigin, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime })`)
    return { spawnToMainMs: main - proc.spawnedAt, spawnToNavMs: r.nav - proc.spawnedAt, navToFirstPaintMs: r.fcp, navToDocMs: docAt - r.nav, spawnToDocMs: docAt - proc.spawnedAt }
  })

  fs.rmSync(profile('fresh'), { recursive: true, force: true })
  const fresh = await session(app, { profile: profile('fresh'), wins: [{ id: 'w1', root: vault, tabs: tabs.slice(0, 2) }], doc: NOTES[0] }, async ({ proc, docAt }) => docAt - proc.spawnedAt)

  const tabs10 = await session(app, { profile: profile('tabs10'), wins: [{ id: 'w1', root: vault, tabs }], doc: NOTES[0] }, async ({ proc, docAt }) => docAt - proc.spawnedAt)

  const wins = [0, 1, 2].map((i) => ({ id: `w${i + 1}`, root: vault, tabs: [tabs[i]] }))
  const windows3 = await session(app, { profile: profile('windows3'), wins, doc: NOTES[0] }, async ({ proc, pages }) => {
    const at = await Promise.all(pages.map((p) => p.waitFor(painted(NOTES[Number(p.win.slice(1)) - 1]))))
    return Math.max(...at) - proc.spawnedAt
  })
  return { ...warm, freshSpawnToDocMs: fresh, tabs10SpawnToDocMs: tabs10, windows3SpawnToLastDocMs: windows3 }
}
