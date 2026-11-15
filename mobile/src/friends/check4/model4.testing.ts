/**
 * CHECKER round 4 (YAZ-5083): my own attack. It reuses the check3 world (the fake gist API behind the phone's real
 * client, the recording fetch, the BFS over every revision) and adds:
 * - a SENDER on each device (sends, numbers-gone, the zone write), with one lock per device shared with the list;
 * - 409 on a PATCH of a gist that another PATCH is writing at that moment (and 2 % at random);
 * - crash points up to call 60; unexpected throws are recorded, not fatal;
 * - zone changes (Settings), a re-share after a 'stopped' or 'gone' row, a group run by B with A in it;
 * - an OLD app (the v1 code from before fb1ff8ac9) on one more A phone, which made the list (v1) at the start.
 * Invariants: I1..I4 (the builder's), I2 strict at the end, I4 strict (GET-only "read"), I5 (no two live entries for
 * one friend), I6 (after a successful send, every kept paired friend reads the numbers just sent).
 *
 * BUILDER CHANGES (YAZ-5083, the list in the vault repo; the checker's rules are unchanged):
 * - the list is `.yaseendocs/friends.json` of the actor's vault repo (`listOf` of the check3 model); I7 (every list
 *   write is a fast forward of the list its writer read) comes from the check3 model's ref-move check;
 * - the fake GitHub is the strict one (`shared/friendGistsFake.ts`, `shared/friendRepoFake.ts`): 409 and 422 on gists
 *   are GitHub's own now (this file's extra 2 % of 409 stays, on GIST paths only: a ref move of the repo is not a gist);
 * - `maxListFiles` counts the records of the list file.
 */
import { INDEX_FILE, POINTER_FILE, readListFiles, type GistsApi } from '@shared/friendGists'
import { friendLink } from '@shared/friendsList'
import { emptyBudget, recordUpdate, numbersFor, type GistBudget } from '@shared/friendSend'
import { friendStats } from '@shared/friendStats'
import { githubClient, type FetchLike } from '../../github/client'
import { PHONE, vaultId } from '../../store'
import { INDEX_STATE } from '../../sync/phoneIndex'
import type { SyncEvent } from '../../sync/engine'
import { Model, mulberry, type Ev } from '../check3/model.testing'
import { gistsApi } from '../gistsApi'
import { createFriendsList, type FriendsList } from '../list'
import { createFriendsSender, type FriendsSender } from '../sender'
import * as oldGists from './old/friendGists'
import * as oldList from './old/friendsList'
import * as oldSend from './old/friendSend'

type Actor = 'A' | 'B' | 'C'
const LOGIN = { A: 'ali', B: 'bea', C: 'cem' } as const
const tok = (a: Actor) => `github_pat_11CHECK3_${LOGIN[a].padEnd(70, '0')}`
const ZONES = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo']

type Lock = <T>(name: string, fn: () => Promise<T>) => Promise<T>
function mutex(): Lock {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(_name: string, fn: () => Promise<T>) => {
    const run = tail.then(fn, fn)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
interface FakeSync {
  subscribe(l: (e: SyncEvent) => void): () => void
  pass(): void
}
function fakeSync(now: () => number): FakeSync {
  const ls = new Set<(e: SyncEvent) => void>()
  let c = 0
  return {
    subscribe(l) {
      ls.add(l)
      return () => ls.delete(l)
    },
    pass() {
      for (const l of ls) l({ type: 'changed', vault: 'x@main', commit: `c${++c}`, diff: { added: [], changed: [], removed: [], renamed: [] } as never, settings: [], index: { commit: `c${c}`, records: {} } } as SyncEvent)
      for (const l of ls) l({ type: 'state', state: { status: 'synced', vault: 'x@main', problem: null, retryAt: null, progress: null, lastSyncedAt: now(), ready: true } } as SyncEvent)
    },
  }
}

export interface Stats4 {
  i2strict: string[]
  i4strict: string[]
  i4strictOldGist: string[]
  i5: string[]
  i6: string[]
  i6parked: number
  throws: string[]
  c409: number
  c422: number
  sends: number
  sendsSent: number
  oldOps: number
  oldWrites: number
  oldBlocked: number
  oldHeadOverV2: number
  zoneLost: string[]
  maxListFiles: number
  maxTombs: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class Model4 extends Model {
  st4: Stats4 = { i2strict: [], i4strict: [], i4strictOldGist: [], i5: [], i6: [], i6parked: 0, throws: [], c409: 0, c422: 0, sends: 0, sendsSent: 0, oldOps: 0, oldWrites: 0, oldBlocked: 0, oldHeadOverV2: 0, zoneLost: [], maxListFiles: 0, maxTombs: 0 }
  inflight = new Map<string, number>()
  inflightBy = new Map<string, Set<{ d: any }>>()
  /** A crashed app's request is over (it landed or not): it no longer counts as a write at this moment. */
  clearInflight(d: any) {
    for (const [id, set] of this.inflightBy) {
      for (const m of [...set]) if (m.d === d) set.delete(m)
      this.inflight.set(id, set.size)
    }
  }
  p409 = 0.02
  parallel = 0
  cards: Record<string, number> = {}
  oldDev: any = null
  oldBudget: GistBudget = emptyBudget()
  oldCache = oldList.newListCache()
  lastGet = new Map<any, Record<string, string> | null>()
  zoneSet: string | null = null
  events: Ev[] = []
  bPairedEver = false

  constructor(seed: number) {
    super(seed)
    this.rng = mulberry(seed ^ 0x5eed4)
  }

  // ---- devices: a lock shared by the list and the sender; a sender on each new device ----
  override newList(d: any): FriendsList {
    if (d.lock === undefined) d.lock = mutex()
    const skew = this.skew[`${d.actor}${d.n}`] ?? 0
    const clock = skew === 0 ? this.clock : { ...this.clock, now: () => this.clock.now() + skew }
    const list = createFriendsList({ store: d.store, tokens: d.tokens, clock, fetch: this.fetchFor(d), sleep: async () => {}, lock: d.lock })
    if (d.sync === undefined) d.sync = fakeSync(this.clock.now)
    d.sender?.stop()
    d.sender = createFriendsSender({ store: d.store, tokens: d.tokens, sync: d.sync, clock: this.clock, fetch: this.fetchFor(d), sleep: async () => {}, lock: d.lock }) as FriendsSender
    return list
  }

  override async act<T>(d: any, name: string, fn: (l: FriendsList) => Promise<T>): Promise<T | 'crash'> {
    let r: T | 'crash'
    try {
      r = await Promise.race([fn(d.list), d.crashed])
    } catch (err) {
      this.st4.throws.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} ${name} threw ${(err as Error)?.message ?? String(err)}`.slice(0, 300))
      return 'crash'
    }
    if (r === 'crash') {
      d.dead = false
      d.crashAt = null
      d.calls = 0
      d.lastList = null
      this.lastGet.set(d, null)
      d.lock = mutex()
      this.clearInflight(d)
      this.arm(d)
      d.list = this.newList(d)
      this.log.push(`  ${d.actor}${d.n} ${name}: app closed; restarted`)
      return 'crash'
    }
    return r
  }

  // ---- 409 on a PATCH of a gist that another PATCH writes at the same moment; GET-only "read" for I4 strict ----
  override fetchFor(d: any): FetchLike {
    const inner = super.fetchFor(d)
    return async (url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      const id = new URL(url).pathname.split('/')[2] ?? ''
      const gistPath = new URL(url).pathname.startsWith('/gists/')
      if (method === 'PATCH' && gistPath && !d.dead && !(this.step < d.offlineUntil)) {
        const busy = (this.inflight.get(id) ?? 0) > 0
        if ((busy && this.rng() < 0.6) || this.rng() < this.p409) {
          this.st4.c409++
          return new Response(JSON.stringify({ message: 'Gist cannot be updated.' }), { status: 409, headers: { 'content-type': 'application/json' } })
        }
        // GitHub (live, round 4): a PATCH that sets a file to null that the gist does not have is refused whole, 422.
        if (process.env.G422 === '1') {
          const g = this.gist(id)
          const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { files?: Record<string, unknown> }) : {}
          if (g !== undefined && Object.entries(body.files ?? {}).some(([n, f]) => f === null && !(n in g.files))) {
            this.st4.c422++
            return new Response(JSON.stringify({ message: 'Validation Failed', errors: [{ resource: 'Gist', code: 'missing_field', field: 'files' }] }), { status: 422, headers: { 'content-type': 'application/json' } })
          }
        }
        const mark = { d }
        const set = this.inflightBy.get(id) ?? new Set<{ d: any }>()
        this.inflightBy.set(id, set)
        set.add(mark)
        this.inflight.set(id, set.size)
        try {
          for (let i = 0; i < 2 + Math.floor(this.rng() * 4); i++) await null
          if (method === 'PATCH') this.checkI4strict(d, id, init)
          return await inner(url, init)
        } finally {
          set.delete(mark)
          this.inflight.set(id, set.size)
        }
      }
      const res = await inner(url, init)
      if (method === 'GET' && res.status === 200 && id !== '') {
        try {
          const doc = (await res.clone().json()) as { files?: Record<string, { content?: string }> }
          if (doc.files !== undefined && INDEX_FILE in doc.files) this.lastGet.set(d, Object.fromEntries(Object.entries(doc.files).filter(([, f]) => typeof f?.content === 'string').map(([n, f]) => [n, f.content as string])))
        } catch {
          /* */
        }
      }
      return res
    }
  }

  checkI4strict(d: any, id: string, init: RequestInit) {
    const g = this.gist(id)
    if (g === undefined || !(INDEX_FILE in g.files)) return
    // BUILDER CHANGE (YAZ-5083): once the list moved into the vault repo, this gist is the note, not the list (see the
    // check3 model's `i4oldGist`); its writes are counted apart.
    const moving = typeof init.body === 'string' && /"v\\?":3[,}]/.test(JSON.stringify((JSON.parse(init.body) as { files?: Record<string, { content?: string } | null> }).files?.[INDEX_FILE]?.content ?? ''))
    const moved = moving || g.revisions.some((r) => /"v":3[,}]/.test(r[INDEX_FILE] ?? ''))
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { files?: Record<string, { content?: string } | null> }) : {}
    const after: Record<string, string> = { ...g.files }
    for (const [n, f] of Object.entries(body.files ?? {})) {
      if (f === null) delete after[n]
      else if (typeof f.content === 'string') after[n] = f.content
    }
    const keys = (files: Record<string, string> | null | undefined) => {
      if (!files) return new Set<string>()
      const r = readListFiles(files)
      if (r.kind !== 'ok') return new Set<string>()
      return new Set([...r.value.friends.map((f) => `f:${f.mine}`), ...r.value.groups.map((x) => `g:${x.mine}`), ...(r.value.shared ?? []).map((x) => `s:${x.mine}`), ...(r.raw.rekey ? ['rekey'] : [])])
    }
    const before = keys(g.files)
    const read = keys(this.lastGet.get(d))
    const next = keys(after)
    const lost = [...before].filter((k) => !read.has(k) && !next.has(k))
    if (lost.length > 0) (moved ? this.st4.i4strictOldGist : this.st4.i4strict).push(`seed ${this.seed} step ${this.step}: ${d.old ? 'OLD ' : ''}${d.actor}${d.n} write drops ${lost.join(',')} that it never GET-read`)
    // The zone: a write that drops the home zone that another write set.
    const z = (files: Record<string, string>) => {
      try {
        return (JSON.parse(files[INDEX_FILE]) as { zone?: string }).zone ?? null
      } catch {
        return null
      }
    }
    if (z(g.files) !== null && z(after) === null) this.st4.zoneLost.push(`seed ${this.seed} step ${this.step}: ${d.old ? 'OLD ' : ''}${d.actor}${d.n} head write drops zone ${z(g.files)}`)
    if (d.old) {
      this.st4.oldWrites++
      try {
        const v = (JSON.parse(g.files[INDEX_FILE]) as { v?: number }).v
        if (v === 2 && body.files?.[INDEX_FILE] !== undefined) {
          this.st4.oldHeadOverV2++
          this.log.push(`  OLD head write over a v2 head (step ${this.step})`)
        }
      } catch {
        /* */
      }
    }
  }

  // ---- setup ----
  async setup4(nA: number, nB: number, nC: number, withGroup: boolean, withBGroup: boolean, withOld: boolean) {
    for (let i = 0; i < nA; i++) this.devs.A.push(await this.device('A', i))
    for (let i = 0; i < nB; i++) this.devs.B.push(await this.device('B', i))
    for (let i = 0; i < nC; i++) this.devs.C.push(await this.device('C', i))
    const c = this.devs.C[0].list
    if (withOld) {
      // The old app made the list (v1) and paired with C.
      const d: any = await this.device('A', 9)
      d.old = true
      this.oldDev = d
      const api = this.oldApi()
      const made = await oldGists.ensureFriendsFiles(api, { vaults: ['ali/vault'], nickname: null }, this.oldOpts())
      if (made.kind !== 'ok') throw new Error('old list ' + made.kind)
      const s = await oldList.shareLink(api, made.handle, this.oldOpts())
      this.give('A', 'C', s.pointer)
      const p = await c.paste(s.link)
      if (p.kind !== 'added' || p.sendBack === null) throw new Error('setup paste ' + p.kind)
      this.give('C', 'A', p.sendBack.split('#')[1])
      const h = await this.oldHandle()
      const q = await oldList.pasteLink(api, h!, p.sendBack, this.oldOpts())
      if (q.kind !== 'added') throw new Error('old paste back ' + q.kind)
      await c.rows()
    } else {
      const a = this.devs.A[0].list
      const s = await a.share()
      if (s.kind !== 'ok') throw new Error('setup share ' + s.kind)
      this.give('A', 'C', s.link.split('#')[1])
      const p = await c.paste(s.link)
      if (p.kind !== 'added' || p.sendBack === null) throw new Error('setup paste ' + p.kind)
      this.give('C', 'A', p.sendBack.split('#')[1])
      const q = await a.paste(p.sendBack)
      if (q.kind !== 'added') throw new Error('setup paste back ' + q.kind)
      await a.rows()
      await c.rows()
    }
    const a0 = this.devs.A[0].list
    if (withGroup && !withOld) {
      this.groupCtx = true
      const g = await a0.groups.create('Club')
      if (g.kind !== 'ok') throw new Error('group ' + g.kind)
      this.group = { id: g.group, link: g.link }
      for (const who of ['B', 'C'] as const) {
        const j = await this.devs[who][0].list.groups.join(g.link)
        if (j.kind !== 'joined') throw new Error('join ' + j.kind)
        const added = await a0.groups.add(g.group, j.sendToAdmin)
        if (!('kind' in added) || added.kind !== 'done') throw new Error('add')
        await this.devs[who][0].list.groups.read(g.group)
      }
      this.groupCtx = false
    }
    if (withBGroup && !withOld) {
      // B runs a group; A and C are in it: B reads A's group pointer (the recorded limit), never a violation.
      this.groupCtx = true
      const b0 = this.devs.B[0].list
      const g = await b0.groups.create('B club')
      if (g.kind !== 'ok') throw new Error('bgroup ' + g.kind)
      const j = await a0.groups.join(g.link)
      if (j.kind !== 'joined') throw new Error('bjoin ' + j.kind)
      const added = await b0.groups.add(g.group, j.sendToAdmin)
      if (!('kind' in added) || added.kind !== 'done') throw new Error('badd')
      await a0.groups.read(g.group)
      this.groupCtx = false
    }
    this.log.push(`setup A${nA}${withOld ? '+old' : ''} B${nB} C${nC}${withGroup ? ' +group' : ''}${withBGroup ? ' +bgroup' : ''}`)
  }

  // ---- the old app (v1 code) on A's extra phone ----
  oldOpts() {
    return { describe: (k: string) => `notecards-test ${k}`, sleep: async () => {}, now: this.clock.now } as any
  }
  oldApi(): GistsApi {
    return gistsApi(githubClient(tok('A'), { fetch: this.fetchFor(this.oldDev), now: this.clock.now })) as unknown as GistsApi
  }
  async oldHandle(): Promise<any | null> {
    const f = await oldGists.findFriendsIndex(this.oldApi() as any, this.oldOpts())
    if (f.kind !== 'ok') {
      this.st4.oldBlocked++
      return null
    }
    return f.handle
  }
  async oldOp(op: string): Promise<string> {
    const d = this.oldDev
    this.st4.oldOps++
    const body = async (): Promise<string> => {
      const api = this.oldApi() as any
      const o = this.oldOpts()
      const h = await this.oldHandle()
      if (h === null) return 'blocked (newer list)'
      switch (op) {
        case 'share': {
          const s = await oldList.shareLink(api, h, o)
          const to: Actor = this.rng() < 0.75 ? 'B' : 'C'
          this.give('A', to, s.pointer)
          if (to === 'B') this.reAdd('OLD A shared a link to B')
          return `-> ${s.pointer.slice(0, 6)} to ${to}`
        }
        case 'paste': {
          const box = this.inbox.A
          if (box.length === 0) return 'empty'
          const it = box[Math.floor(this.rng() * box.length)]
          const r = await oldList.pasteLink(api, h, friendLink(it.id), o)
          if (r.kind === 'added') {
            if (it.from === 'B') this.reAdd('OLD A pasted a B link')
            if (r.sendBack !== null && this.rng() < 0.8) {
              this.give('A', it.from as Actor, r.sendBack.split('#')[1])
              if (it.from === 'B') this.reAdd('OLD A sent back to B')
            }
          }
          return `${it.id.slice(0, 6)} -> ${r.kind}`
        }
        case 'removeB': {
          const ents = (h.index.friends as { mine: string; theirs: string }[]).filter((f) => this.gist(f.theirs)?.owner === 'bea' || this.revisionsOwner(f.theirs) === 'bea')
          if (ents.length === 0) return 'none'
          this.cut = true
          this.cutDone = false
          this.st.removesStarted++
          let out = ''
          for (const e of ents) {
            this.bMinesTargeted.add(e.mine)
            const r = await oldList.removeFriend(api, (await this.oldHandle()) ?? h, e.mine, this.oldBudget, o)
            this.oldBudget = r.budget
            out += `${e.mine.slice(0, 6)}:${r.kind} `
          }
          return out
        }
        case 'rows': {
          let hh = h
          if (oldList.pendingRemove(hh) !== null) {
            const r = await oldList.finishRemove(api, hh, this.oldBudget, o)
            this.oldBudget = r.budget
            hh = r.handle
          }
          const rows = await oldList.readFriends(api, hh, this.oldCache, this.clock.now())
          if (rows.newlyPaired.length > 0) hh = await oldList.markPaired(api, hh, rows.newlyPaired, o)
          if (rows.held.length > 0) hh = await oldList.dropHeldShares(api, hh, rows.held, o)
          if (rows.repairs.length > 0) hh = await oldList.repairPairs(api, hh, rows.repairs, o)
          return rows.rows.map((x: any) => `${x.name}:${x.state}`).join(',')
        }
        case 'send': {
          if (oldList.pendingRemove(h) !== null) {
            const r = await oldList.finishRemove(api, h, this.oldBudget, o)
            this.oldBudget = r.budget
            return `finish ${r.kind}`
          }
          if (h.index.stats === null) return 'no stats'
          const fresh = numbersFor(friendStats([], this.clock.now()), { login: 'ali', name: 'ALI', avatar: '', nickname: null } as any, this.clock.now())
          const r = await oldSend.sendNumbers(api, { statsId: h.index.stats, fresh, budget: this.oldBudget, reserve: 0, now: this.clock.now() } as any)
          this.oldBudget = r.budget
          if (r.outcome.kind === 'numbers-gone') {
            const x = await oldGists.replaceNumbersGist(api, h, JSON.stringify(fresh), o)
            for (let i = 0; i < x.pointers.updated.length + 1; i++) this.oldBudget = recordUpdate(this.oldBudget, this.clock.now(), null)
            return 'remade'
          }
          return r.outcome.kind
        }
      }
      return '?'
    }
    try {
      const r = await Promise.race([body(), d.crashed])
      if (r === 'crash') {
        d.dead = false
        d.crashAt = null
        d.calls = 0
        this.clearInflight(d)
        this.arm(d)
        this.oldCache = oldList.newListCache()
        return 'crash'
      }
      return r as string
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      // The old app's own refusals are fine (a newer list): only record other throws.
      if (!/newer|NewerList/i.test(msg) && !(err as any)?.code) this.st4.throws.push(`seed ${this.seed} step ${this.step}: OLD ${op} threw ${msg}`.slice(0, 300))
      return `threw ${(err as any)?.code ?? msg.slice(0, 40)}`
    }
  }

  // ---- events ----
  override async run(ev: Ev): Promise<void> {
    if (ev.par === undefined && !['send', 'zone', 'reshare', 'old', 'bothOld', 'bothSend'].includes(ev.t)) return super.run(ev)
    if (ev.par !== undefined) return super.run(ev)
    this.step++
    this.st.steps++
    const who = (ev.who ?? 'A') as Actor
    const devs = this.devs[who]
    const d: any = devs[(ev.dev ?? 0) % devs.length]
    let out = ''
    switch (ev.t) {
      case 'send': {
        out = await this.send(d)
        break
      }
      case 'bothSend': {
        // A send on one A device while another A device acts.
        if (this.devs.A.length < 2) break
        this.parallel++
        const ops = ['rows', 'share', 'removeB', 'cancel', 'paste'] as const
        const o = this.pick(ops)
        this.step--
        this.st.steps--
        await Promise.all([this.send(this.devs.A[0] as any), this.run({ t: o, who: 'A', dev: 1 })])
        this.parallel--
        out = `send || ${o}`
        break
      }
      case 'zone': {
        const zone = this.pick(ZONES)
        const r = await this.act(d, 'zone', async (l) => {
          try {
            await l.port.saveSettings({ vaults: null, nickname: null, zone } as any)
            return 'ok'
          } catch (err) {
            return `refused ${(err as Error).message.slice(0, 30)}`
          }
        })
        if (r === 'ok') this.zoneSet = zone
        out = `${zone} ${r}`
        break
      }
      case 'reshare': {
        // A friend whose row says 'stopped' or 'gone' shares a new link; A pastes it; A's link goes back.
        const x: Actor = this.rng() < 0.6 ? 'B' : 'C'
        const xd: any = this.devs[x][Math.floor(this.rng() * this.devs[x].length)]
        const rows = await this.act(xd, 'rows', (l) => l.rows())
        const bad = rows !== 'crash' && rows.kind === 'ok' && rows.rows.some((r) => r.state === 'stopped' || r.state === 'gone')
        if (!bad) {
          out = `${x}: no stopped row`
          break
        }
        const s = await this.act(xd, 'share', (l) => l.share())
        if (s === 'crash' || s.kind !== 'ok') {
          out = `${x} share ${s === 'crash' ? 'crash' : s.kind}`
          break
        }
        const id = s.link.split('#')[1]
        this.give(x, 'A', id)
        const ad: any = this.devs.A[Math.floor(this.rng() * this.devs.A.length)]
        const p = await this.act(ad, 'paste', (l) => l.paste(friendLink(id)))
        out = `${x} reshares ${id.slice(0, 6)}; A paste ${p === 'crash' ? 'crash' : p.kind}`
        if (p !== 'crash' && p.kind === 'added') {
          if (x === 'B') this.reAdd('A pasted a B re-share')
          if (p.sendBack !== null) {
            const sb = p.sendBack.split('#')[1]
            this.give('A', x, sb)
            const q = await this.act(xd, 'paste', (l) => l.paste(friendLink(sb)))
            out += `; ${x} paste back ${q === 'crash' ? 'crash' : q.kind}`
          }
        }
        break
      }
      case 'old': {
        if (this.oldDev === null) break
        const op = this.pick(['share', 'paste', 'removeB', 'rows', 'send', 'rows'])
        out = `OLD ${op}: ${await this.oldOp(op)}`
        break
      }
      case 'bothOld': {
        if (this.oldDev === null) break
        const op = this.pick(['share', 'paste', 'removeB', 'rows', 'send'])
        const o2 = this.pick(['rows', 'share', 'removeB', 'cancel', 'paste', 'zone'] as const)
        this.parallel++
        this.step--
        this.st.steps--
        let r1 = ''
        await Promise.all([
          (async () => {
            r1 = await this.oldOp(op)
          })(),
          this.run({ t: o2, who: 'A', dev: this.rng() < 0.5 ? 0 : 1 }),
        ])
        this.parallel--
        out = `OLD ${op}: ${r1} || ${o2}`
        break
      }
    }
    this.log.push(`${String(this.step).padStart(2)} ${ev.t} ${who}${d?.n ?? ''} ${out}`)
    await this.check()
  }

  async send(d: any): Promise<string> {
    this.st4.sends++
    const key = `${d.actor}${d.n}`
    this.cards[key] = (this.cards[key] ?? 0) + 1
    const n = this.cards[key] + (this.cards[`${d.actor}*`] = (this.cards[`${d.actor}*`] ?? 0) + 1)
    const at = this.clock.now()
    const cards = Array.from({ length: n }, (_, i) => ({ id: `C-${i + 1}`, off: false, next: false, reviews: [{ at: new Date(at - (i + 1) * 1000).toISOString(), rating: 'good', seconds: 5 }] }))
    await d.store.setState(vaultId({ repo: `${LOGIN[d.actor as Actor]}/vault`, branch: 'main' }), INDEX_STATE, { commit: 'c', records: { 'cards.md': { path: 'cards.md', cards } } })
    const r = await this.act(d, 'send', async () => {
      d.sync.pass()
      await d.sender.idle()
      return d.sender.state()
    })
    if (r === 'crash') return 'crash'
    const status = (r as { status: string }).status
    if (status === 'sent' && d.actor === 'A') {
      this.st4.sendsSent++
      if (this.parallel === 0) this.checkI6(`send ${d.actor}${d.n}`)
    }
    return status
  }

  // ---- invariants ----
  /** Mutually paired friends of A: [actor, A's mine for them, their theirs entries]. */
  keptFriends(): { x: Actor; mine: string }[] {
    const l = this.listOf('A')
    if (l === null) return []
    const out: { x: Actor; mine: string }[] = []
    for (const x of ['B', 'C'] as Actor[]) {
      if (x === 'B' && this.cut) continue
      const xl = this.listOf(x)
      for (const e of xl?.index.friends ?? []) {
        if (e.paired !== true) continue
        if (l.index.friends.some((f) => f.mine === e.theirs)) out.push({ x, mine: e.theirs })
      }
    }
    return out
  }

  checkI6(when: string) {
    const l = this.listOf('A')
    if (l === null || l.raw.rekey) return
    const stats = l.index.stats
    for (const { x, mine } of this.keptFriends()) {
      const p = this.gist(mine)?.files[POINTER_FILE]
      const named = p === undefined ? 'GONE' : (JSON.parse(p) as { stats: string }).stats
      if (named === stats) continue
      if (/^0+$/.test(named)) this.st4.i6parked++
      this.st4.i6.push(`seed ${this.seed} step ${this.step}: after ${when}, ${x} (kept, paired) reads ${named === 'GONE' ? 'a deleted pointer' : /^0+$/.test(named) ? 'a PARKED pointer' : named.slice(0, 6)} via A's ${mine.slice(0, 6)}; the send wrote ${stats?.slice(0, 6)}`)
    }
  }

  checkI5(tag: string) {
    for (const a of ['A', 'B', 'C'] as Actor[]) {
      const l = this.listOf(a)
      if (l === null) continue
      const owners = new Map<string, string[]>()
      for (const f of l.index.friends) {
        // Live: the friend's pointer still exists (a grey 'gone' or 'stopped' row is not live; it stays by design).
        if (this.gist(f.theirs) === undefined) continue
        const o = this.gist(f.theirs)?.owner ?? `?${f.theirs.slice(0, 6)}`
        owners.set(o, [...(owners.get(o) ?? []), f.mine.slice(0, 6)])
      }
      for (const [o, mines] of owners) if (mines.length > 1) this.st4.i5.push(`seed ${this.seed} step ${this.step} ${tag}: ${a}'s list holds ${mines.length} live entries for ${o} (mine ${mines.join(',')})`)
    }
  }

  override async check(): Promise<void> {
    // Let each sender's timer work end first (a crash ends it too).
    for (const a of ['A', 'B', 'C'] as Actor[]) for (const d of this.devs[a] as any[]) await Promise.race([d.sender?.idle(), d.crashed])
    await super.check()
    const files = this.repoFiles('ali', null)
    if (files !== null) {
      const n = Object.keys(files).length
      if (n > this.st4.maxListFiles) this.st4.maxListFiles = n
      const t = Object.keys(files).filter((x) => x.includes('.x.')).length
      if (t > this.st4.maxTombs) this.st4.maxTombs = t
    }
    if (this.parallel === 0) this.checkI5('during')
  }

  /** At the end: every app restarted (new session), online, an hour later; rows twice, then each A device sends. */
  async endPhase() {
    for (const a of ['A', 'B', 'C'] as Actor[]) for (const d of this.devs[a] as any[]) d.offlineUntil = -1
    if (this.oldDev) this.oldDev.offlineUntil = -1
    this.rateBlock = {}
    this.p409 = 0
    this.clock.advance(61 * 60_000)
    for (const a of ['A', 'B', 'C'] as Actor[])
      for (const d of this.devs[a] as any[]) {
        d.crashAt = null
        d.list = this.newList(d)
      }
    for (let k = 0; k < 2; k++)
      for (const a of ['A', 'B', 'C'] as Actor[])
        for (const d of this.devs[a]) {
          await this.run({ t: 'rows', who: a, dev: d.n })
          await this.settle()
        }
    for (const d of this.devs.A) {
      this.clock.advance(6 * 60_000)
      await this.run({ t: 'send', who: 'A', dev: d.n })
    }
    // I2 strict: C (never removed by A) is still in A's list; and each friend X who reads a pointer that A's list KEEPS
    // for X (X's entry names A's mine) reads A's current numbers through it, after restarts, rows and sends.
    const l = this.listOf('A')
    const stats = l?.index.stats ?? null
    const cIn = (l?.index.friends ?? []).some((f) => (this.gist(f.theirs)?.owner ?? this.revisionsOwner(f.theirs)) === 'cem')
    if (!cIn) this.st4.i2strict.push(`seed ${this.seed} end: C is not in A's list any more (A never removed C)`)
    for (const x of ['C', 'B'] as Actor[]) {
      for (const e of this.listOf(x)?.index.friends ?? []) {
        const kept = (l?.index.friends ?? []).find((f) => f.mine === e.theirs)
        if (kept === undefined) continue
        if ((kept.theirs !== e.mine)) continue // A's entry for X names another pointer of X: a pair not finished yet
        const p = this.gist(e.theirs)?.files[POINTER_FILE]
        const named = p === undefined ? 'GONE' : (JSON.parse(p) as { stats: string }).stats
        if (named !== stats) this.st4.i2strict.push(`seed ${this.seed} end: ${x} reads A's kept pointer ${e.theirs.slice(0, 6)} (A's entry for ${x} names ${x}'s ${e.mine.slice(0, 6)}), which names ${named === 'GONE' ? 'nothing (deleted)' : /^0+$/.test(named) ? 'PARKED' : named.slice(0, 6)}, not A's current ${stats?.slice(0, 6)}`)
      }
    }
    this.checkI5('end')
  }
}

const TABLE: [string, number][] = [
  ['share', 10],
  ['paste', 14],
  ['rows', 13],
  ['removeB', 7],
  ['removeA', 2],
  ['cancel', 3],
  ['offline', 4],
  ['budget', 3],
  ['ratelimit', 2],
  ['time', 5],
  ['crash', 6],
  ['both', 6],
  ['send', 8],
  ['bothSend', 3],
  ['zone', 2],
  ['reshare', 3],
]
const OLD: [string, number][] = [
  ['old', 10],
  ['bothOld', 8],
]

export function randomEvent4(m: Model4, g: () => number): Ev {
  const table = m.oldDev ? [...TABLE, ...OLD] : TABLE
  const total = table.reduce((s, [, w]) => s + w, 0)
  let x = g() * total
  let t = table[0][0]
  for (const [name, w] of table) if ((x -= w) < 0) {
    t = name
    break
  }
  const who: Actor = ['removeB', 'cancel', 'budget', 'zone', 'bothSend', 'old', 'bothOld'].includes(t) ? 'A' : t === 'removeA' ? 'B' : t === 'send' ? (g() < 0.7 ? 'A' : g() < 0.5 ? 'B' : 'C') : g() < 0.15 ? 'C' : g() < 0.55 ? 'A' : 'B'
  const ev: Ev = { t, who, dev: Math.floor(g() * 3) }
  if (t === 'paste') ev.arg = g() < 0.6 ? 0 : g() < 0.85 ? 1 : 3
  if (t === 'budget') ev.arg = Math.floor(g() * 9)
  if (t === 'time') ev.arg = g() < 0.6 ? 5 * 60_000 : g() < 0.8 ? 61 * 60_000 : 24 * 3600_000
  if (t === 'crash') ev.arg = g() < 0.5 ? 12 : 60
  if (t === 'share' && who === 'C') ev.who = 'A'
  return ev
}

export interface Plan {
  seed: number
  setup: [number, number, number, boolean, boolean, boolean]
  events: Ev[]
}

export function plan(seed: number): Plan {
  const g = mulberry(seed)
  const withOld = g() < 0.3
  const nA = withOld ? 1 + Math.floor(g() * 2) : 1 + Math.floor(g() * 3)
  const setup: Plan['setup'] = [nA, 1 + Math.floor(g() * 3), 1 + Math.floor(g() * 3), !withOld && g() < 0.35, !withOld && g() < 0.25, withOld]
  const n = 40 + Math.floor(g() * 41)
  const probe = { oldDev: withOld ? {} : null } as unknown as Model4
  const events = Array.from({ length: n }, () => randomEvent4(probe, g))
  return { seed, setup, events }
}

export async function runPlan(p: Plan): Promise<Model4> {
  const m = new Model4(p.seed)
  // BUILDER CHANGE (YAZ-5492): the setup is the world before the order, not a step of it: the model's random 409 on a
  // gist PATCH is off there (as `runPlan6` does; seed 9302520's setup stopped at B's group create when three random
  // 409s in a row met it). The draws of the random source stay the same.
  const p409 = m.p409
  m.p409 = 0
  await m.setup4(...p.setup)
  m.p409 = p409
  m.bPairedEver = false
  for (const e of p.events) {
    await m.run(e)
    await m.settle()
    if (!m.bPairedEver && (m.listOf('B')?.index.friends ?? []).some((f) => f.paired === true)) m.bPairedEver = true
  }
  await m.endPhase()
  return m
}

export const violations = (m: Model4): Record<string, string[]> => ({
  I1: m.st.i1,
  I2: m.st.i2,
  I2strict: m.st4.i2strict,
  I3: m.st.i3,
  I4: m.st.i4,
  I4strict: m.st4.i4strict,
  I5: m.st4.i5,
  I6: m.st4.i6,
  I7: m.st.i7,
  wrongDelete: m.st.wrongDeletes,
  /** Reported, not an invariant of the list (YAZ-5083): the old app's writes of its old gist after the move. */
  oldGistAfterMove: [...m.st.i4oldGist, ...m.st4.i4strictOldGist],
  throws: m.st4.throws,
})
