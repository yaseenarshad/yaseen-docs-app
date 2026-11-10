import { boardBaseName } from '@shared/fileKind'
import type { GithubSyncMerge } from '@shared/types'
import { basename } from '../lib/paths'

/**
 * What a window says after a sync pass merged (🔒 YAZ-1897 D4, ported by YAZ-3039): one line, never
 * a dialog. Drawings merged shape by shape are named with who made the other side; "N shapes edited on both — kept
 * the newest" is said only when it happened; a file that kept both copies says where ours went.
 * A NOTE (YAZ-4615 D4, D9) says whose comments were merged in, which of ours took a new number,
 * and — when both sides changed its text — where our copy went.
 * The notice's "See changes" opens Version history on `firstBoard`; a note is never one.
 */
export interface MergeNotice {
  text: string
  /** The first board merged shape by shape — what "See changes" opens. Null when nothing was. */
  firstBoard: string | null
}

const quoted = (rel: string) => `“${boardBaseName(basename(rel)).replace(/\.md$/i, '')}”`
/** A note by its title when sync sent one (an ID vault's file name is `plan-yaz-12`), else by its file name. */
const named = (m: GithubSyncMerge) => (m.title !== undefined ? `“${m.title}”` : quoted(m.path))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function mergeNotice(merged: readonly GithubSyncMerge[]): MergeNotice {
  const boards = merged.filter((m) => m.copy === undefined && m.kind !== 'note')
  const notes = merged.filter((m) => m.copy === undefined && m.kind === 'note')
  const copies = merged.filter((m) => m.copy !== undefined)
  const parts: string[] = []
  for (const m of notes) parts.push(`Merged ${m.author}'s comments into ${named(m)}.`)
  if (boards.length > 0) {
    const authors = [...new Set(boards.map((m) => m.author))]
    const who = authors.length === 1 ? `${authors[0]}'s` : "the other computer's"
    const clashes = boards.reduce((n, m) => n + m.clashes, 0)
    parts.push(`Merged ${who} changes into ${boards.length === 1 ? quoted(boards[0].path) : plural(boards.length, 'drawing')}${clashes > 0 ? ` · ${plural(clashes, 'shape')} edited on both — kept the newest` : ''}.`)
  }
  for (const m of copies) parts.push(`${named(m)} changed on both computers — your copy is saved as ${quoted(m.copy ?? '')}.`)
  for (const m of merged) for (const r of m.renumbered ?? []) parts.push(`Your comment ${r.from} on ${named(m)} is now ${r.to}.`)
  return { text: parts.join(' '), firstBoard: boards[0]?.path ?? null }
}
