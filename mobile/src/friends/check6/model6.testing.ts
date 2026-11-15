/**
 * The model checker, round 6 builder's step (YAZ-5444): the round 5 model (stale reads of the strict fake, 502, the
 * secondary limit, AutoSync page commits) with one more kind of step, `fileGone`: a person takes the list FILE away from
 * the home vault while the vault still answers, in one of two ways (the file deleted on GitHub, or the vault deleted and
 * made again under the same name), and A then wants to stop sharing.
 *
 * The step:
 * 1. (sometimes) "Start the friends list again" while the list file is still there: it must change nothing (I9).
 * 2. The file goes (deleted; the vault made again with a page; or, round 7, YAZ-5464, the vault made again EMPTY: no
 *    commit at all). 11 minutes later (past the stale window) one A phone opens Friends: it must offer the way out in the
 *    home vault itself, and the way out must run (a few tries 11 minutes apart under the faults, then once with the
 *    faults off). A dead end (no `home-gone` with `fileGone`, or the way out never done) is I10.
 * 3. After the way out every friend is removed: the model's I1 then asserts at every step that B reaches none of A's
 *    current numbers, until A adds B again.
 *
 * New invariants: I9 the way out never replaces a list file that can be read, and deletes nothing then; I10 a list file
 * gone for good always has a way out that ends B's access.
 *
 * Round 8 (YAZ-5492): in about a third of the orders with two or more A phones, the step is the TWO-VAULT race instead:
 * A's phone 0 has a second vault `ali/notes`, phone 1 `ali/other`; the home goes (the repo deleted, or its list file),
 * and both phones run the way out AT THE SAME MOMENT, each into its own other vault. I11: after it (and one more open
 * of Friends on each phone) there is one note, the list it names has its numbers gist, no list in my vaults keeps a
 * `wayOut` mark, and B's pointers are gone (I1 asserts from there on, as for the one-phone way out). The round 5 set (I1..I8, I1 on done, wrong deletes, throws)
 * still asserts. After the way out I2 and I2 strict's "C is still in A's list" do not apply to C (A removed every friend
 * by it).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { INDEX_FILE, POINTER_FILE, readListFiles } from '@shared/friendGists'
import { LIST_PATH, parseListFile } from '@shared/friendListStore'
import { saveAccount } from '../../auth/account'
import { loadVaultList, saveVaultList, vaultId } from '../../store'
import { mulberry, type Ev } from '../check3/model.testing'
import { randomEvent4 } from '../check4/model4.testing'
import { KEYS5, Model5, violations5, type Knobs } from '../check5/model5.testing'

const HOME = 'ali/vault'

export class Model6 extends Model5 {
  g6: () => number
  st6 = { fileGone: 0, wayOut: 0, refusedWhileThere: 0, tries: 0, how: { deleted: 0, remade: 0, empty: 0, gone: 0 }, finishedByOpen: 0, twoVaults: 0, i9: [] as string[], i10: [] as string[], i11: [] as string[] }
  restarted = false
  constructor(seed: number, knobs: Knobs) {
    super(seed, knobs)
    this.g6 = mulberry(seed ^ 0x6f11e6)
  }

  override async run(ev: Ev): Promise<void> {
    if (ev.t !== 'fileGone') return super.run(ev)
    this.step++
    this.st.steps++
    const repos = this.world.repos!
    const before = repos.file(HOME, LIST_PATH)
    // Once per order; only over a list that is there.
    if (this.st6.fileGone > 0 || before === null) {
      this.log.push(`${String(this.step).padStart(2)} fileGone: skipped`)
      return
    }
    this.st6.fileGone++
    const devs = this.devs.A as any[]
    // YAZ-5492: the two-vault race (two A phones' way outs at the same moment into two other vaults).
    if (devs.length >= 2 && this.g6() < 0.35) return this.twoVaults()
    const d = devs[(ev.dev ?? 0) % devs.length]
    // 1. I9: the way out over a list that is there.
    if (this.g6() < 0.4) {
      const mines = this.world.owned('ali').length
      const r = await this.act(d, 'restart', (x) => x.restart(HOME))
      const k = r === 'crash' ? 'crash' : r.kind
      if (k === 'done') this.st6.i9.push(`seed ${this.seed} step ${this.step}: the way out ran while the list file was there`)
      else if (repos.file(HOME, LIST_PATH) !== null && this.world.owned('ali').length < mines && k !== 'crash') this.st6.i9.push(`seed ${this.seed} step ${this.step}: the way out (${k}) deleted gists while the list file was there`)
      else this.st6.refusedWhileThere++
      this.log.push(`   (fileGone: the way out while the list is there: ${k})`)
    }
    // A's pointers for B now (friend entries and links given to B): each must be gone after the way out.
    const sharedToB = (this.listOf('A')?.index.shared ?? []).filter((x) => this.linksGivenToB.has(x.mine)).map((x) => x.mine)
    const bMines = [...this.bEntries().map((e) => e.mine), ...sharedToB]
    const oldStats = this.listOf('A')?.index.stats ?? null
    // 2. The file goes, in one of three ways (round 7, YAZ-5464: the vault made again EMPTY, with no commit at all:
    // GitHub answers 409 "Git Repository is empty" for its branch, its files and every git data call).
    const x = this.g6()
    const how = x < 0.4 ? 'deleted' : x < 0.7 ? 'remade' : 'empty'
    this.st6.how[how]++
    if (how === 'deleted') repos.push(HOME, { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
    else {
      repos.remove(HOME)
      if (how === 'remade') repos.create(HOME, 'ali', { 'a.md': '# A page\n' })
      else repos.createEmpty(HOME, 'ali')
    }
    this.clock.advance(11 * 60_000)
    let done = false
    let last = ''
    let started = false
    /** The list at the home now: its numbers gist, and whether it carries a way out that is not finished (YAZ-5462). */
    const homeList = () => {
      const text = repos.file(HOME, LIST_PATH)
      const f = text === null ? null : parseListFile(text)
      const r = f === null || f.kind !== 'ok' ? null : readListFiles(f.files)
      return r === null || r.kind !== 'ok' ? null : { stats: r.value.stats, marked: f !== null && f.kind === 'ok' && 'wayOut' in f.extra }
    }
    for (let t = 0; t < 6 && !done; t++) {
      if (t === 5) {
        // The last try: no fault, the phone is online (the model's `offline` step may hold it offline still), and no
        // crash is armed (the end phase clears them the same way).
        this.armed = false
        d.offlineUntil = -1
        d.crashAt = null
      }
      this.st6.tries++
      const rows = await this.act(d, 'rows', (x) => x.rows())
      last = rows === 'crash' ? 'crash' : rows.kind
      // YAZ-5462 (round 7): the way out writes its new list FIRST; a run that stopped after it is finished by the next
      // open of the list (its `wayOut` mark), which then answers `ok`: that is the way out done too.
      const now = homeList()
      if (started && rows !== 'crash' && rows.kind === 'ok' && now !== null && !now.marked && now.stats !== oldStats) {
        done = true
        this.st6.finishedByOpen++
        last = 'ok (the next open finished the way out)'
        break
      }
      if (rows === 'crash' || rows.kind !== 'home-gone') {
        // The fake's stale reads are not bound in time: one can give the head from before the delete (with the list)
        // even now, and a list seen means "maybe a lag" for the next 10 minutes. The person tries again later.
        this.clock.advance(11 * 60_000)
        continue
      }
      if ((rows as any).fileGone !== true || !(rows as any).vaults.includes(HOME)) {
        this.st6.i10.push(`seed ${this.seed} step ${this.step}: the way out does not offer the home vault (${JSON.stringify(rows)})`)
        break
      }
      // A starts the list again: every friend goes (the model's I1 asserts from here on, until A adds B again).
      this.cut = true
      this.cutDone = false
      this.st.removesStarted++
      started = true
      const r = await this.act(d, 'restart', (x) => x.restart(HOME))
      last = `home-gone, restart ${r === 'crash' ? 'crash' : r.kind}`
      if (r !== 'crash' && r.kind === 'done') done = true
      else this.clock.advance(11 * 60_000)
    }
    this.armed = true
    if (!done) this.st6.i10.push(`seed ${this.seed} step ${this.step}: the list file was ${how}, and no way out ran (last: ${last})`)
    else {
      this.st6.wayOut++
      this.i2Kept = this.st.i2.length
      this.restarted = true
      for (const m of bMines) this.bMinesTargeted.add(m)
      for (const g of this.world.owned('ali')) for (const m of bMines) if (g.id === m) this.st6.i10.push(`seed ${this.seed} step ${this.step}: B's pointer ${m.slice(0, 6)} is still there after the way out`)
    }
    this.log.push(`${String(this.step).padStart(2)} fileGone A${d.n} ${how}: ${last}`)
    await this.check()
  }

  /**
   * YAZ-5492: two A phones run the way out at the same moment, phone 0 into `ali/notes`, phone 1 into `ali/other` (each
   * its own vault; neither phone has the other's). The home goes first: the repo deleted (GitHub answers 404 at once) or
   * its list file deleted (offered after the stale window). The person tries again on each phone that still offers the
   * way out (a few tries 11 minutes apart under the faults, the last with the faults off), then opens Friends once more on
   * each phone. I10: the way out ends B's access; I11: one note, its list's numbers gist is there, no mark left.
   */
  async twoVaults(): Promise<void> {
    const repos = this.world.repos!
    const [d0, d1] = this.devs.A as any[]
    this.st6.twoVaults++
    for (const [d, repo] of [
      [d0, 'ali/notes'],
      [d1, 'ali/other'],
    ] as const) {
      if (!repos.owned('ali').includes(repo)) repos.create(repo, 'ali', { 'a.md': '# A page\n' })
      const v = { repo, branch: 'main', addedAt: this.clock.now() }
      const list = await loadVaultList(d.store)
      await saveVaultList(d.store, { vaults: [...list.vaults, v], open: list.open })
      await d.tokens.write(vaultId(v), `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`)
      await saveAccount(d.store, vaultId(v), { login: 'ali', name: 'ALI', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: this.clock.now() })
      d.list = this.newList(d)
    }
    const sharedToB = (this.listOf('A')?.index.shared ?? []).filter((x) => this.linksGivenToB.has(x.mine)).map((x) => x.mine)
    const bMines = [...this.bEntries().map((e) => e.mine), ...sharedToB]
    const oldStats = this.listOf('A')?.index.stats ?? null
    // The repo deleted (`gone`: GitHub answers 404, the way out is offered at once), or its list file deleted.
    const how = this.g6() < 0.5 ? 'deleted' : 'gone'
    this.st6.how[how]++
    if (how === 'deleted') repos.push(HOME, { [LIST_PATH]: null }, 'main', 'a person deleted the list file on github.com')
    else repos.remove(HOME)
    this.clock.advance(11 * 60_000)
    const target = new Map<any, string>([
      [d0, 'ali/notes'],
      [d1, 'ali/other'],
    ])
    let done = false
    let started = false
    const last: string[] = []
    for (let t = 0; t < 6 && !done; t++) {
      if (t === 5) {
        this.armed = false
        for (const d of [d0, d1]) {
          d.offlineUntil = -1
          d.crashAt = null
        }
      }
      this.st6.tries++
      const steps = await Promise.all(
        [d0, d1].map(async (d) => {
          const rows = await this.act(d, 'rows', (x) => x.rows())
          if (rows === 'crash') return 'crash'
          if (rows.kind !== 'home-gone') return rows.kind
          if (!this.cut) {
            this.cut = true
            this.cutDone = false
            this.st.removesStarted++
          }
          started = true
          const r = await this.act(d, 'restart', (x) => x.restart(target.get(d)!))
          return `restart ${r === 'crash' ? 'crash' : r.kind}`
        }),
      )
      last.splice(0, last.length, ...steps)
      const l = this.listOf('A')
      if (started && steps.every((x) => x === 'ok' || x === 'restart done') && l !== null && l.index.stats !== oldStats) done = true
      else this.clock.advance(11 * 60_000)
    }
    // YAZ-5516 (R9-M1): the last try had the faults off, but a read can still be stale (a lagging replica gave
    // "needs-repair" for one phone). Before I10 is reported, ask THAT phone again, once (a new open of Friends).
    if (!done && started) {
      for (const [i, d] of [d0, d1].entries()) {
        if (last[i] === 'ok' || last[i] === 'restart done') continue
        d.list = this.newList(d)
        const rows = await this.act(d, 'rows', (x) => x.rows())
        if (rows === 'crash') last[i] = 'crash'
        else if (rows.kind !== 'home-gone') last[i] = rows.kind
        else {
          const r = await this.act(d, 'restart', (x) => x.restart(target.get(d)!))
          last[i] = `restart ${r === 'crash' ? 'crash' : r.kind}`
        }
      }
      const l = this.listOf('A')
      if (last.every((x) => x === 'ok' || x === 'restart done') && l !== null && l.index.stats !== oldStats) done = true
    }
    this.armed = true
    this.log.push(`${String(this.step).padStart(2)} fileGone two vaults (${how}): ${last.join(' | ')}`)
    if (!done) {
      this.st6.i10.push(`seed ${this.seed} step ${this.step}: two-vault way out (${how}): not done (last: ${last.join(' | ')})`)
      await this.check()
      return
    }
    this.st6.wayOut++
    this.i2Kept = this.st.i2.length
    this.restarted = true
    for (const m of bMines) this.bMinesTargeted.add(m)
    for (const m of bMines) if (this.gist(m) !== undefined) this.st6.i10.push(`seed ${this.seed} step ${this.step}: two-vault way out: B's pointer ${m.slice(0, 6)} is still there`)
    // The person opens Friends again later on each phone (a new start of the app, no fault): then the state is whole.
    this.armed = false
    for (const d of [d0, d1]) {
      d.list = this.newList(d)
      await this.act(d, 'rows', (x) => x.rows())
    }
    this.armed = true
    const notes = this.world.owned('ali').filter((g) => INDEX_FILE in g.files)
    const l = this.listOf('A')
    const why: string[] = []
    if (notes.length !== 1) why.push(`${notes.length} notes`)
    if (l === null) why.push('no list where the note says')
    else if (l.index.stats === null || this.gist(l.index.stats) === undefined) why.push(`the list names a numbers gist that is gone (${l.index.stats?.slice(0, 6)})`)
    for (const repo of [HOME, 'ali/notes', 'ali/other']) {
      const text = repos.file(repo, LIST_PATH)
      const f = text === null ? null : parseListFile(text)
      if (f !== null && f.kind === 'ok' && 'wayOut' in f.extra) why.push(`${repo} keeps a wayOut mark`)
    }
    // A pointer of A that names a numbers gist that is gone while the list names another: a friend of the new list
    // would read nothing (none is expected here: no friend was added yet).
    for (const g of this.world.owned('ali')) if (POINTER_FILE in g.files && bMines.includes(g.id)) why.push(`B's pointer ${g.id.slice(0, 6)} is back`)
    if (why.length > 0) this.st6.i11.push(`seed ${this.seed} step ${this.step}: two-vault way out (${how}): ${why.join('; ')}`)
    await this.check()
  }

  /** Each I2 finding after the way out, set apart (not a violation): see `check`. */
  i2AfterWayOut = 0

  /** The I2 findings before the way out (they stay); every later one is set apart. */
  i2Kept = 0

  override async check(): Promise<void> {
    await super.check()
    // I2 is "C, whom A never removed, still reaches A's numbers". The way out removed C too (by design: it ends ALL
    // sharing), and C still holds A's old pointer (deleted) until C pastes A's new link; A may meanwhile add C again from
    // an old link of C. So after the way out, I2 does not apply to C's old pairing.
    // (Checks of parallel steps overlap, so the cut is by the count at the way out, not by the count at each check.)
    if (this.restarted && this.st.i2.length > this.i2Kept) {
      this.i2AfterWayOut += this.st.i2.length - this.i2Kept
      this.st.i2.length = this.i2Kept
    }
  }

  override async endPhase(): Promise<void> {
    const before = this.st4.i2strict.length
    await super.endPhase()
    // After the way out C is not in A's list any more, by design (A stopped sharing with everyone).
    if (this.restarted) this.st4.i2strict = this.st4.i2strict.filter((x, i) => i < before || !/C is not in A's list any more/.test(x))
  }
}

export function plan6(seed: number) {
  const g = mulberry(seed)
  // YAZ-5092 C2: this draw chose the old (v1) app; it stays, so every other seed keeps its order.
  g()
  const nA = 1 + Math.floor(g() * 3)
  const setup: [number, number, number, boolean, boolean] = [nA, 1 + Math.floor(g() * 3), 1 + Math.floor(g() * 3), g() < 0.35, g() < 0.25]
  const n = 40 + Math.floor(g() * 41)
  // One `fileGone` at a random place (the model runs it once per order).
  const at = Math.floor(g() * n)
  const events: Ev[] = Array.from({ length: n }, (_, i) => {
    if (i === at) return { t: 'fileGone', dev: Math.floor(g() * 3) }
    const x = g()
    if (x < 0.07) return { t: 'autosync' }
    if (x < 0.13) return { t: 'syncDuring', dev: Math.floor(g() * 3) }
    return randomEvent4(g)
  })
  return { seed, setup, events }
}

export async function runPlan6(seed: number, knobs: Knobs, keep?: number[]): Promise<Model6> {
  const p0 = plan6(seed)
  const p = keep === undefined ? p0 : { ...p0, events: keep.map((i) => p0.events[i]) }
  const m = new Model6(p.seed, knobs)
  m.hookRepos()
  // The setup is the world before the order, not a step of it: the model's random 409 on a gist PATCH is off there (with
  // it, seed 6450191's setup stopped at A's join of B's group, before any step; the same at the base of this branch).
  const p409 = m.p409
  m.p409 = 0
  await m.setup4(...p.setup)
  m.p409 = p409
  m.armed = true
  for (const e of p.events) {
    await m.run(e)
    await m.settle()
  }
  m.armed = false
  await m.endPhase()
  m.st5.stale = m.world.repos!.staleGiven
  return m
}

export const KEYS6 = [...KEYS5, 'I9', 'I10', 'I11'] as const
export const violations6 = (m: Model6): Record<string, string[]> => ({ ...violations5(m), I9: m.st6.i9, I10: m.st6.i10, I11: m.st6.i11 })
