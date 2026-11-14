import type { Model } from './model.testing'
export function summarize(ms: Model[]) {
  const seeds = (f: (m: Model) => boolean) => ms.filter(f).map((m) => m.seed)
  const sum = (f: (m: Model) => number) => ms.reduce((s, m) => s + f(m), 0)
  const i4kinds: Record<string, number> = {}
  for (const m of ms) for (const x of m.st.i4) { const k = x.includes('rekey') ? 'lost a waiting remove' : x.includes('old numbers') ? 'wrote back an old numbers ID' : 'lost an entry'; i4kinds[k] = (i4kinds[k] ?? 0) + 1 }
  const i2other = seeds((m) => m.st.i2.some((x) => x.includes('[OTHER]')))
  return {
    runs: ms.length,
    events: sum((m) => m.st.steps),
    crashes: sum((m) => m.st.crashes),
    removesStarted: sum((m) => m.st.removesStarted),
    removesFinished: sum((m) => m.st.removesFinished),
    i1Seeds: seeds((m) => m.st.i1.length > 0),
    i1First: ms.flatMap((m) => m.st.i1.slice(0, 1)).slice(0, 5),
    i2Seeds: seeds((m) => m.st.i2.length > 0).length,
    i2SeedList: seeds((m) => m.st.i2.length > 0),
    i2OtherSeeds: i2other,
    i2First: ms.flatMap((m) => m.st.i2.slice(0, 1)).slice(0, 3),
    i3Seeds: seeds((m) => m.st.i3.length > 0),
    i3First: ms.flatMap((m) => m.st.i3.slice(0, 1)).slice(0, 3),
    i3late: sum((m) => m.st.i3late),
    i4Seeds: seeds((m) => m.st.i4.length > 0).length,
    i4SeedList: seeds((m) => m.st.i4.length > 0),
    i4kinds,
    i4First: ms.flatMap((m) => m.st.i4.slice(0, 1)).slice(0, 3),
    lostRemoveSeeds: seeds((m) => m.st.lostRemove > 0).length,
    doneButListed: sum((m) => m.st.doneButListed),
    groupReachSteps: sum((m) => m.st.groupReach),
    groupRuns: ms.filter((m) => m.group !== null).length,
    queuedSteps: sum((m) => m.st.queuedSteps),
    queuedBReadsCurrent: sum((m) => m.st.queuedBReadsCurrent),
    queuedHonest: sum((m) => m.st.queuedHonest),
    deletes: ms.reduce((a, m) => { for (const [k, v] of Object.entries(m.st.deletes)) a[k] = (a[k] ?? 0) + v; return a }, {} as Record<string, number>),
    wrongDeletes: ms.flatMap((m) => m.st.wrongDeletes).slice(0, 5),
    wrongDeleteSeeds: seeds((m) => m.st.wrongDeletes.length > 0).length,
  }
}
