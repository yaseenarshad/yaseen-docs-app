import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, isListFile } from '@shared/friendGists'
import { GROUP_FILE } from '@shared/friendGroups'
import { Model4 } from './model4.testing'

// CHECKER round 4: every byte of every gist (and every revision) after a full scenario.
// BUILDER CHANGE (YAZ-5083): the list is in the vault repo; the gist `notecards-friends.json` is the NOTE (it names
// only the vault). The checks below also prove that no gist a friend can reach names the vault, the list file or the
// note, and that no gist holds a record of the list. The dump is written only with OUT.
it('check4 privacy dump', async () => {
  const m = new Model4(42)
  await m.setup4(2, 1, 1, true, true) // A (2 devices) + B + C, a group of A with B and C, a group of B with A
  const evs = [
    { t: 'zone', who: 'A', dev: 0 },
    { t: 'send', who: 'A', dev: 0 },
    { t: 'share', who: 'A', arg: 2 },
    { t: 'paste', who: 'B', arg: 9 },
    { t: 'paste', who: 'A', arg: 0 },
    { t: 'rows', who: 'B' },
    { t: 'rows', who: 'A' },
    { t: 'send', who: 'B' },
    { t: 'send', who: 'C' },
    { t: 'share', who: 'A', arg: 1 }, // an unused link
    { t: 'time', who: 'A', arg: 6 * 60_000 },
    { t: 'send', who: 'A', dev: 1 },
    { t: 'removeB', who: 'A' },
    { t: 'rows', who: 'A' },
    { t: 'rows', who: 'B' },
    { t: 'time', who: 'A', arg: 6 * 60_000 },
    { t: 'send', who: 'A', dev: 0 },
  ]
  for (const e of evs) await m.run(e as never)
  const lists = new Set(m.allGists().filter((g) => INDEX_FILE in g.files).map((g) => g.id))
  const dump: string[] = []
  const bad: string[] = []
  const zone = m.listOf('A')!.index.zone
  for (const g of m.allGists()) {
    const kind = lists.has(g.id) ? 'LIST' : NUMBERS_FILE in g.files ? 'NUMBERS' : POINTER_FILE in g.files ? 'POINTER' : GROUP_FILE in g.files ? 'GROUP' : 'OTHER'
    dump.push(`### ${g.owner} ${kind} ${g.id.slice(0, 8)} public=${g.public} "${g.description}"`)
    for (const [n, t] of Object.entries(g.files)) dump.push(`  ${n.replace(/[0-9a-f]{32}/g, (x) => x.slice(0, 6))}: ${t.replace(/[0-9a-f]{32}/g, (x) => x.slice(0, 6))}`)
    const texts = [...Object.values(g.files), ...(m.revisions.get(g.id) ?? [])]
    if (kind === 'LIST') {
      // The note: only `v`, `home` and `about`; no friend, pointer or numbers ID; no zone.
      const note = JSON.parse(g.files[INDEX_FILE]) as Record<string, unknown>
      if (note.v !== 3 || Object.keys(note).some((k) => !['v', 'home', 'about'].includes(k))) bad.push(`more than the vault in the note ${g.id.slice(0, 6)}`)
      for (const t of texts) if (/[0-9a-f]{32}/.test(t) || (zone !== undefined && t.includes(zone))) bad.push(`an ID or the zone in the note ${g.id.slice(0, 6)}`)
    }
    if (kind !== 'LIST') {
      for (const t of texts) {
        if (/[a-z]+\/vault|\.yaseendocs|friends\.json/.test(t)) bad.push(`the vault or the list named in ${kind} ${g.id.slice(0, 6)}`)
        if (zone && t.includes(zone)) bad.push(`zone in ${kind} ${g.id.slice(0, 6)}`)
        for (const l of lists) if (t.includes(l)) bad.push(`list ID in ${kind} ${g.id.slice(0, 6)}`)
        if (/"kinds"|"rekey"|"covers"/.test(t)) bad.push(`a tombstone or generation in ${kind} ${g.id.slice(0, 6)}`)
        if (/zone|America\/|Europe\/|Asia\//.test(t)) bad.push(`a zone word in ${kind} ${g.id.slice(0, 6)}`)
      }
      if (Object.keys(g.files).some(isListFile)) bad.push(`a list file in ${kind}`)
    }
    if (g.public) bad.push(`public gist ${g.id.slice(0, 6)}`)
  }
  // The keys of each kind of file.
  const keys: Record<string, Set<string>> = {}
  for (const g of m.allGists())
    for (const [n, t] of Object.entries(g.files)) {
      const k = n.replace(/[0-9a-f]{32}/g, '<id>').replace(/-[0-9a-z]+\.json$/, '-<tag>.json').replace(/\.n\.\d+-/, '.n.<k>-')
      try {
        const o = JSON.parse(t) as Record<string, unknown>
        ;(keys[k] ??= new Set()).add(Object.keys(o).sort().join(','))
        if (k === NUMBERS_FILE) (keys['numbers.totals'] ??= new Set()).add(Object.keys(o.totals as object).sort().join(','))
        if (k === NUMBERS_FILE) for (const d of o.days as object[]) (keys['numbers.days'] ??= new Set()).add(Object.keys(d).sort().join(','))
      } catch {
        ;(keys[k] ??= new Set()).add('(not JSON)')
      }
    }
  const out = { zone, bad, keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, [...v]])), tombstones: m.allGists().flatMap((g) => Object.entries(g.files).filter(([n]) => n.includes('.x.')).map(([n, t]) => `${g.owner}: ${t}`)) }
  if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/privacy-dump.txt`, dump.join('\n') + '\n\n' + JSON.stringify(out, null, 1))
  expect(m.st.i7).toEqual([])
  expect(bad).toEqual([])
})
