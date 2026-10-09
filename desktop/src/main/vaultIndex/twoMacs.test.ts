// TWO MACS, ONE VAULT (YAZ-2677 🔒 D7 and D8, R22 to R34; cases S41 to S68). Two temp folders stand for
// one vault on two Macs — the Pro and the Air — each with its own app data folder, and so its own
// Mac ID, count file, index cache and diary. `sync()` stands for the sync tool: it copies what one
// Mac changed to the other, and FAILS THE TEST when both changed one file, which is the fault this
// whole rule exists to prevent.
//
// The real live index runs for both Macs. Only the OS watcher is replaced: `pump()` reports each
// file that changed on disk to the index, as the watcher would, and waits until the index and its
// sweeps are done, so no test sleeps. The clock is set by hand (`at('10:07')`), and so are the
// timers: `later(ms)` is the only way ten minutes pass.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noteFileName } from '@shared/noteName'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR, type WatchEvent } from '@shared/types'
import { vaultFiles } from '../fs/testFixture'
import { _resetIndexCache } from './cache'
import { _resetDiary, flushDiaries } from './diary'
import { ID_WAIT_MS, _swept } from './idSweep'
import { _evict, _evictAll, _setIdleMs, checkDuplicates, flushIndexCache, getIndex, giveIdsNow, initIndexCache, onIdFixes, saveIdsAnswer } from './index'
import { COUNT_DIR, _actAs, macId, mintIds, type CountFile } from './mint'

// The watcher: each Mac's index subscribes here, and `pump` is the only thing that reports to it.
const watchers = vi.hoisted(() => new Map<string, Set<(ev: unknown) => void>>())
vi.mock('../fs/watchers', () => ({
  subscribe: (root: string, listener: (ev: unknown) => void) => {
    const listeners = watchers.get(root) ?? new Set()
    watchers.set(root, listeners.add(listener))
    return () => listeners.delete(listener)
  },
}))

// One seam: a write of a note that loses once to another writer, as when the editor saves the note at that moment.
const fails = vi.hoisted(() => ({ write: undefined as string | undefined }))
vi.mock('../fs/file', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/file')>()
  const { BridgeFailure } = await import('../fs/fsUtils')
  return {
    ...real,
    writeFile: async (req: { path: string; content: string; expectedMtime?: number }) => {
      if (fails.write !== undefined && req.path.endsWith(fails.write)) {
        fails.write = undefined
        throw new BridgeFailure('CONFLICT', 'file changed on disk since last read', { path: req.path })
      }
      return real.writeFile(req)
    },
  }
})

interface Mac {
  name: string
  /** The vault as this Mac holds it. */
  root: string
  /** What the watcher last reported of the vault. */
  seen: Record<string, string>
  /** Is its app running? */
  on: boolean
  /** Each notice its app showed. */
  notices: string[]
}

let pro: Mac
let air: Mac
let scratch: string
/** The vault as the two Macs last agreed on it: what `sync` compares each side to. */
let synced: Record<string, string>

const DAY = '2026-10-09'
/** Sets the clock: `at('10:07')`, `at('10:19:57')`, and `at('10:00', 31)` is that time 31 days later. */
const at = (time: string, days = 0): void => {
  vi.setSystemTime(new Date(Date.parse(`${DAY}T${time.length === 5 ? `${time}:00` : time}.000Z`) + days * 24 * 60 * 60 * 1000))
}

/** Every file of the vault, the hidden ones too, by its path from the root. Folders are not listed: an empty one does not sync. */
const filesOf = async (root: string): Promise<Record<string, string>> => Object.fromEntries(Object.entries(await vaultFiles(root)).filter(([rel]) => !rel.endsWith('/')))
/** The files the watcher reports: everything outside the config folder. */
const watched = async (root: string): Promise<Record<string, string>> =>
  Object.fromEntries(Object.entries(await vaultFiles(root)).filter(([rel]) => rel !== `${VAULT_CONFIG_DIR}/` && !rel.startsWith(`${VAULT_CONFIG_DIR}/`)))

const read = (mac: Mac, rel: string): Promise<string> => readFile(path.join(mac.root, rel), 'utf8')
const has = async (mac: Mac, rel: string): Promise<boolean> => (await filesOf(mac.root))[rel] !== undefined
const idIn = async (mac: Mac, rel: string): Promise<string | undefined> => /^id: (.+)$/m.exec(await read(mac, rel))?.[1]
const countOf = async (mac: Mac): Promise<CountFile> => JSON.parse(await read(mac, `${VAULT_CONFIG_DIR}/${COUNT_DIR}/${await macId(mac.root)}.json`)) as CountFile

/** The index and every sweep it started are done. */
async function drained(mac: Mac): Promise<void> {
  await getIndex(mac.root)
  await _swept(mac.root)
  await new Promise((resolve) => setImmediate(resolve))
}

/** The watcher's part: each change on disk is reported to the Mac's index, until nothing changes any more. */
async function pump(mac: Mac): Promise<void> {
  if (!mac.on) return
  for (;;) {
    await drained(mac)
    const now = await watched(mac.root)
    const events: WatchEvent[] = []
    for (const rel of Object.keys(now).sort()) {
      const file = path.join(mac.root, rel.replace(/\/$/, ''))
      if (mac.seen[rel] === undefined) events.push(rel.endsWith('/') ? { type: 'addDir', path: file } : { type: 'add', path: file, mtime: 0 })
      else if (mac.seen[rel] !== now[rel]) events.push({ type: 'change', path: file, mtime: 0 })
    }
    for (const rel of Object.keys(mac.seen).sort().reverse()) {
      if (now[rel] === undefined) events.push({ type: rel.endsWith('/') ? 'unlinkDir' : 'unlink', path: path.join(mac.root, rel.replace(/\/$/, '')) })
    }
    mac.seen = now
    if (events.length === 0) return
    for (const ev of events) watchers.get(mac.root)?.forEach((listener) => listener(ev))
  }
}

/**
 * The sync tool: what one Mac changed since the last sync goes to the other, a deleted file too.
 * A file BOTH changed is a conflict, and the test fails: no rule may let two Macs write one file.
 */
async function sync(): Promise<void> {
  const [p, a] = [await filesOf(pro.root), await filesOf(air.root)]
  for (const rel of new Set([...Object.keys(p), ...Object.keys(a), ...Object.keys(synced)])) {
    if (p[rel] === a[rel]) {
      if (p[rel] === undefined) delete synced[rel]
      else synced[rel] = p[rel]
      continue
    }
    const [proChanged, airChanged] = [p[rel] !== synced[rel], a[rel] !== synced[rel]]
    if (proChanged && airChanged) throw new Error(`THE SYNC CONFLICTS on ${rel}: both Macs wrote it`)
    const [to, content] = proChanged ? [air, p[rel]] : [pro, a[rel]]
    const file = path.join(to.root, rel)
    if (content === undefined) {
      await rm(file)
      delete synced[rel]
    } else {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
      synced[rel] = content
    }
  }
}

/** The sync, and then each Mac whose app runs sees what arrived. */
async function syncAndSee(): Promise<void> {
  await sync()
  await pump(pro)
  await pump(air)
}

/** A note made in the app: the number comes from the door first, then the note is written with it (R17, R18). */
async function make(mac: Mac, title: string, body = ''): Promise<{ id: string; file: string }> {
  const [id] = (await mintIds(mac.root, 1))!
  const file = noteFileName(title, id)
  await writeFile(path.join(mac.root, file), `---\nid: ${id}\ntitle: ${title}\n---\n${body}`)
  await pump(mac)
  return { id, file }
}

/** A folder made in the app: its `.folder.md` holds the next number (S33), and one note in it holds a value for the folder. */
async function makeFolder(mac: Mac, name: string): Promise<{ id: string; note: string }> {
  const [id] = (await mintIds(mac.root, 1))!
  await mkdir(path.join(mac.root, name))
  await writeFile(path.join(mac.root, name, FOLDER_SETTINGS_FILE), `---\nid: ${id}\ntitle: ${name}\n---\n`)
  const note = `${name}/member.md`
  // An old ID: it is the note's own, and no Mac counts with it.
  await writeFile(path.join(mac.root, note), `---\nid: ${name[0].toLowerCase()}1000000000a\nin:\n  ${id}:\n    Status: open\n---\n`)
  await pump(mac)
  return { id, note }
}

/** Someone writes a file on this Mac: the user in the editor, or an agent. */
async function write(mac: Mac, rel: string, content: string): Promise<void> {
  await writeFile(path.join(mac.root, rel), content)
  await pump(mac)
}

async function quit(mac: Mac): Promise<void> {
  await drained(mac)
  await flushIndexCache()
  await flushDiaries()
  _evict(mac.root)
  // Each diary is on disk now: forgetting them all is a restart for this Mac and changes nothing for the other.
  _resetDiary()
  mac.on = false
}

async function open(mac: Mac): Promise<void> {
  mac.on = true
  mac.seen = await watched(mac.root)
  await pump(mac)
}

/** `ms` pass: each timer that is due runs, and then each Mac whose app runs sees what changed. */
async function later(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await pump(pro)
  await pump(air)
}
const MINUTE = 60 * 1000

/** A file that reaches BOTH Macs by the sync, as when an agent on a server pushed it. */
async function arrives(rel: string, content: string): Promise<void> {
  for (const mac of [pro, air]) await writeFile(path.join(mac.root, rel), content)
  synced[rel] = content
}

/** `act` runs, and this Mac writes NOTHING: every byte of its vault, its count file too, is as it was. */
async function writesNothing(mac: Mac, act: () => Promise<unknown>): Promise<void> {
  const before = await vaultFiles(mac.root)
  await act()
  expect(await vaultFiles(mac.root)).toEqual(before)
}

/** The two Macs agree on every file after a sync, and neither wrote during it. */
async function converged(): Promise<void> {
  await syncAndSee()
  await syncAndSee()
  expect(await filesOf(air.root)).toEqual(await filesOf(pro.root))
}

const SEED = {
  [`${VAULT_CONFIG_DIR}/ids.json`]: '{\n  "enabled": true,\n  "letters": "YAZ"\n}\n',
  'seed.md': '---\nid: YAZ-99\ntitle: Seed\n---\n',
  'plan.md': '---\nid: YAZ-98\ntitle: Plan\n---\n',
  'log.md': '---\nid: YAZ-97\ntitle: Log\n---\n',
  'inbox.md': '---\nid: YAZ-96\ntitle: Inbox\n---\n',
}
const linking = (rel: keyof typeof SEED, to: string): string => `${SEED[rel]}see [[${to}]]\n`

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  at('09:00')
  scratch = await mkdtemp(path.join(tmpdir(), 'mdapp-two-macs-'))
  initIndexCache(path.join(scratch, 'index-cache'))
  const mac = async (name: string): Promise<Mac> => {
    const root = path.join(scratch, name, 'vault')
    await mkdir(root, { recursive: true })
    _actAs(root, path.join(scratch, name, 'app-data'))
    return { name, root, seen: {}, on: false, notices: [] }
  }
  pro = await mac('pro')
  air = await mac('air')
  onIdFixes((root, _fixes, notice) => {
    if (notice !== null) (root === pro.root ? pro : air).notices.push(notice)
  })
  // The vault starts on the Pro, and the Pro gives the first number: its count file is the oldest, so it is the vault's first Mac (R33).
  for (const [rel, content] of Object.entries(SEED)) {
    await mkdir(path.dirname(path.join(pro.root, rel)), { recursive: true })
    await writeFile(path.join(pro.root, rel), content)
  }
  synced = {}
  await open(pro)
  expect((await make(pro, 'Start')).id).toBe('YAZ-100')
  await sync()
  await open(air)
})

afterEach(async () => {
  onIdFixes(undefined)
  _setIdleMs()
  fails.write = undefined
  _evictAll()
  // Nothing of this test is still writing when its folders go.
  await flushIndexCache()
  await flushDiaries()
  _resetDiary()
  _resetIndexCache()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
})

/** S41: the Pro makes "Foo" at 10:00 and the Air, not synced, makes "Bar" at 10:07. Both are `YAZ-101`. */
async function bothMake101(): Promise<void> {
  at('10:00')
  expect(await make(pro, 'Foo')).toEqual({ id: 'YAZ-101', file: 'foo-yaz-101.md' })
  at('10:07')
  expect(await make(air, 'Bar')).toEqual({ id: 'YAZ-101', file: 'bar-yaz-101.md' })
}

describe('a clash: two Macs gave one number before a sync (S41 to S50)', () => {
  it('S41: the older note keeps the ID; the Mac that made the newer note gives it the next number; the other Mac writes nothing', async () => {
    await bothMake101()
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await idIn(air, 'foo-yaz-101.md')).toBe('YAZ-101')
    // "Bar" has the next number, and its file name follows it (R26).
    expect(await has(air, 'bar-yaz-101.md')).toBe(false)
    expect(await read(air, 'bar-yaz-102.md')).toBe('---\nid: YAZ-102\ntitle: Bar\n---\n')
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 0 links updated.'])
    // The fix reaches the Pro by the sync, with no conflict, and the Pro still writes nothing.
    await sync()
    await writesNothing(pro, () => pump(pro))
    await converged()
    expect(await idIn(pro, 'bar-yaz-102.md')).toBe('YAZ-102')
    expect(pro.notices).toEqual([])
  })

  it('S42: a link the Air wrote to its own note before the sync follows the note to its new number', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await read(air, 'plan.md')).toBe(linking('plan.md', 'YAZ-102'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.'])
    await converged()
    expect(await read(pro, 'plan.md')).toBe(linking('plan.md', 'YAZ-102'))
  })

  it('S42: every form of the link follows — a label, a heading, an embed, a property, an `also_in` entry — and a longer ID that starts the same does not', async () => {
    await bothMake101()
    at('10:08')
    const forms = (id: string): string => `---\nid: YAZ-98\ntitle: Plan\nparent: "[[${id}]]"\nalso_in:\n  - ${id}\n---\n[[${id}|the bar]] [[${id.toLowerCase()}#Goals]] ![[${id}]] [[YAZ-1010]] \`[[YAZ-101]]\`\n`
    await write(air, 'plan.md', forms('YAZ-101'))
    at('10:20')
    await syncAndSee()
    expect(await read(air, 'plan.md')).toBe(forms('YAZ-102').replace('[[yaz-102#Goals]]', '[[YAZ-102#Goals]]'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 5 links updated.'])
  })

  it('S43: a link the Pro wrote meant "Foo": no Mac changes it, and the notice of the Air lists it', async () => {
    await bothMake101()
    at('10:09')
    await write(pro, 'log.md', linking('log.md', 'YAZ-101'))
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await read(air, 'log.md')).toBe(linking('log.md', 'YAZ-101'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 0 links updated. Not changed: "Log".'])
    await converged()
    expect(await read(pro, 'log.md')).toBe(linking('log.md', 'YAZ-101'))
  })

  it('S44: a link that appeared on the Air in the same 5 seconds as the sync is not changed, and the notice lists its file', async () => {
    await bothMake101()
    at('10:19:57')
    await write(air, 'inbox.md', linking('inbox.md', 'YAZ-101'))
    at('10:20:00')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await read(air, 'inbox.md')).toBe(linking('inbox.md', 'YAZ-101'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 0 links updated. Not changed: "Inbox".'])
    await converged()
  })

  it('S44: a link first seen more than 5 seconds before the sync is changed', async () => {
    await bothMake101()
    at('10:19:54')
    await write(air, 'inbox.md', linking('inbox.md', 'YAZ-101'))
    at('10:20:00')
    await syncAndSee()
    expect(await read(air, 'inbox.md')).toBe(linking('inbox.md', 'YAZ-102'))
  })

  it('S45: ONE notice tells the ID, the note, its new number, the links updated, and each link that was not changed', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:09')
    await write(pro, 'log.md', linking('log.md', 'YAZ-101'))
    at('10:19:58')
    await write(air, 'inbox.md', linking('inbox.md', 'YAZ-101'))
    at('10:20:00')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated. Not changed: "Inbox", "Log".'])
    expect(pro.notices).toEqual([])
    await converged()
  })

  it('S46: with the Air off after the sync, both Macs hold two notes with one ID, the ID opens the keeper, and the Air fixes it when its app runs next', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:10')
    await quit(air)
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    for (const mac of [pro, air]) expect([await idIn(mac, 'foo-yaz-101.md'), await idIn(mac, 'bar-yaz-101.md')]).toEqual(['YAZ-101', 'YAZ-101'])
    // On the Pro the index hands the ID out for "Foo" only: a link by `YAZ-101` opens the keeper.
    const held = (await getIndex(pro.root)).records.filter((r) => r.title === 'Foo' || r.title === 'Bar').map((r) => [r.title, r.id])
    expect(held).toEqual([['Bar', undefined], ['Foo', 'YAZ-101']])
    at('11:00')
    await open(air)
    expect(await idIn(air, 'bar-yaz-102.md')).toBe('YAZ-102')
    expect(await read(air, 'plan.md')).toBe(linking('plan.md', 'YAZ-102'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.'])
    await sync()
    await writesNothing(pro, () => pump(pro))
    // The clash is over: the Pro hands out each ID as the files hold it.
    expect((await getIndex(pro.root)).records.filter((r) => r.title === 'Foo' || r.title === 'Bar').map((r) => [r.title, r.id])).toEqual([['Bar', 'YAZ-102'], ['Foo', 'YAZ-101']])
    await converged()
  })

  it('S47: while the Air fixes "Bar", the Pro makes a new `YAZ-102`: a second clash, the same rule, and it ends', async () => {
    await bothMake101()
    at('10:20')
    await syncAndSee()
    expect(await idIn(air, 'bar-yaz-102.md')).toBe('YAZ-102')
    // The Pro has not got the fix yet: its next number is 102 too.
    at('10:21')
    expect(await make(pro, 'Baz')).toEqual({ id: 'YAZ-102', file: 'baz-yaz-102.md' })
    at('10:30')
    await sync()
    // The Air gave 102 first (10:20), so "Bar" keeps it and the Air writes nothing; the Pro fixes its own "Baz".
    await writesNothing(air, () => pump(air))
    await pump(pro)
    expect(await idIn(pro, 'baz-yaz-103.md')).toBe('YAZ-103')
    expect(await idIn(pro, 'bar-yaz-102.md')).toBe('YAZ-102')
    expect(pro.notices).toEqual(['YAZ-102 was used on two Macs. "Baz" is now YAZ-103. 0 links updated.'])
    await converged()
    const ids = await Promise.all(Object.keys(await filesOf(pro.root)).filter((rel) => rel.endsWith('.md')).map((rel) => idIn(pro, rel)))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('S48: the Air lost its index cache and cannot tell which note it made: the first note in path order keeps the ID, the Air gives the other the next number, no link is changed, and the notice says so (R29)', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:10')
    await quit(air)
    await rm(path.join(scratch, 'index-cache'), { recursive: true, force: true })
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    at('11:00')
    await open(air)
    // `bar-…` is first in path order: it keeps the ID, and "Foo" takes the next number.
    expect(await idIn(air, 'bar-yaz-101.md')).toBe('YAZ-101')
    expect(await idIn(air, 'foo-yaz-102.md')).toBe('YAZ-102')
    expect(await read(air, 'plan.md')).toBe(linking('plan.md', 'YAZ-101'))
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Foo" is now YAZ-102. No link was changed: this Mac could not tell which note it made. Check the links in "Plan".'])
    await sync()
    await writesNothing(pro, () => pump(pro))
    await converged()
  })

  it('S49: the `made` entries are older than 30 days: the pair is a copy, not a clash. The first Mac gives the copy its number, the other Mac writes nothing, and no link is changed (R22, R30, R31)', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    // The Air was offline for a month.
    at('10:20', 31)
    await sync()
    await writesNothing(air, () => pump(air))
    await pump(pro)
    // The Pro's index knew "Foo": "Bar" is the copy there, and the Pro is the vault's first Mac.
    expect(await idIn(pro, 'foo-yaz-101.md')).toBe('YAZ-101')
    expect(await idIn(pro, 'bar-yaz-101.md')).toBe('YAZ-102')
    await converged()
    expect(await read(air, 'plan.md')).toBe(linking('plan.md', 'YAZ-101'))
    expect([...pro.notices, ...air.notices]).toEqual([])
  })

  it('S50: the two times are equal: the Mac whose ID is first in order keeps the number, and only the other Mac fixes (R23)', async () => {
    at('10:00')
    await make(pro, 'Foo')
    await make(air, 'Bar')
    const [keeper, fixer] = (await macId(pro.root)) < (await macId(air.root)) ? [pro, air] : [air, pro]
    const [kept, moved] = keeper === pro ? ['foo', 'bar'] : ['bar', 'foo']
    at('10:20')
    await sync()
    await writesNothing(keeper, () => pump(keeper))
    await pump(fixer)
    expect(await idIn(fixer, `${kept}-yaz-101.md`)).toBe('YAZ-101')
    expect(await idIn(fixer, `${moved}-yaz-102.md`)).toBe('YAZ-102')
    expect(keeper.notices).toEqual([])
    expect(fixer.notices).toHaveLength(1)
    await converged()
  })
})

describe('the fix is safe to run again, and to stop anywhere', () => {
  it('a fix that runs a second time changes nothing: no byte of the vault, and no number', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:20')
    await syncAndSee()
    expect(await idIn(air, 'bar-yaz-102.md')).toBe('YAZ-102')
    at('10:25')
    await writesNothing(air, async () => {
      expect(await checkDuplicates(air.root)).toBe('No duplicates.')
      await quit(air)
      await open(air)
      expect(await checkDuplicates(air.root)).toBe('No duplicates.')
    })
    expect(air.notices).toHaveLength(1)
    expect((await countOf(air)).last).toBe(102)
  })

  it('a fix that stops after the links and before the note continues with the SAME number: the next sweep finishes it, and takes no second number', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    at('10:20')
    await sync()
    // The one write of the note loses to another writer, as when the editor saves it at that moment.
    fails.write = 'bar-yaz-101.md'
    await pump(air)
    expect(await idIn(air, 'bar-yaz-101.md')).toBe('YAZ-101')
    expect(await read(air, 'plan.md')).toBe(linking('plan.md', 'YAZ-102'))
    expect((await countOf(air)).last).toBe(102)
    expect(air.notices).toEqual([])
    // Meanwhile the ID opens "Foo", the keeper, on the Air too.
    expect((await getIndex(air.root)).records.filter((r) => r.title === 'Foo' || r.title === 'Bar').map((r) => [r.title, r.id])).toEqual([['Bar', undefined], ['Foo', 'YAZ-101']])
    // The app restarts: the number is in the diary, and the fix goes on from there.
    await quit(air)
    at('10:40')
    await open(air)
    expect(await idIn(air, 'bar-yaz-102.md')).toBe('YAZ-102')
    expect((await countOf(air)).last).toBe(102)
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.'])
    await writesNothing(air, async () => {
      await quit(air)
      await open(air)
    })
    await converged()
  })

  it('after the fix, a Finder copy of the keeper is a copy: the Air — the one Mac that writes for that number — gives it the next number, and the original keeps its ID and its links', async () => {
    await bothMake101()
    at('10:20')
    await syncAndSee()
    await converged()
    at('12:00')
    await write(pro, 'foo copy.md', await read(pro, 'foo-yaz-101.md'))
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await idIn(air, 'foo-yaz-101.md')).toBe('YAZ-101')
    expect(await idIn(air, 'foo copy.md')).toBe('YAZ-103')
    await converged()
  })
})

describe('two folders made on two Macs with one number (S54, R30a)', () => {
  it('the older folder keeps the ID; the notes of the newer folder carry their values to the new ID, and then the folder takes it', async () => {
    at('10:00')
    const clients = await makeFolder(pro, 'Clients')
    at('10:07')
    const vendors = await makeFolder(air, 'Vendors')
    expect([clients.id, vendors.id]).toEqual(['YAZ-101', 'YAZ-101'])
    at('10:20')
    await sync()
    await writesNothing(pro, () => pump(pro))
    await pump(air)
    expect(await idIn(air, `Clients/${FOLDER_SETTINGS_FILE}`)).toBe('YAZ-101')
    expect(await idIn(air, `Vendors/${FOLDER_SETTINGS_FILE}`)).toBe('YAZ-102')
    expect(await read(air, vendors.note)).toContain('in:\n  YAZ-102:\n    Status: open\n')
    expect(await read(air, clients.note)).toContain('in:\n  YAZ-101:\n    Status: open\n')
    expect(air.notices).toEqual(['YAZ-101 was used on two Macs. "Vendors" is now YAZ-102. 0 links updated.'])
    await converged()
  })
})

describe('"Check for duplicates" (S55 to S57)', () => {
  it('S55: there are none: one line, and nothing is written', async () => {
    await writesNothing(pro, async () => expect(await checkDuplicates(pro.root)).toBe('No duplicates.'))
  })

  it('S56: on the Mac that must fix a clash it runs the fix now and tells the result', async () => {
    await bothMake101()
    at('10:08')
    await write(air, 'plan.md', linking('plan.md', 'YAZ-101'))
    // The fix did not end by itself: the write of the note lost to another writer.
    at('10:20')
    await sync()
    fails.write = 'bar-yaz-101.md'
    await pump(air)
    expect(await idIn(air, 'bar-yaz-101.md')).toBe('YAZ-101')
    at('10:30')
    expect(await checkDuplicates(air.root)).toBe('YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.')
    expect(await idIn(air, 'bar-yaz-102.md')).toBe('YAZ-102')
    // The line told the result: no notice beside it.
    expect(air.notices).toEqual([])
    await pump(air)
    expect(await checkDuplicates(air.root)).toBe('No duplicates.')
  })

  it('S57: on the Mac that must not fix it writes nothing, and tells which note the other Mac will fix', async () => {
    await bothMake101()
    await quit(air)
    at('10:20')
    await sync()
    await pump(pro)
    await writesNothing(pro, async () => expect(await checkDuplicates(pro.root)).toBe('YAZ-101 is on two notes. The Mac that made "Bar" fixes it when its app runs.'))
    // It still knows after a restart: the diary holds which note is the Pro's own.
    await quit(pro)
    await open(pro)
    await writesNothing(pro, async () => expect(await checkDuplicates(pro.root)).toBe('YAZ-101 is on two notes. The Mac that made "Bar" fixes it when its app runs.'))
  })

  it('a copy is given its own number at once, on any Mac, and the line tells it (R32)', async () => {
    await quit(air)
    at('10:00')
    await write(air, 'seed copy.md', SEED['seed.md'])
    await open(air)
    // The Air is not the vault's first Mac: the sweep leaves the copy for the Pro (R31).
    expect(await idIn(air, 'seed copy.md')).toBe('YAZ-99')
    expect(await checkDuplicates(air.root)).toBe('Fixed 1: "Seed" is now YAZ-101.')
    expect(await idIn(air, 'seed copy.md')).toBe('YAZ-101')
    expect(await idIn(air, 'seed.md')).toBe('YAZ-99')
  })
})

describe('a file that arrives with no ID: one Mac gives the number (S59 to S68, R31 to R34)', () => {
  const X = 'from an agent\n'

  it('S59: an agent drops a file on the Pro, the first Mac: it has its number in a moment', async () => {
    await write(pro, 'x.md', X)
    expect(await idIn(pro, 'x.md')).toBe('YAZ-101')
  })

  it('S51: a note duplicated in Finder on the Pro: the original keeps the ID, and the copy has the next number at once', async () => {
    await write(pro, 'seed copy.md', SEED['seed.md'])
    expect([await idIn(pro, 'seed.md'), await idIn(pro, 'seed copy.md')]).toEqual(['YAZ-99', 'YAZ-101'])
  })

  it('S60: an agent drops a file on the Air: the Air waits, the Pro gets the file by the sync and gives the number, and the Air gets the number by the sync and does nothing', async () => {
    await writeFile(path.join(air.root, 'x.md'), X)
    await writesNothing(air, () => pump(air).then(() => later(9 * MINUTE)))
    await sync()
    await pump(pro)
    expect(await idIn(pro, 'x.md')).toBe('YAZ-101')
    await sync()
    await writesNothing(air, async () => {
      await pump(air)
      await later(30 * MINUTE)
    })
    await converged()
  })

  it('S61: the same with the Pro off: after 10 minutes, and not before, the Air gives the number', async () => {
    await quit(pro)
    await writeFile(path.join(air.root, 'x.md'), X)
    await writesNothing(air, () => pump(air).then(() => later(ID_WAIT_MS - 1000)))
    await later(1000)
    expect(await idIn(air, 'x.md')).toBe('YAZ-101')
    // The Air has a count file now, and the Pro's is still the older one: the Pro stays the first Mac.
    await writeFile(path.join(air.root, 'y.md'), X)
    await writesNothing(air, () => pump(air))
  })

  it('S62: a file with no ID comes to both Macs by the sync: the Pro gives the number at once, and the Air waits 10 minutes and then sees the ID', async () => {
    await arrives('x.md', X)
    await writesNothing(air, () => pump(air))
    await pump(pro)
    expect(await idIn(pro, 'x.md')).toBe('YAZ-101')
    await sync()
    await writesNothing(air, async () => {
      await pump(air)
      await later(ID_WAIT_MS)
    })
    await converged()
  })

  it('S52: a note duplicated while the apps were closed reaches both Macs: the Air waits 10 minutes, and then — the Pro still off — gives the COPY the number; the original keeps its ID', async () => {
    await quit(pro)
    await quit(air)
    await arrives('a copy of seed.md', SEED['seed.md'])
    await writesNothing(air, () => open(air).then(() => later(ID_WAIT_MS - 1000)))
    await later(1000)
    // `a copy of seed.md` is first in path order: only what the index knew before tells the original.
    expect([await idIn(air, 'seed.md'), await idIn(air, 'a copy of seed.md')]).toEqual(['YAZ-99', 'YAZ-101'])
  })

  it('S63: a vault that only one Mac opens: that Mac is first, and nothing waits', async () => {
    await quit(air)
    expect(Object.keys(await filesOf(pro.root)).filter((rel) => rel.startsWith(`${VAULT_CONFIG_DIR}/${COUNT_DIR}/`))).toEqual([`${VAULT_CONFIG_DIR}/${COUNT_DIR}/${await macId(pro.root)}.json`])
    await write(pro, 'x.md', X)
    await mkdir(path.join(pro.root, 'Made in Finder'))
    await pump(pro)
    expect([await idIn(pro, 'x.md'), await idIn(pro, `Made in Finder/${FOLDER_SETTINGS_FILE}`)]).toEqual(['YAZ-101', 'YAZ-102'])
  })

  it('a vault with no count file has no first Mac: a number the sweep gives waits 10 minutes there, and the Mac that then gives it is the first (R33)', async () => {
    const solo: Mac = { name: 'solo', root: path.join(scratch, 'solo', 'vault'), seen: {}, on: false, notices: [] }
    await mkdir(path.join(solo.root, VAULT_CONFIG_DIR), { recursive: true })
    _actAs(solo.root, path.join(scratch, 'solo', 'app-data'))
    await writeFile(path.join(solo.root, VAULT_CONFIG_DIR, 'ids.json'), SEED[`${VAULT_CONFIG_DIR}/ids.json`])
    await writeFile(path.join(solo.root, 'x.md'), X)
    const seesAfter = async (ms: number): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms)
      await pump(solo)
    }
    await writesNothing(solo, () => open(solo).then(() => seesAfter(ID_WAIT_MS - 1000)))
    await seesAfter(1000)
    expect(await idIn(solo, 'x.md')).toBe('YAZ-1')
    await write(solo, 'y.md', X)
    expect(await idIn(solo, 'y.md')).toBe('YAZ-2')
    _evict(solo.root)
  })

  it('S64: the user clicks "Give IDs" on the Air: the Air gives the numbers at once, and the save keeps each other key of `ids.json` (R32, R10)', async () => {
    await writeFile(path.join(air.root, VAULT_CONFIG_DIR, 'ids.json'), '{ "enabled": false, "letters": "YAZ", "was": ["OLD"], "theirs": 1 }')
    await writeFile(path.join(air.root, 'x.md'), X)
    await mkdir(path.join(air.root, 'Projects'))
    await writesNothing(air, () => pump(air))
    await saveIdsAnswer(air.root, true, 'yaz')
    await giveIdsNow(air.root)
    expect(JSON.parse(await read(air, `${VAULT_CONFIG_DIR}/ids.json`))).toEqual({ enabled: true, letters: 'YAZ', was: ['OLD'], theirs: 1 })
    expect([await idIn(air, 'x.md'), await idIn(air, `Projects/${FOLDER_SETTINGS_FILE}`)]).toEqual(['YAZ-101', 'YAZ-102'])
    // Off keeps the letters and the letters of before in the file (R12).
    await saveIdsAnswer(air.root, false)
    expect(JSON.parse(await read(air, `${VAULT_CONFIG_DIR}/ids.json`))).toEqual({ enabled: false, letters: 'YAZ', was: ['OLD'], theirs: 1 })
  })

  it('two saves of the answer at the same moment each keep what the other wrote', async () => {
    await Promise.all([saveIdsAnswer(air.root, true, 'yaz'), saveIdsAnswer(air.root, true), saveIdsAnswer(air.root, false), saveIdsAnswer(air.root, true, 'DOC')])
    expect(JSON.parse(await read(air, `${VAULT_CONFIG_DIR}/ids.json`))).toEqual({ enabled: true, letters: 'DOC' })
    await expect(saveIdsAnswer(air.root, true, 'toolong')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(saveIdsAnswer(air.root, 'yes')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await writeFile(path.join(air.root, VAULT_CONFIG_DIR, 'ids.json'), '{ not json')
    await expect(saveIdsAnswer(air.root, true)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(await read(air, `${VAULT_CONFIG_DIR}/ids.json`)).toBe('{ not json')
  })

  it('S65: IDs are turned on at the Pro, and the Air gets `ids.json` by the sync before anything else: the Air does not sweep for 10 minutes, and the numbers of the Pro arrive first', async () => {
    const off = '{\n  "enabled": false,\n  "letters": "YAZ"\n}\n'
    for (const mac of [pro, air]) await writeFile(path.join(mac.root, VAULT_CONFIG_DIR, 'ids.json'), off)
    synced[`${VAULT_CONFIG_DIR}/ids.json`] = off
    await arrives('a.md', X)
    await arrives('b.md', X)
    await pump(pro)
    await pump(air)
    expect((await getIndex(air.root)).ids).toBe(false)
    // The user clicks "Give IDs" on the Pro.
    await saveIdsAnswer(pro.root, true)
    await giveIdsNow(pro.root)
    expect([await idIn(pro, 'a.md'), await idIn(pro, 'b.md')].sort()).toEqual(['YAZ-101', 'YAZ-102'])
    // The sync brings `ids.json` first, alone.
    const on = await read(pro, `${VAULT_CONFIG_DIR}/ids.json`)
    await writeFile(path.join(air.root, VAULT_CONFIG_DIR, 'ids.json'), on)
    synced[`${VAULT_CONFIG_DIR}/ids.json`] = on
    await writesNothing(air, async () => {
      expect((await getIndex(air.root)).ids).toBe(true)
      await pump(air)
      await later(ID_WAIT_MS - 1000)
    })
    // The rest arrives. The Air has nothing left to give.
    await sync()
    await writesNothing(air, async () => {
      await pump(air)
      await later(ID_WAIT_MS)
    })
    await converged()
  })

  it('S66: the app on the Air restarts during the wait: the wait starts again', async () => {
    await quit(pro)
    await write(air, 'x.md', X)
    await later(6 * MINUTE)
    await quit(air)
    await writesNothing(air, () => open(air).then(() => later(ID_WAIT_MS - 1000)))
    await later(1000)
    expect(await idIn(air, 'x.md')).toBe('YAZ-101')
  })

  it('S68: a file with no ID that has invalid YAML, or is over the size limit, is left alone on each Mac, after the wait too', async () => {
    const files = { 'broken.md': '---\nstatus: [unclosed\n---\nbody\n', 'big.md': 'x'.repeat(MAX_FILE_BYTES + 1) }
    for (const [rel, content] of Object.entries(files)) await arrives(rel, content)
    for (const mac of [pro, air]) await writesNothing(mac, () => pump(mac))
    await writesNothing(pro, () => writesNothing(air, () => later(2 * ID_WAIT_MS)))
  })

  it('R34: ONE timer for a vault, however many files wait: it is set for the file that waited longest, set again for the next, and cleared when the index of the vault goes', async () => {
    await quit(pro)
    _setIdleMs(10 * ID_WAIT_MS)
    const set = vi.spyOn(globalThis, 'setTimeout')
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    /** Each timer set for a wait: no other timer of the app is that long, with the idle time moved out of the way. */
    const waits = (): ReturnType<typeof setTimeout>[] => set.mock.calls.flatMap(([, ms], i) => (typeof ms === 'number' && ms >= MINUTE && ms <= ID_WAIT_MS ? [set.mock.results[i].value as ReturnType<typeof setTimeout>] : []))
    await write(air, 'x1.md', X)
    await later(MINUTE)
    await write(air, 'x2.md', X)
    await later(MINUTE)
    await write(air, 'x3.md', X)
    await mkdir(path.join(air.root, 'Made in Finder'))
    await pump(air)
    expect(waits()).toHaveLength(1)
    // 10 minutes after the first file: only the first has waited long enough.
    await later(8 * MINUTE)
    expect([await idIn(air, 'x1.md'), await read(air, 'x2.md'), await read(air, 'x3.md')]).toEqual(['YAZ-101', X, X])
    expect(waits()).toHaveLength(2)
    await later(MINUTE)
    expect([await idIn(air, 'x2.md'), await read(air, 'x3.md')]).toEqual(['YAZ-102', X])
    expect(waits()).toHaveLength(3)
    // The index of the vault goes during the wait of the last file and of the folder: the timer is cleared, and nothing is given.
    const pending = waits()[2]
    await drained(air)
    _evict(air.root)
    air.on = false
    expect(cleared.mock.calls.some(([timer]) => timer === pending)).toBe(true)
    await writesNothing(air, () => later(3 * ID_WAIT_MS))
    expect(waits()).toHaveLength(3)
  })

  it('IDs are turned off during the wait: nothing is given when it ends, and the timer does not run again and again', async () => {
    await quit(pro)
    await write(air, 'x.md', X)
    await saveIdsAnswer(air.root, false)
    const set = vi.spyOn(globalThis, 'setTimeout')
    await later(3 * ID_WAIT_MS)
    expect(await read(air, 'x.md')).toBe(X)
    expect(set.mock.calls.filter(([, ms]) => typeof ms === 'number' && ms <= MINUTE / 60).length).toBeLessThan(5)
  })
})
