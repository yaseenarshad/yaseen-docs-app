import { describe, expect, it } from 'vitest'
import { addComment, newCommentId, readComments } from '@shared/comments'
import { splitFrontmatter } from '@shared/frontmatter'
import { PAGE, PLAN, commentsSetup, isPatch } from './testing'

/**
 * YAZ-5461, the model check: two writers on one page over the fake remote. The PHONE adds comments (typed, or the
 * one-tap "Approved" with its Undo), through no signal, lost answers and moved branches. The "MAC" edits the body and
 * adds comments of its own, now and then just before the phone moves the ref (the race). At the end, with the signal
 * back:
 *  1. each phone comment that was not undone is on the page exactly ONCE; an undone one never;
 *  2. each Mac comment is there exactly once; the body is the Mac's last body (no body edit lost);
 *  3. each commit of the phone changed nothing outside the comments entry (byte for byte);
 *  4. the top-level numbers are all different;
 *  5. the phone's list is empty.
 * Seeded, so a failure names its seed.
 */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 0x100000000
  }
}

/** The page with its `comments` entry (block style: the key's line and the more-indented lines after it) taken out. */
function outsideComments(text: string): string {
  const { frontmatter, body } = splitFrontmatter(text)
  const out: string[] = []
  let skipping = false
  for (const line of frontmatter.split('\n')) {
    if (/^comments:/.test(line)) skipping = true
    else if (skipping && !/^[ \t]/.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return `${out.join('\n')}${body}`
}

async function run(seed: number) {
  const r = rng(seed)
  const t = await commentsSetup()
  const phone = new Map<string, { undone: boolean }>()
  const mac = new Set<string>()
  let macBody = splitFrontmatter(PLAN).body
  let edits = 0
  let loseNext = false
  let lost = 0

  // The Mac is ONE writer: its read and its push never interleave with another write of its own (a test that let two
  // of them interleave would lose a Mac edit by itself, with no phone in it).
  let macQueue: Promise<void> = Promise.resolve()
  const macWrite = () => (macQueue = macQueue.then(macWriteNow))
  const macWriteNow = async () => {
    const now = (await t.remote()) ?? PLAN
    let next: string
    if (r() < 0.5) {
      edits++
      const { frontmatter, body } = splitFrontmatter(now)
      next = `${frontmatter}${body}Mac edit ${edits}.\n`
      macBody = `${body}Mac edit ${edits}.\n`
    } else {
      const id = `m${newCommentId().slice(1)}`
      mac.add(id)
      next = addComment(now, `Mac comment ${mac.size}`, { id, at: '2026-11-14T05:00:00Z', by: 'yaseen-arshad' })
    }
    await t.macPush({ [PAGE]: next })
  }

  t.setHook(async (_url, init, forward) => {
    if (isPatch(init) && r() < 0.35) await macWrite()
    const res = await forward()
    // The ref moved on GitHub, and its answer never reaches the phone.
    if (isPatch(init) && loseNext && res.ok) {
      loseNext = false
      lost++
      throw new TypeError('Load failed')
    }
    return res
  })

  for (let step = 0; step < 14; step++) {
    const roll = r()
    if (roll < 0.35) {
      const held = r() < 0.4
      const made = await t.port.add({ path: PAGE, body: held ? 'Approved' : `Phone note ${step}`, by: 'yaseen', holdMs: held ? 4000 : 0 })
      phone.set(made.id, { undone: false })
      if (held && r() < 0.5) {
        await t.tick(Math.floor(r() * 3000))
        if (await t.port.undo(made.id)) phone.get(made.id)!.undone = true
      }
      // A comment's first send may be the one whose answer is lost.
      if (r() < 0.3) {
        loseNext = true
        await t.tick(held ? 4000 : 0)
      }
    } else if (roll < 0.55) await macWrite()
    else if (roll < 0.65) t.s.github.offline = !t.s.github.offline
    else if (roll < 0.75) loseNext = true
    else if (roll < 0.85) await t.tick(Math.floor(r() * 6000))
    else {
      t.answers.online()
      await t.settle()
    }
  }

  // The signal comes back and stays; the list empties.
  t.s.github.offline = false
  loseNext = false
  for (let i = 0; i < 8 && t.port.waiting().length > 0; i++) {
    await t.tick(70 * 60_000) // past any "the branch kept moving" wait
    await t.answers.sendNow()
    await t.settle()
  }

  const page = (await t.remote())!
  const comments = readComments(page)
  const count = (id: string) => comments.filter((c) => c.id === id).length
  for (const [id, { undone }] of phone) expect(count(id), `seed ${seed}: phone comment ${id}${undone ? ' (undone)' : ''}`).toBe(undone ? 0 : 1)
  for (const id of mac) expect(count(id), `seed ${seed}: Mac comment ${id}`).toBe(1)
  expect(splitFrontmatter(page).body, `seed ${seed}: the body`).toBe(macBody)
  const numbers = comments.filter((c) => c.reply_to === undefined).map((c) => c.n)
  expect(new Set(numbers).size, `seed ${seed}: numbers ${numbers}`).toBe(numbers.length)
  expect(t.port.waiting(), `seed ${seed}: the list`).toEqual([])

  // 3. Each phone commit, against its parent: nothing outside the comments entry changed.
  let phoneCommits = 0
  for (const [sha, commit] of t.s.git.commits) {
    if (!commit.message.startsWith('sync (phone)')) continue
    phoneCommits++
    const before = (await t.s.git.filesAt(commit.parents[0]))[PAGE]
    const after = (await t.s.git.filesAt(sha))[PAGE]
    expect(outsideComments(after), `seed ${seed}: phone commit ${sha}`).toBe(outsideComments(before))
  }
  return { phone: phone.size, mac: mac.size, edits, phoneCommits, lost }
}

describe('two writers on one page (the phone and the "Mac"), seeded', () => {
  it('no comment lost or doubled, no body edit lost, nothing outside the comment list changed', async () => {
    let totals = { phone: 0, mac: 0, edits: 0, phoneCommits: 0, lost: 0 }
    for (let seed = 1; seed <= 30; seed++) {
      const got = await run(seed)
      totals = { phone: totals.phone + got.phone, mac: totals.mac + got.mac, edits: totals.edits + got.edits, phoneCommits: totals.phoneCommits + got.phoneCommits, lost: totals.lost + got.lost }
    }
    // The run did real work: comments from both sides, body edits, and phone commits.
    expect(totals.phone).toBeGreaterThan(30)
    expect(totals.mac).toBeGreaterThan(10)
    expect(totals.edits).toBeGreaterThan(10)
    expect(totals.phoneCommits).toBeGreaterThan(20)
    // Lost answers of a ref move that worked: the retry must find the comment there and not post it again.
    expect(totals.lost).toBeGreaterThan(3)
  }, 120_000)
})
