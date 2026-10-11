import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { alsoIn } from '@shared/alsoIn'
import { folderSettingsLinks } from '@shared/folderSettingsLinks'
import { isRecord } from '@shared/guards'
import { exactLinkTarget } from '@shared/linkRewrite'
import { canonicalNoteId, isNumberId, noteIdNumber, vaultNoteId } from '@shared/noteId'
import type { IndexRecord } from '@shared/types'
import { atomicWrite } from '../fs/fsUtils'
import { MADE_DAYS, appDataDir, countsOf, madeBy, vaultIds, type Counts } from './mint'

/**
 * THE DIARY (YAZ-2677 🔒 D7, R25, R27, R28): what ONE Mac remembers about the IDs it made in ONE
 * vault, kept in this Mac's app data and never in the vault, so no sync carries it and no other
 * Mac reads it.
 *
 *  - `links`: each file where this Mac's index first saw a link, or an `also_in` entry, to an ID
 *    this Mac made, with the time. When that ID turns out to be on two notes and this Mac's note
 *    must take a new number, the links first seen well before the other note arrived are the
 *    links that meant this Mac's note: they follow it (R28).
 *  - `clashes`: for each ID that two notes held, the path of the note this Mac's index held with
 *    it BEFORE the other arrived (R25, R30), and how far a fix got. After the first sweep the
 *    index holds both notes and cannot tell them apart any more — and a number that waits for the
 *    vault's first Mac is given ten minutes later; and a fix that stops halfway must continue with
 *    the number it already took, never take a second one.
 *
 * Fed by every index event, in memory: a file write comes `SAVE_MS` after the first change, and
 * at quit (`flushDiaries`), never one for each event. Each write is atomic. Only an accelerator
 * of a FIX: a diary that is lost, or was never written, means no link is changed and the notice
 * lists each one (R29).
 *
 * Limits (R21): only IDs in this Mac's `made` are kept, so an entry leaves after `MADE_DAYS` days,
 * `LINKS_MAX` link entries at most, and `CLASHES_MAX` pairs, each for `MADE_DAYS` days.
 */

const DIARY_DIR = 'id-diary'
const DIARY_VERSION = 1
/** Link entries kept for one vault; one past it is not recorded, and its link is then listed and not changed. */
export const LINKS_MAX = 20_000
/** Pairs kept for one vault; past it the ones seen longest ago leave first. A folder of many notes duplicated in Finder is one pair for each note. */
export const CLASHES_MAX = 5000
/** The diary is written this long after its first change. */
const SAVE_MS = 2000

/** One ID that two notes held, as this Mac saw it: a clash, or a copy. */
export interface Clash {
  /** The path of the note this Mac's index held with the ID before the other arrived (R25, R30); '' when it could not tell (R29). */
  mine: string
  /** When the other note arrived here (ms): a link first seen `LINK_GRACE_MS` before this meant this Mac's note (R28). */
  at: number
  /** The number the door gave this Mac's note, saved BEFORE anything in the vault changes: a fix that stops continues with it. */
  to?: string
  /** Links changed so far, across each run of the fix. */
  links?: number
  /** This Mac's note left the ID: any note that holds it from now on is a copy. */
  done?: true
}

/** One vault's diary, in memory. */
export interface Book {
  /** ID (as the vault writes it now) → file → when the index first saw the file name it (ms). */
  links: Map<string, Map<string, number>>
  clashes: Map<string, Clash>
  /** True when it differs from the file: set by whoever changes it, cleared by the write. */
  dirty: boolean
}

interface State {
  book: Promise<Book>
  /** What the index saw and the book does not hold yet: whose IDs they are needs the count file, read later. */
  pending: { path: string; at: number; ids: string[] }[]
  timer?: NodeJS.Timeout
  /** The end of this vault's writes, so two atomic writes never land out of order. */
  writing: Promise<void>
}

const states = new Map<string, State>()

const diaryFile = (root: string): string => path.join(appDataDir(root), DIARY_DIR, `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The file as a book. Never throws: a file that is missing, not JSON, of another vault or another version is an empty diary. */
async function load(root: string): Promise<Book> {
  const book: Book = { links: new Map(), clashes: new Map(), dirty: false }
  let doc: unknown
  try {
    doc = JSON.parse(await readFile(diaryFile(root), 'utf8'))
  } catch {
    return book
  }
  if (!isRecord(doc) || doc.version !== DIARY_VERSION || doc.root !== root) return book
  let kept = 0
  for (const [id, files] of Object.entries(isRecord(doc.links) ? doc.links : {})) {
    if (!isRecord(files)) continue
    const seen = new Map<string, number>()
    for (const [file, at] of Object.entries(files)) if (isTime(at) && kept++ < LINKS_MAX) seen.set(file, at)
    if (seen.size > 0) book.links.set(id, seen)
  }
  for (const [id, clash] of Object.entries(isRecord(doc.clashes) ? doc.clashes : {})) {
    if (!isRecord(clash) || typeof clash.mine !== 'string' || !isTime(clash.at)) continue
    book.clashes.set(id, {
      mine: clash.mine,
      at: clash.at,
      ...(typeof clash.to === 'string' && { to: clash.to }),
      ...(isTime(clash.links) && { links: clash.links }),
      ...(clash.done === true && { done: true as const }),
    })
  }
  return book
}

function stateOf(root: string): State {
  let state = states.get(root)
  if (state === undefined) states.set(root, (state = { book: load(root), pending: [], writing: Promise.resolve() }))
  return state
}

/**
 * Each ID `record` names — with a link, an embed, an `also_in` entry, or a link leaf of a folder's
 * settings — in the form the app writes. Number IDs only: the door never made an old ID.
 */
export function namedIds(record: IndexRecord): string[] {
  const ids = new Set<string>()
  const take = (target: string | null): void => {
    if (target !== null && isNumberId(target)) ids.add(canonicalNoteId(target))
  }
  record.links.forEach(take)
  record.embeds.forEach(take)
  alsoIn(record.properties).forEach(take)
  for (const link of folderSettingsLinks(record.properties)) take(exactLinkTarget(link))
  return [...ids]
}

/**
 * The index read `record` at `at` (R27). Cheap, and no file is touched: a note that names no
 * number ID — almost every one — is not kept at all. Whose IDs the others are is said later.
 */
export function see(root: string, record: IndexRecord, at: number): void {
  const ids = namedIds(record)
  if (ids.length === 0) return
  const state = stateOf(root)
  state.pending.push({ path: record.path, at, ids })
  later(root, state)
}

function later(root: string, state: State): void {
  if (state.timer !== undefined) return
  state.timer = setTimeout(() => {
    state.timer = undefined
    void settle(root)
  }, SAVE_MS)
  state.timer.unref()
}

/** Everything seen so far goes into the book, and the book to its file. Never throws. */
async function settle(root: string): Promise<void> {
  try {
    const [counts, { letters }] = await Promise.all([countsOf(root), vaultIds(root)])
    await openDiary(root, counts, letters, Date.now())
    await saveDiary(root)
  } catch {
    // The diary only helps a fix: one that could not be read or written changes no link.
  }
}

/**
 * The vault's book, with everything the index saw so far in it (R27) and everything too old out
 * of it (R21). `counts` says which IDs this Mac made, `letters` which IDs are the vault's. The
 * caller changes the book in place, sets `dirty`, and calls `saveDiary` where the change must be
 * on disk before its next step.
 */
export async function openDiary(root: string, counts: Counts, letters: readonly string[], now: number): Promise<Book> {
  const state = stateOf(root)
  const book = await state.book
  const mine = counts.files.get(counts.me)
  const made = (id: string | undefined): id is string => id !== undefined && madeBy(mine, noteIdNumber(id) ?? 0, now)
  // What left `made` leaves the diary (R21); an ID written with letters the vault had before is kept under its letters of now.
  for (const [key, files] of [...book.links]) {
    const id = vaultNoteId(key, letters)
    if (id === key && made(id)) continue
    book.links.delete(key)
    book.dirty = true
    if (made(id) && !book.links.has(id)) book.links.set(id, files)
  }
  const oldest = now - MADE_DAYS * 24 * 60 * 60 * 1000
  for (const [id, clash] of book.clashes) {
    if (clash.at >= oldest) continue
    book.clashes.delete(id)
    book.dirty = true
  }
  if (book.clashes.size > CLASHES_MAX) {
    const longestAgo = [...book.clashes].sort(([, a], [, b]) => a.at - b.at).slice(0, book.clashes.size - CLASHES_MAX)
    for (const [id] of longestAgo) book.clashes.delete(id)
    book.dirty = true
  }
  let size = 0
  for (const files of book.links.values()) size += files.size
  for (const { path: file, at, ids } of state.pending.splice(0)) {
    for (const written of ids) {
      const id = vaultNoteId(written, letters)
      if (!made(id)) continue
      let files = book.links.get(id)
      if (files?.has(file) === true || size >= LINKS_MAX) continue
      if (files === undefined) book.links.set(id, (files = new Map()))
      files.set(file, at)
      size++
      book.dirty = true
    }
  }
  return book
}

/** The book of `root` goes to its file now, when it changed. Atomic; resolves once it is on disk, and rejects when it could not be written. */
export function saveDiary(root: string): Promise<void> {
  const state = stateOf(root)
  const write = state.writing.then(async () => {
    const book = await state.book
    if (!book.dirty) return
    book.dirty = false
    const file = diaryFile(root)
    const doc = {
      version: DIARY_VERSION,
      root,
      links: Object.fromEntries([...book.links].map(([id, files]) => [id, Object.fromEntries(files)])),
      clashes: Object.fromEntries(book.clashes),
    }
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await atomicWrite(file, `${JSON.stringify(doc)}\n`)
    } catch (err) {
      book.dirty = true
      throw err
    }
  })
  state.writing = write.catch(() => undefined)
  return write
}

/** The diary is saved `SAVE_MS` from now, when nothing saves it before. For a change that a later step does not depend on. */
export function saveDiarySoon(root: string): void {
  later(root, stateOf(root))
}

/** Every diary with something not yet on disk is written: the last step before the app quits. Never throws. */
export async function flushDiaries(): Promise<void> {
  await Promise.all(
    [...states].map(async ([root, state]) => {
      clearTimeout(state.timer)
      state.timer = undefined
      if (state.pending.length > 0 || (await state.book).dirty) await settle(root)
    }),
  )
}

/** Test hook: forgets each diary in memory (a restart of the app), with nothing written. */
export function _resetDiary(): void {
  for (const state of states.values()) clearTimeout(state.timer)
  states.clear()
}
