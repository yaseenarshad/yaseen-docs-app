/**
 * CHECKER round 3 (YAZ-5083): an independent model checker over the fake gist API, on the PHONE layer
 * (`createFriendsList`: the queue, markPaired, held drops, repairs). Not the builder's property test.
 * It records every gist ID each actor ever SAW (every answer body, every link handed over), and checks I1..I4.
 */
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, isListFile, readListFiles, type FriendsIndex } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld, type FakeGist } from '@shared/friendGistsFake'
import { GROUP_FILE } from '@shared/friendGroups'
import { emptyBudget } from '@shared/friendSend'
import type { IndexRecord } from '@shared/types'
import { saveAccount } from '../../auth/account'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, PHONE, type PhoneVault, type TokenStore, type VaultStore } from '../../store'
import { INDEX_STATE } from '../../sync/phoneIndex'
import { fakeClock, type FakeClock } from '../../sync/testing'
import { createFriendsList, type FriendsList } from '../list'
import { gistsFetch } from '../testing'
import { SEND_STATE } from '../sender'
import { REMOVE_QUEUE } from '../removeQueue'
import type { FetchLike } from '../../github/client'

const START = Date.parse('2026-11-14T15:00:00Z')
const LOGIN = { A: 'ali', B: 'bea', C: 'cem' } as const
type Actor = keyof typeof LOGIN
const tok = (a: Actor) => `github_pat_11CHECK3_${LOGIN[a].padEnd(70, '0')}`
const HEX = /[0-9a-f]{32}/g

export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Device {
  actor: Actor
  n: number
  store: VaultStore
  tokens: TokenStore
  list: FriendsList
  offlineUntil: number // step
  crashAt: number | null
  calls: number
  dead: boolean
  crashed: Promise<'crash'>
  fireCrash: () => void
  /**
   * BUILDER CHANGE (YAZ-5312, list v2): the files of the list gist as this device last read or wrote them (was: the text
   * of `notecards-friends.json`). Version 2 keeps the list in the head file and one file for each entry.
   */
  lastList: Record<string, string> | null
}

export interface Stats {
  steps: number
  removesStarted: number
  removesFinished: number
  i1: string[]
  i2: string[]
  i3: string[]
  i3late: number
  i4: string[]
  lostRemove: number
  doneButListed: number
  groupReach: number
  queuedSteps: number
  queuedBReadsCurrent: number
  queuedHonest: number
  stoppedRowsC: number
  crashes: number
  deletes: Record<string, number>
  wrongDeletes: string[]
}

export interface Ev {
  t: string
  sel?: (m: Model) => string | undefined
  par?: Ev[]
  who?: Actor
  dev?: number
  arg?: number
}

export class Model {
  world: FakeGistWorld
  clock: FakeClock
  rng: () => number
  devs: Record<Actor, Device[]> = { A: [], B: [], C: [] }
  seen: Record<Actor, Set<string>> = { A: new Set(), B: new Set(), C: new Set() }
  seenGroup: Record<Actor, Set<string>> = { A: new Set(), B: new Set(), C: new Set() }
  inbox: Record<Actor, { id: string; from: Actor }[]> = { A: [], B: [], C: [] }
  revisions = new Map<string, string[]>()
  createdStep = new Map<string, number>()
  step = 0
  rateBlock: Record<string, number> = {}
  /** A asked to remove B and has not re-added B since. */
  cut = false
  cutDone = false
  cutDoneStep = -1
  bMinesTargeted = new Set<string>()
  group: { id: string; link: string } | null = null
  groupCtx = false
  skew: Record<string, number> = {}
  madeBy = new Map<string, Actor>()
  log: string[] = []
  st: Stats = { steps: 0, removesStarted: 0, removesFinished: 0, i1: [], i2: [], i3: [], i3late: 0, i4: [], lostRemove: 0, doneButListed: 0, groupReach: 0, queuedSteps: 0, queuedBReadsCurrent: 0, queuedHonest: 0, stoppedRowsC: 0, crashes: 0, deletes: {}, wrongDeletes: [] }
  linksGivenToB = new Set<string>()

  constructor(public seed: number) {
    this.rng = mulberry(seed)
    this.clock = fakeClock(START)
    this.world = fakeGistWorld({ accounts: { [tok('A')]: { login: 'ali' }, [tok('B')]: { login: 'bea' }, [tok('C')]: { login: 'cem' } }, now: this.clock.now })
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)]
  }

  gist(id: string): FakeGist | undefined {
    for (const l of Object.values(LOGIN)) {
      const g = this.world.owned(l).find((x) => x.id === id)
      if (g) return g
    }
    return undefined
  }
  allGists(): FakeGist[] {
    return Object.values(LOGIN).flatMap((l) => this.world.owned(l))
  }
  listOf(a: Actor): { id: string; index: FriendsIndex; raw: Record<string, unknown> } | null {
    const g = this.world.owned(LOGIN[a]).find((x) => INDEX_FILE in x.files)
    if (!g) return null
    // BUILDER CHANGE (YAZ-5312): the list is the whole gist (the head and each entry file), not the head file alone.
    const r = readListFiles(g.files)
    return r.kind === 'ok' ? { id: g.id, index: r.value, raw: r.raw } : null
  }
  /** Gist IDs inside group files, and the group files: what a group exposes (a known, recorded fact). */
  groupIds(): Set<string> {
    const out = new Set<string>()
    for (const g of this.allGists())
      if (GROUP_FILE in g.files) {
        out.add(g.id)
        for (const id of g.files[GROUP_FILE].match(HEX) ?? []) out.add(id)
      }
    return out
  }

  async device(actor: Actor, n: number): Promise<Device> {
    const backend = memoryBackend()
    const store = await openVaultStore(backend, { now: this.clock.now })
    const tokens = tokenStoreOn(backend)
    const v: PhoneVault = { repo: `${LOGIN[actor]}/vault`, branch: 'main', addedAt: START }
    await saveVaultList(store, { vaults: [v], open: vaultId(v) })
    await tokens.write(vaultId(v), tok(actor))
    await saveAccount(store, vaultId(v), { login: LOGIN[actor], name: LOGIN[actor].toUpperCase(), avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: START })
    await store.setState(vaultId(v), INDEX_STATE, { commit: 'c', records: { 'a.md': { cards: [] } as unknown as IndexRecord } })
    const d = { actor, n, store, tokens, offlineUntil: -1, crashAt: null, calls: 0, dead: false, lastList: null } as unknown as Device
    this.arm(d)
    d.list = this.newList(d)
    return d
  }
  arm(d: Device) {
    d.crashed = new Promise((done) => (d.fireCrash = () => done('crash')))
  }
  newList(d: Device): FriendsList {
    const skew = this.skew[`${d.actor}${d.n}`] ?? 0
    const clock = skew === 0 ? this.clock : { ...this.clock, now: () => this.clock.now() + skew }
    return createFriendsList({ store: d.store, tokens: d.tokens, clock, fetch: this.fetchFor(d), sleep: async () => {} })
  }

  fetchFor(d: Device): FetchLike {
    const inner = gistsFetch(this.world).fetch
    const m = this
    const hang = () => new Promise<Response>(() => {})
    return async (url, init) => {
      if (d.dead) return hang()
      if (m.step < d.offlineUntil) throw new TypeError('Load failed')
      for (let i = Math.floor(m.rng() * 6); i > 0; i--) await null
      if (d.dead) return hang()
      d.calls++
      const method = (init.method ?? 'GET').toUpperCase()
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { files?: Record<string, { content?: string } | null> }) : undefined
      const path = new URL(url).pathname
      const id = path.split('/')[2] ?? null
      const crashNow = d.crashAt !== null && d.calls >= d.crashAt
      if (crashNow) {
        d.dead = true
        m.st.crashes++
        m.log.push(`  CRASH ${d.actor}${d.n} at call ${d.calls} ${method} ${path}${m.rng() < 0.5 ? ' (after GitHub took it)' : ' (before)'}`)
        if (m.log[m.log.length - 1].endsWith('(after GitHub took it)')) await m.forward(d, inner, url, init, method, body, id)
        d.fireCrash()
        return hang()
      }
      if (method === 'PATCH' && (m.rateBlock[LOGIN[d.actor]] ?? -1) > m.step) {
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: { 'content-type': 'application/json', 'x-ratelimit-resource': 'gist_update', 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '100', 'x-ratelimit-reset': String(Math.ceil((m.clock.now() + 600_000) / 1000)), date: new Date(m.clock.now()).toUTCString() },
        })
      }
      return m.forward(d, inner, url, init, method, body, id)
    }
  }

  async forward(d: Device, inner: FetchLike, url: string, init: RequestInit, method: string, body: { files?: Record<string, { content?: string } | null> } | undefined, id: string | null): Promise<Response> {
    // I4: a write of the list that drops what this device never read.
    // BUILDER CHANGE (YAZ-5312): the list is one gist of many files; a PATCH changes only the files it names. The check
    // runs on each PATCH that names a list file, and compares the whole list before and after it (the server's files
    // with the PATCH applied), with the list as this device last read it. The rule of the check is the same.
    const listPatch = method === 'PATCH' && id !== null && body?.files !== undefined ? Object.keys(body.files).filter(isListFile) : []
    const target = id === null ? undefined : this.gist(id)
    if (listPatch.length > 0 && target !== undefined && INDEX_FILE in target.files) {
      const before = { ...target.files }
      const after: Record<string, string> = { ...before }
      for (const [name, f] of Object.entries(body!.files!)) {
        if (f === null) delete after[name]
        else if (typeof f.content === 'string') after[name] = f.content
      }
      this.checkI4(d, before, after)
    }
    if (method === 'DELETE' && id !== null) this.auditDelete(d, id)
    const res = await inner(url, init as never)
    const text = await res.clone().text()
    if (res.status >= 200 && res.status < 300) {
      const groupish = this.groupIds()
      const readId = method === 'GET' && id !== null ? id : null
      const isGroupRead = this.groupCtx || (readId !== null && (groupish.has(readId) || text.includes(GROUP_FILE)))
      for (const x of text.match(HEX) ?? []) (isGroupRead ? this.seenGroup : this.seen)[d.actor].add(x)
      if (readId !== null) (isGroupRead ? this.seenGroup : this.seen)[d.actor].add(readId)
      // The revisions: everything a gist ever held (a reader with the ID reads each old revision).
      if (method === 'POST' || method === 'PATCH') {
        try {
          const doc = JSON.parse(text) as { id: string; files: Record<string, { content: string }> }
          const all = Object.values(doc.files).map((f) => f.content).join('\n')
          if (!this.revisions.has(doc.id)) this.createdStep.set(doc.id, this.step)
          if (method === 'POST') this.madeBy.set(doc.id, d.actor)
          this.revisions.set(doc.id, [...(this.revisions.get(doc.id) ?? []), all])
        } catch {
          /* no body */
        }
      }
      // BUILDER CHANGE (YAZ-5312): the list as last read or written is the files of the list gist in the answer.
      if (id !== null || method === 'POST') {
        try {
          const doc = JSON.parse(text) as { files?: Record<string, { content?: string }> }
          if (doc.files !== undefined && INDEX_FILE in doc.files && (method === 'GET' || method === 'PATCH' || method === 'POST'))
            d.lastList = Object.fromEntries(Object.entries(doc.files).filter(([n, f]) => isListFile(n) && typeof f?.content === 'string').map(([n, f]) => [n, f.content as string]))
        } catch {
          /* */
        }
      }
    }
    return res
  }

  foreign: string[] = []
  auditDelete(d: Device, id: string) {
    const g = this.gist(id)
    if (g === undefined) {
      this.st.deletes['already gone'] = (this.st.deletes['already gone'] ?? 0) + 1
      return
    }
    const kind = INDEX_FILE in g.files ? 'list' : NUMBERS_FILE in g.files ? 'numbers' : POINTER_FILE in g.files ? 'pointer' : GROUP_FILE in g.files ? 'group' : 'other'
    this.st.deletes[kind] = (this.st.deletes[kind] ?? 0) + 1
    const l = this.listOf(d.actor)
    if (this.madeBy.get(id) !== d.actor) this.st.wrongDeletes.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} deletes ${id.slice(0, 6)} (${Object.keys(g.files).join(',')}), not made by its app`)
    else if (l !== null && l.index.stats === id && (l.raw.rekey === undefined || l.raw.rekey === null)) this.st.wrongDeletes.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} deletes the numbers gist the list names, with no remove waiting`)
  }

  checkI4(d: Device, serverBefore: Record<string, string>, next: Record<string, string>) {
    // BUILDER CHANGE (YAZ-5312): each state is the whole list gist, read with the app's reader of version 2.
    const keys = (files: Record<string, string> | null) => {
      if (files === null) return { set: new Set<string>(), rekey: false, stats: null as string | null }
      const r = readListFiles(files)
      if (r.kind !== 'ok') return { set: new Set<string>(), rekey: false, stats: null as string | null }
      const o = r.value
      const set = new Set<string>([...o.friends.map((f) => `f:${f.mine}`), ...o.groups.map((f) => `g:${f.mine}`), ...(o.shared ?? []).map((f) => `s:${f.mine}`)])
      return { set, rekey: r.raw.rekey !== undefined && r.raw.rekey !== null, stats: o.stats ?? null, rk: JSON.stringify(r.raw.rekey ?? null) }
    }
    const s = keys(serverBefore)
    const b = keys(d.lastList)
    const n = keys(next)
    const lost = [...s.set].filter((k) => !b.set.has(k) && !n.set.has(k))
    if (lost.length > 0) this.st.i4.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} wrote the list without ${lost.join(',')} (added by another device after its read)`)
    if (s.rekey && !b.rekey && !n.rekey) this.st.i4.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} wrote the list without the waiting remove (rekey) of another device`)
    if (!s.rekey && s.stats !== n.stats && n.stats === b.stats) this.st.i4.push(`seed ${this.seed} step ${this.step}: ${d.actor}${d.n} wrote back an old numbers gist ID`)
  }

  /** Runs one action of a device; a crash restarts the app on the same phone. */
  async act<T>(d: Device, name: string, fn: (l: FriendsList) => Promise<T>): Promise<T | 'crash'> {
    const r = await Promise.race([fn(d.list), d.crashed])
    if (r === 'crash') {
      d.dead = false
      d.crashAt = null
      d.calls = 0
      d.lastList = null
      this.arm(d)
      d.list = this.newList(d)
      this.log.push(`  ${d.actor}${d.n} ${name}: app closed; restarted`)
      return 'crash'
    }
    return r
  }

  give(from: Actor, to: Actor, id: string) {
    this.inbox[to].push({ id, from })
    this.seen[to].add(id)
    if (to === 'B' && from === 'A') this.linksGivenToB.add(id)
  }

  async setup(nA: number, nB: number, nC: number, withGroup: boolean) {
    for (let i = 0; i < nA; i++) this.devs.A.push(await this.device('A', i))
    for (let i = 0; i < nB; i++) this.devs.B.push(await this.device('B', i))
    for (let i = 0; i < nC; i++) this.devs.C.push(await this.device('C', i))
    // Other tools' gists in A's account: one with a file named like ours, one with our pointer name and more, one plain.
    this.foreign.push(this.world.seed('ali', { [NUMBERS_FILE]: '{"my":"backup"}', 'README.md': 'my own copy' }))
    this.foreign.push(this.world.seed('ali', { [NUMBERS_FILE]: '{"v":1,"note":"another tool"}' }))
    this.foreign.push(this.world.seed('ali', { [POINTER_FILE]: '{"v":1,"stats":"x"}', 'other.txt': 'x' }))
    this.foreign.push(this.world.seed('ali', { 'notes.md': 'hello' }))
    // C is A's paired friend.
    const a = this.devs.A[0].list
    const c = this.devs.C[0].list
    const s = await a.share()
    if (s.kind !== 'ok') throw new Error('setup share ' + s.kind)
    const id = s.link.split('#')[1]
    this.give('A', 'C', id)
    const p = await c.paste(s.link)
    if (p.kind !== 'added' || p.sendBack === null) throw new Error('setup paste ' + p.kind)
    this.give('C', 'A', p.sendBack.split('#')[1])
    const q = await a.paste(p.sendBack)
    if (q.kind !== 'added') throw new Error('setup paste back ' + q.kind)
    await a.rows()
    await c.rows()
    if (withGroup) {
      this.groupCtx = true
      const g = await a.groups.create('Club')
      if (g.kind !== 'ok') throw new Error('group ' + g.kind)
      this.group = { id: g.group, link: g.link }
      for (const who of ['B', 'C'] as const) {
        const j = await this.devs[who][0].list.groups.join(g.link)
        if (j.kind !== 'joined') throw new Error('join ' + j.kind)
        const added = await a.groups.add(g.group, j.sendToAdmin)
        if (!('kind' in added) || added.kind !== 'done') throw new Error('add')
        await this.devs[who][0].list.groups.read(g.group)
      }
      this.groupCtx = false
    }
    this.log.push(`setup A${nA} B${nB} C${nC}${withGroup ? ' +group' : ''}`)
  }

  bEntries(): { mine: string; theirs: string }[] {
    const l = this.listOf('A')
    if (!l) return []
    return l.index.friends.filter((f) => this.gist(f.theirs)?.owner === 'bea' || this.revisionsOwner(f.theirs) === 'bea')
  }
  revisionsOwner(id: string): string | null {
    // A friend's pointer that is gone: who made it (from the seen create answers).
    const a = this.madeBy.get(id)
    return a === undefined ? null : LOGIN[a]
  }
  everShared = new Set<string>()
  ownMade: Record<Actor, Set<string>> = { A: new Set(), B: new Set(), C: new Set() }

  async run(ev: Ev): Promise<void> {
    this.step++
    this.st.steps++
    const who = ev.who ?? 'A'
    const devs = this.devs[who]
    const d = devs[(ev.dev ?? 0) % devs.length]
    const tag = `${String(this.step).padStart(2)} ${ev.t} ${who}${d.n}${ev.arg !== undefined ? ` #${ev.arg}` : ''}`
    let out = ''
    if (ev.par !== undefined) {
      this.step--
      this.st.steps--
      await Promise.all(ev.par.map((e) => this.run(e)))
      return
    }
    switch (ev.t) {
      case 'crashAt':
        d.crashAt = ev.arg ?? 1
        out = `next action stops at call ${d.crashAt}`
        break
      case 'online':
        d.offlineUntil = -1
        break
      case 'offlineLong':
        d.offlineUntil = 1e9
        break
      case 'share': {
        const to: Actor = who === 'A' ? (ev.arg === 1 ? 'C' : ev.arg === 2 ? 'B' : this.rng() < 0.75 ? 'B' : 'C') : 'A'
        const r = await this.act(d, 'share', (l) => l.share())
        if (r !== 'crash' && r.kind === 'ok') {
          const id = r.link.split('#')[1]
          this.ownMade[who].add(id)
          this.give(who, to, id)
          if (who === 'A' && to === 'B') this.reAdd('A shared a new link to B')
          out = `-> ${id.slice(0, 6)}`
        } else out = r === 'crash' ? 'crash' : r.kind
        break
      }
      case 'paste': {
        // own link, the newest, a stale one, or the same again
        const box = this.inbox[who]
        let id: string | undefined
        const mode = ev.arg ?? 0
        if (ev.sel !== undefined) id = ev.sel(this)
        else if (mode === 3) id = [...this.ownMade[who]][0]
        else if (box.length === 0) break
        else if (mode === 0) id = box[box.length - 1].id
        else id = box[Math.floor(this.rng() * box.length)].id
        if (id === undefined) break
        const r = await this.act(d, 'paste', (l) => l.paste(`https://notecards.yaseenarshad.com/friend#${id}`))
        out = `${id.slice(0, 6)} -> ${r === 'crash' ? 'crash' : r.kind}`
        if (r !== 'crash' && r.kind === 'added') {
          const other = box.find((x) => x.id === id)?.from
          if (who === 'A' && other === 'B') this.reAdd('A pasted a B link')
          if (r.sendBack !== null && other !== undefined && (ev.arg === 9 || (ev.arg !== 8 && this.rng() < 0.8))) {
            const sb = r.sendBack.split('#')[1]
            this.ownMade[who].add(sb)
            this.give(who, other, sb)
            if (who === 'A' && other === 'B') this.reAdd('A sent its link back to B')
            out += ` sendBack ${sb.slice(0, 6)}`
          }
        }
        break
      }
      case 'rows': {
        const r = await this.act(d, 'rows', (l) => l.rows())
        out = r === 'crash' ? 'crash' : r.kind === 'ok' ? r.rows.map((x) => `${x.name}:${x.state}`).join(',') : r.kind
        if (who === 'C' && r !== 'crash' && r.kind === 'ok') for (const row of r.rows) if (row.state === 'stopped' || row.state === 'gone') this.st.stoppedRowsC++
        break
      }
      case 'removeB': {
        const entries = this.bEntries()
        const l = this.listOf('A')
        const sharedToB = (l?.index.shared ?? []).filter((s) => this.linksGivenToB.has(s.mine))
        const targets = [...entries.map((e) => e.mine), ...sharedToB.map((s) => s.mine)]
        if (targets.length === 0) break
        this.cut = true
        this.cutDone = false
        this.st.removesStarted++
        for (const m of targets) {
          this.bMinesTargeted.add(m)
          const r = await this.act(d, 'remove', (x) => x.remove(m))
          out += `${m.slice(0, 6)}:${r === 'crash' ? 'crash' : r.kind} `
          if (r !== 'crash' && r.kind === 'done' && this.listOf('A')?.index.friends.some((f) => f.mine === m)) {
            this.st.doneButListed++
            this.log.push(`  NOTE remove said done, but ${m.slice(0, 6)} is still in A's list`)
          }
        }
        break
      }
      case 'removeA': {
        const l = this.listOf('B')
        const ent = (l?.index.friends ?? []).filter((f) => this.gist(f.theirs)?.owner === 'ali' || this.revisionsOwner(f.theirs) === 'ali')
        for (const e of ent) {
          const r = await this.act(d, 'remove', (x) => x.remove(e.mine))
          out += `${e.mine.slice(0, 6)}:${r === 'crash' ? 'crash' : r.kind} `
        }
        break
      }
      case 'cancel': {
        const l = this.listOf('A')
        const s = l?.index.shared ?? []
        if (s.length === 0) break
        const m = this.pick(s).mine
        const r = await this.act(d, 'cancel', (x) => x.remove(m))
        out = `${m.slice(0, 6)}:${r === 'crash' ? 'crash' : r.kind}`
        break
      }
      case 'offline':
        d.offlineUntil = this.step + 1 + Math.floor(this.rng() * 6)
        out = `until ${d.offlineUntil}`
        break
      case 'budget': {
        const saved = (await d.store.getState<Record<string, unknown>>(PHONE, SEND_STATE)) ?? { lastSentAt: null, lastKey: null, pointers: 0 }
        const now = this.clock.now()
        await d.store.setState(PHONE, SEND_STATE, { ...saved, budget: { ...emptyBudget(), updates: Array.from({ length: 100 - (ev.arg ?? 0) }, () => now) } })
        out = `${ev.arg ?? 0} left on this device`
        break
      }
      case 'ratelimit':
        this.rateBlock[LOGIN[who]] = this.step + 1 + Math.floor(this.rng() * 5)
        out = `GitHub refuses PATCH until step ${this.rateBlock[LOGIN[who]]}`
        break
      case 'time':
        this.clock.advance(ev.arg ?? 5 * 60_000)
        break
      case 'crash':
        d.crashAt = 1 + Math.floor(this.rng() * (ev.arg ?? 12))
        out = `next action stops at call ${d.crashAt}`
        break
      case 'restart':
        d.list = this.newList(d)
        break
      case 'both': {
        // Two devices of A act at once.
        if (this.devs.A.length < 2) break
        const [d1, d2] = [this.devs.A[0], this.devs.A[1]]
        const ops = ['rows', 'share', 'removeB', 'cancel', 'paste'] as const
        const o1 = this.pick(ops)
        const o2 = this.pick(ops)
        out = `${o1} || ${o2}`
        this.step--
        this.st.steps--
        await Promise.all([this.run({ t: o1, who: 'A', dev: d1.n }), this.run({ t: o2, who: 'A', dev: d2.n })])
        break
      }
    }
    this.log.push(`${tag} ${out}`)
    await this.check()
  }

  reAdd(why: string) {
    if (this.cut) this.log.push(`  (cut cleared: ${why})`)
    this.cut = false
    this.cutDone = false
  }

  async queues(): Promise<string[]> {
    const out: string[] = []
    for (const d of this.devs.A) for (const q of (await d.store.getState<{ mine: string }[]>(PHONE, REMOVE_QUEUE)) ?? []) out.push(q.mine)
    return out
  }

  queued: string[] = []
  async check() {
    this.queued = await this.queues()
    const l = this.listOf('A')
    for (const x of l?.index.shared ?? []) this.everShared.add(x.mine)
    if (l === null || !this.cut) return
    const stats = l.index.stats
    const waiting = l.raw.rekey !== undefined && l.raw.rekey !== null
    const bListed = this.bEntries().length > 0
    // Is the remove finished? (the list holds no re-key, no B entry, no shared link given to B, and no A phone queues it)
    const queuedB = this.queued.some((m) => this.bMinesTargeted.has(m))
    const sharedToB = (l.index.shared ?? []).some((s) => this.linksGivenToB.has(s.mine))
    const finished = !waiting && !bListed && !queuedB && !sharedToB
    if (!finished) {
      // The window while it waits: can B still read A's CURRENT numbers through a pointer B holds?
      this.st.queuedSteps++
      if (this.bfs('B', stats).hit) this.st.queuedBReadsCurrent++
      const names = (l.raw.rekey as { names?: Record<string, string> } | undefined)?.names ?? {}
      if (queuedB || Object.keys(names).some((m) => this.bMinesTargeted.has(m)) || bListed) this.st.queuedHonest++
      if (this.cutDone && bListed) {
        this.st.lostRemove++
        this.log.push(`  NOTE B is back in A's list after a finished remove (no re-add by A)`)
        this.cutDone = false
      }
      return
    }
    if (!this.cutDone) {
      this.cutDone = true
      this.cutDoneStep = this.step
      this.st.removesFinished++
    }
    // I1
    const r = this.bfs('B', stats)
    if (r.hit) this.st.i1.push(`seed ${this.seed} step ${this.step}: B reaches A's current numbers ${stats?.slice(0, 6)} via ${r.path}`)
    if (r.group) this.st.groupReach++
    // I2: C, a friend in A's list, still reaches A's current numbers.
    const cl = this.listOf('C')
    const aHasC = l.index.friends.some((f) => this.gist(f.theirs)?.owner === 'cem')
    const cEntries = (cl?.index.friends ?? []).filter((f) => f.paired === true)
    if (aHasC && cEntries.length > 0) {
      const ok = cEntries.some((e) => {
        const p = this.gist(e.theirs)?.files[POINTER_FILE]
        return p !== undefined && (JSON.parse(p) as { stats: string }).stats === stats
      })
      if (!ok) this.st.i2.push(`seed ${this.seed} step ${this.step}: [${cEntries.every((e) => this.everShared.has(e.theirs)) ? 'C reads a link A listed as unused' : 'OTHER'}] C (paired, in A's list) does not reach A's current numbers; C reads ${cEntries.map((e) => `${e.theirs.slice(0, 6)}${this.gist(e.theirs) ? '' : '(gone)'}`).join(',')}; A's mine for C ${l.index.friends.filter((f) => this.gist(f.theirs)?.owner === 'cem').map((f) => f.mine.slice(0, 6)).join(',')}`)
    }
    // I3: no orphan gist of A holds the current numbers ID.
    const named = new Set([l.id, ...(stats ? [stats] : []), ...l.index.friends.map((f) => f.mine), ...l.index.groups.flatMap((g) => [g.mine, g.group]), ...(l.index.shared ?? []).map((s) => s.mine)])
    for (const g of this.world.owned('ali')) {
      if (named.has(g.id)) continue
      if (stats !== null && Object.values(g.files).some((t) => t.includes(stats))) {
        const late = (this.createdStep.get(g.id) ?? 0) > this.cutDoneStep
        if (late) this.st.i3late++
        else this.st.i3.push(`seed ${this.seed} step ${this.step}: orphan ${g.id.slice(0, 6)} (${Object.keys(g.files).join(',')}) names A's current numbers`)
      }
    }
  }

  /** From every ID the actor ever saw, through every gist that still exists (all its revisions): does it reach `target`? */
  bfs(actor: Actor, target: string | null): { hit: boolean; path: string; group: boolean } {
    if (target === null) return { hit: false, path: '', group: false }
    const groupish = this.groupIds()
    const from = new Map<string, string>()
    const q: string[] = []
    const own = this.world.owned(LOGIN[actor]).map((g) => g.id)
    for (const id of [...this.seen[actor], ...own]) if (!from.has(id)) (from.set(id, 'seen'), q.push(id))
    let group = false
    // group: what B reaches through the group alone (reported, not a violation)
    for (const id of this.seenGroup[actor]) if (id === target) group = true
    while (q.length > 0) {
      const id = q.shift()!
      if (id === target) {
        const path: string[] = []
        let x: string | undefined = id
        while (x !== undefined && x !== 'seen') {
          path.unshift(x.slice(0, 6))
          x = from.get(x)
        }
        return { hit: true, path: path.join(' -> '), group }
      }
      const g = this.gist(id)
      if (!g) continue
      if (g.owner === 'ali' && groupish.has(id)) {
        group = true
        continue
      }
      const texts = [...Object.values(g.files), ...(this.revisions.get(id) ?? [])]
      for (const t of texts)
        for (const x of t.match(HEX) ?? [])
          if (!from.has(x)) {
            from.set(x, id)
            q.push(x)
          }
    }
    return { hit: false, path: '', group }
  }

  async settle() {
    // Let pending queue reads finish.
    this.queued = await this.queues()
  }
}

const EVENTS: [string, number][] = [
  ['share', 12],
  ['paste', 16],
  ['rows', 18],
  ['removeB', 7],
  ['removeA', 2],
  ['cancel', 3],
  ['offline', 4],
  ['budget', 3],
  ['ratelimit', 2],
  ['time', 5],
  ['crash', 6],
  ['both', 5],
]

const FOCUS: [string, number][] = [
  ['share', 12],
  ['paste', 14],
  ['rows', 14],
  ['removeB', 9],
  ['removeA', 2],
  ['cancel', 8],
  ['offline', 4],
  ['budget', 7],
  ['ratelimit', 4],
  ['time', 3],
  ['crash', 8],
  ['both', 7],
]
export function randomEvent(m: Model, profile = 1): Ev {
  const table = profile === 2 ? FOCUS : EVENTS
  const total = table.reduce((s, [, w]) => s + w, 0)
  let x = m.rng() * total
  let t = table[0][0]
  for (const [name, w] of table) {
    if ((x -= w) < 0) {
      t = name
      break
    }
  }
  const who: Actor = t === 'removeB' || t === 'cancel' || t === 'budget' ? 'A' : t === 'removeA' ? 'B' : m.rng() < 0.12 ? 'C' : m.rng() < 0.55 ? 'A' : 'B'
  const ev: Ev = { t, who, dev: Math.floor(m.rng() * 3) }
  if (t === 'paste') ev.arg = m.rng() < 0.6 ? 0 : m.rng() < 0.85 ? 1 : 3
  if (t === 'budget') ev.arg = Math.floor(m.rng() * 9)
  if (t === 'time') ev.arg = m.rng() < 0.7 ? 5 * 60_000 : 61 * 60_000
  if (t === 'share' && who === 'C') ev.who = 'A'
  return ev
}

export async function runSeed(seed: number, profile = 1): Promise<Model> {
  const m = new Model(seed)
  const r = m.rng
  await m.setup(1 + Math.floor(r() * 3), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2), r() < (profile === 2 ? 0.5 : 0.25))
  const n = 30 + Math.floor(r() * 31)
  for (let i = 0; i < n; i++) {
    await m.run(randomEvent(m, profile))
    await m.settle()
  }
  // At the end: the apps come back online and run their rows (a remove finishes), time passes.
  for (const a of ['A', 'B', 'C'] as Actor[]) for (const d of m.devs[a]) d.offlineUntil = -1
  m.rateBlock = {}
  m.clock.advance(61 * 60_000)
  for (let k = 0; k < 2; k++)
    for (const a of ['A', 'B', 'C'] as Actor[])
      for (const d of m.devs[a]) {
        await m.run({ t: 'rows', who: a, dev: d.n })
        await m.settle()
      }
  return m
}

export async function runScript(seed: number, setup: [number, number, number, boolean], evs: Ev[]): Promise<Model> {
  const m = new Model(seed)
  await m.setup(...setup)
  for (const e of evs) {
    await m.run(e)
    await m.settle()
  }
  return m
}
