/**
 * CHECKER round 5 (YAZ-5083), taken into the repo by the builder of the round 5 fixes (YAZ-5398): the stale reads now
 * come from the STRICT FAKE itself (`FakeRepoWorld.stale`, the mode the full run uses), not from a fetch wrapper.
 *
 * A fresh attack on the list in the vault repo, over the round 4 model (check4) with:
 * - STALE ref reads: right after a ref move, a read of the branch head may give the head BEFORE the move (GitHub's
 *   read replicas lag; the writer itself can see its own write vanish for a moment);
 * - AutoSync on the Mac pushing page edits to the SAME branch, alone and interleaved with list writes;
 * - 502 on repo calls, GitHub's secondary limit (403 + retry-after) on content creation;
 * - (5b) a 404 for `contents` at a commit that was just made (replica lag of a new object).
 * Invariants: the round 4 set (I1..I7, strict I2/I4, I5, I6, wrong deletes, throws) plus
 * I8 the list file at the head always parses, and the note gist holds ONLY { v, home, about }.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { INDEX_FILE } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { readListFiles } from '@shared/friendGists'
import type { FetchLike } from '../../github/client'
import { mulberry, type Ev } from '../check3/model.testing'
import { Model4, randomEvent4, violations } from '../check4/model4.testing'

export interface Knobs {
  pStale: number
  p502: number
  pSecondary: number
  pContents404: number
}

export class Model5 extends Model4 {
  knobs: Knobs
  g5: () => number
  /** Per repo: the heads in order, and the step of the last move. */
  heads = new Map<string, string[]>()
  #armed = false
  /** Faults on: 502, the secondary limit, and the fake's stale reads (YAZ-5398). */
  get armed(): boolean {
    return this.#armed
  }
  set armed(on: boolean) {
    this.#armed = on
    const repos = this.world.repos
    if (repos !== null && repos !== undefined) repos.stale = on && (this.knobs.pStale > 0 || this.knobs.pContents404 > 0) ? { chance: this.knobs.pStale, contents404: this.knobs.pContents404, rand: this.g5 } : null
  }
  /** One stale head read (the head before the last move), on the next ref read of any device. */
  get staleOnce(): boolean {
    return (this.world.repos?.staleNext ?? 0) > 0
  }
  set staleOnce(on: boolean) {
    this.world.repos!.staleNext = on ? 1 : 0
  }
  st5 = { i1done: [] as string[], doneEarly: 0, stale: 0, r502: 0, secondary: 0, c404: 0, pushes: 0, i8: [] as string[] }

  constructor(seed: number, knobs: Knobs) {
    super(seed)
    this.knobs = knobs
    this.g5 = mulberry(seed ^ 0x5c4ec5)
  }

  hookRepos() {
    const repos = this.world.repos!
    repos.observe = (mv) => {
      const h = this.heads.get(mv.repo) ?? [mv.from]
      h.push(mv.to)
      if (h.length > 6) h.shift()
      this.heads.set(mv.repo, h)
    }
  }

  override fetchFor(d: any): FetchLike {
    const inner = super.fetchFor(d)
    return async (url, init) => {
      const u = new URL(url)
      const method = (init.method ?? 'GET').toUpperCase()
      const repoCall = u.pathname.startsWith('/repos/')
      if (this.armed && repoCall && !d.dead && !(this.step < d.offlineUntil)) {
        if (this.g5() < this.knobs.p502) {
          this.st5.r502++
          return new Response(JSON.stringify({ message: 'Server Error' }), { status: 502, headers: { 'content-type': 'application/json' } })
        }
        if (method === 'POST' && this.g5() < this.knobs.pSecondary) {
          this.st5.secondary++
          return new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }), { status: 403, headers: { 'content-type': 'application/json', 'retry-after': '60' } })
        }
      }
      const res0 = await inner(url, init)
      const res = await this.tamper(d, u, method, init, res0)
      if (process.env.C5_TRACE && repoCall) {
        let extra = ''
        if (/git\/ref\/heads/.test(u.pathname) && res.status === 200) extra = ' -> ' + ((await res.clone().json()) as any).object.sha.slice(0, 6)
        if (method === 'PATCH') extra = ' sha ' + String(JSON.parse(String(init.body)).sha).slice(0, 6)
        if (method === 'POST' && /git\/commits$/.test(u.pathname)) extra = ' parent ' + String(JSON.parse(String(init.body)).parents?.[0]).slice(0, 6)
        if (/contents/.test(u.pathname)) extra = ' ref ' + (u.searchParams.get('ref') ?? '').slice(0, 6)
        this.log.push(`      [${d.actor}${d.n}] ${method} ${u.pathname.split('/').slice(4).join('/').slice(0, 40)} ${res.status}${extra}`)
      }
      return res
    }
  }

  /** The stale reads come from the fake (`FakeRepoWorld.stale`); nothing is changed here. */
  async tamper(_d: any, _u: URL, _method: string, _init: RequestInit, res: Response): Promise<Response> {
    return res
  }

  push(note: string) {
    const repos = this.world.repos!
    if (repos.head('ali/vault') === null) return
    repos.push('ali/vault', { [`pages/p${this.st5.pushes % 7}.md`]: `# page ${note} ${this.st5.pushes}\n` }, 'main', 'sync (mac): pages')
    this.st5.pushes++
  }

  override async run(ev: Ev): Promise<void> {
    if (ev.t === 'autosync') {
      this.step++
      this.st.steps++
      const n = 1 + Math.floor(this.g5() * 3)
      for (let i = 0; i < n; i++) this.push(`s${this.step}`)
      this.log.push(`${String(this.step).padStart(2)} autosync ${n} page commits`)
      await this.check()
      return
    }
    if (ev.t === 'syncDuring') {
      // A list action of A while the Mac's AutoSync pushes page commits to the same branch at the same moment.
      const ops = ['removeB', 'paste', 'share', 'cancel', 'rows', 'zone'] as const
      const o = ops[Math.floor(this.g5() * ops.length)]
      let stop = false
      const pusher = (async () => {
        for (let i = 0; i < 40 && !stop; i++) {
          for (let k = Math.floor(this.g5() * 8); k > 0; k--) await null
          if (this.g5() < 0.35) this.push(`d${this.step}`)
        }
      })()
      this.parallel++
      await this.run({ t: o, who: 'A', dev: ev.dev ?? 0 })
      stop = true
      await pusher
      this.parallel--
      this.log.push(`   (syncDuring ${o})`)
      return
    }
    const before = this.log.length
    await super.run(ev)
    // I1 on "done": right after the app answers `done` for a remove of B (no parallel step, B not re-added), B must not
    // reach A's current numbers, and no remove may still wait in A's list.
    if (ev.t === 'removeB' && this.parallel === 0 && this.cut) {
      const line = this.log.slice(before).find((l) => /^ *\d+ removeB A\d /.test(l))
      const results = line === undefined ? [] : [...line.matchAll(/[0-9a-f]{6}:(\S+)/g)].map((x) => x[1])
      const queued = await this.queues()
      const l0 = this.listOf('A')
      const stillB = this.bEntries().length > 0 || (l0?.index.shared ?? []).some((x) => this.linksGivenToB.has(x.mine)) || queued.some((q) => this.bMinesTargeted.has(q))
      if (results.length > 0 && results.every((r) => r === 'done') && !stillB) {
        const l = this.listOf('A')
        const files = this.repoFiles('ali', null)
        const st = files === null ? null : readListFiles(files)
        const waits = st !== null && st.kind === 'ok' ? st.list.pending.length : 0
        if (waits > 0) this.st5.doneEarly++
        const stats = l?.index.stats ?? null
        if (this.bfs('B', stats).hit) this.st5.i1done.push(`seed ${this.seed} step ${this.step}: removeB said done; B reaches A's current numbers (${waits} removes still wait in the list)`)
      }
    }
  }

  override async check(): Promise<void> {
    await super.check()
    const repos = this.world.repos!
    const text = repos.file('ali/vault', LIST_PATH)
    if (text !== null && parseListFile(text).kind !== 'ok') this.st5.i8.push(`seed ${this.seed} step ${this.step}: A's list file does not parse`)
    for (const g of this.world.owned('ali')) {
      const head = g.files[INDEX_FILE]
      if (head === undefined) continue
      try {
        const o = JSON.parse(head) as Record<string, unknown>
        if (o.v === 3) {
          const keys = Object.keys(o).sort().join(',')
          if (keys !== 'about,home,v' || Object.keys(g.files).length > 1) {
            // Old files may still be in the gist for a moment (tidy is best effort); a key beyond these three is a leak.
            if (keys !== 'about,home,v') this.st5.i8.push(`seed ${this.seed} step ${this.step}: the note holds ${keys}`)
          }
        }
      } catch {
        /* */
      }
    }
  }
}

export function plan5(seed: number) {
  const g = mulberry(seed)
  const withOld = g() < 0.25
  const nA = withOld ? 1 + Math.floor(g() * 2) : 1 + Math.floor(g() * 3)
  const setup: [number, number, number, boolean, boolean, boolean] = [nA, 1 + Math.floor(g() * 3), 1 + Math.floor(g() * 3), !withOld && g() < 0.35, !withOld && g() < 0.25, withOld]
  const n = 40 + Math.floor(g() * 41)
  const probe = { oldDev: withOld ? {} : null } as unknown as Model4
  const events: Ev[] = Array.from({ length: n }, () => {
    const x = g()
    if (x < 0.07) return { t: 'autosync' }
    if (x < 0.13) return { t: 'syncDuring', dev: Math.floor(g() * 3) }
    return randomEvent4(probe, g)
  })
  return { seed, setup, events }
}

export async function runPlan5(seed: number, knobs: Knobs, cut?: number, keep?: number[]): Promise<Model5> {
  const p0 = plan5(seed)
  const p = keep === undefined ? p0 : { ...p0, events: keep.map((i) => p0.events[i]) }
  const m = new Model5(p.seed, knobs)
  m.hookRepos()
  await m.setup4(...p.setup)
  m.armed = true
  for (const e of cut === undefined ? p.events : p.events.slice(0, cut)) {
    await m.run(e)
    await m.settle()
  }
  if (process.env.C5_CALM_END) m.armed = false
  await m.endPhase()
  m.st5.stale = m.world.repos!.staleGiven
  return m
}

export const KEYS5 = ['I1', 'I1done', 'I2', 'I2strict', 'I3', 'I4', 'I4strict', 'I5', 'I6', 'I7', 'I8', 'wrongDelete', 'throws'] as const
export const violations5 = (m: Model5): Record<string, string[]> => ({ ...violations(m), I8: m.st5.i8, I1done: m.st5.i1done })
