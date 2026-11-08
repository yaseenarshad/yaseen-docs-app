/**
 * Sync's merge of a NOTE whose rebase stopped (YAZ-4615 D4, D9). Pure: three versions in, the
 * settled note out — `desktop/src/main/git/resolve.ts` writes it.
 *
 * Two people who comment on one note between syncs both append to the end of `comments`, so git
 * sees two edits at one place and stops. Here:
 *  - the `comments` key comes out of all three versions; what is left is "the rest" of the note;
 *  - the lists merge BY ID, key by key: a key my side changed keeps my value, any other keeps
 *    theirs; an entry one side deleted and the other edited stays (an edit beats a delete); an entry
 *    deleted on one side and untouched on the other goes;
 *  - a number that clashes in one run (the page's top-level comments, or one parent's replies) goes
 *    to the comment only MY side has — nobody else has seen it yet — as the next free number;
 *  - the rest: the same on both sides, or changed on one side only, is that side's. Changed on BOTH
 *    (the same lines, or git would not have stopped) is D9: the remote's rest stays at the path with
 *    every comment merged into it, and my rest is handed back as `copy`, with no comments, so no
 *    comment shows two times.
 *
 * Null only when a version's comments are not ours to write (`foreign` / `invalid` bytes): the pass
 * then stops as it always did.
 */
import { COMMENTS_KEY, commentsShape, isIdComment, nextCommentNumber, withComments, writableComments } from './comments'
import { setFrontmatterProperty } from './frontmatter'

export interface Renumbered {
  /** The comment's label before and after: `#4` → `#5`, a reply `#2.1` → `#2.2`. */
  from: string
  to: string
}

export interface NoteMerge {
  /** The note to write at the path. */
  text: string
  /** My comments that took a new number (the notice names them). */
  renumbered: Renumbered[]
  /** D9: my version of the rest, with no comments, when both sides changed the rest. */
  copy?: string
}

type Entry = Record<string, unknown>

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const ours = (content: string): boolean => {
  const shape = commentsShape(content)
  return shape === 'absent' || shape === 'list'
}

/** The note with its comments taken out. */
const restOf = (content: string): string => setFrontmatterProperty(content, COMMENTS_KEY, undefined)

/** Entries by id; an entry that is not a comment we know is kept by its exact JSON. */
function keyed(list: readonly unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const e of list) out.set(isIdComment(e) ? `id:${e.id}` : `raw:${JSON.stringify(e)}`, e)
  return out
}

/** One entry's three-way merge, key by key; `body` stays last, the schema's order. */
function mergeEntry(was: Entry | undefined, their: Entry, my: Entry): Entry {
  const base = was ?? {}
  const merged: Entry = {}
  for (const k of new Set([...Object.keys(their), ...Object.keys(my)])) {
    const v = !same(my[k], base[k]) ? my[k] : their[k]
    if (v !== undefined) merged[k] = v
  }
  if ('body' in merged) {
    const { body, ...rest } = merged
    return { ...rest, body }
  }
  return merged
}

const label = (list: readonly unknown[], e: Entry, n: number): string => {
  const parent = typeof e.reply_to === 'string' ? list.find((x) => isIdComment(x) && x.id === e.reply_to) : undefined
  return parent !== undefined && isIdComment(parent) && typeof parent.n === 'number' ? `#${parent.n}.${n}` : `#${n}`
}

export function mergeNoteComments(base: string | null, theirs: string, mine: string): NoteMerge | null {
  if (!ours(theirs) || !ours(mine) || (base !== null && !ours(base))) return null
  const [b, t, m] = [base === null ? new Map<string, unknown>() : keyed(writableComments(base)), keyed(writableComments(theirs)), keyed(writableComments(mine))]

  // Theirs' order first (it is already everywhere else), then what only I have, in my order.
  const list: unknown[] = []
  const mineOnly = new Set<string>()
  for (const [k, their] of t) {
    const my = m.get(k)
    const was = b.get(k)
    if (my === undefined) {
      // I deleted it: it goes, unless they changed it since (an edit beats a delete).
      if (was === undefined || !same(their, was)) list.push(their)
      continue
    }
    list.push(k.startsWith('id:') ? mergeEntry(was as Entry | undefined, their as Entry, my as Entry) : their)
  }
  for (const [k, my] of m) {
    if (t.has(k)) continue
    const was = b.get(k)
    // They deleted it: it goes, unless I changed it since.
    if (was !== undefined && same(my, was)) continue
    list.push(my)
    if (was === undefined) mineOnly.add(k)
  }

  // A clashing number goes to my new comment: the next free one in its run.
  const renumbered: Renumbered[] = []
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!isIdComment(e) || !mineOnly.has(`id:${e.id}`) || typeof e.n !== 'number') continue
    const run = (x: unknown) => isIdComment(x) && x !== e && (x.reply_to ?? undefined) === (e.reply_to ?? undefined)
    if (!list.some((x) => run(x) && (x as Entry).n === e.n)) continue
    const n = nextCommentNumber(list.filter((x) => x !== e), e.reply_to)
    renumbered.push({ from: label(list, e, e.n), to: label(list, e, n) })
    list[i] = { ...e, n }
  }

  const [restB, restT, restM] = [base === null ? null : restOf(base), restOf(theirs), restOf(mine)]
  const both = restT !== restM && restB !== restT && restB !== restM
  const rest = restT === restM || restB === restM ? restT : restB === restT ? restM : restT
  const text = withComments(rest, list)
  return both ? { text, renumbered, copy: restM } : { text, renumbered }
}
