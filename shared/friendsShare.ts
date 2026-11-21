/**
 * Shared Card sanitization and acceptance formatting (YAZ-6200 D7, D8, D9).
 * Strips sender card IDs and FSRS review history before sharing; writes fresh vault ID + `shared_from` on accept.
 */
import { cardFileContent, cardFileName } from './cardFileFormat'
import { EMPTY_CARD_LINE, cardTime, withCardCreated, withCardId, withCardNext } from './cardLine'

export const MAX_SHARED_CARD_BYTES = 64 * 1024
export const MAX_SHARED_NOTE_CHARS = 200
export const MAX_SHARED_TITLE_CHARS = 120

/** Strips sender card ID / FSRS review comments and enforces size limits. */
export function sanitizeSharedCard(title: string, markdown: string, note?: string | null): { title: string; markdown: string; note: string | null } {
  const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, MAX_SHARED_TITLE_CHARS) || 'Shared card'
  const cleanMd = markdown
    .replace(/<!--\s*card:[\s\S]*?-->/gi, '')
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/m, '')
    .trim()
    .slice(0, MAX_SHARED_CARD_BYTES)
  const cleanNote = typeof note === 'string' && note.trim() !== '' ? note.replace(/\s+/g, ' ').trim().slice(0, MAX_SHARED_NOTE_CHARS) : null
  return { title: cleanTitle, markdown: cleanMd, note: cleanNote }
}

/**
 * Builds the `.md` file content and filename when a receiver accepts a shared card into their vault.
 * Adds `shared_from: "@sender"` to YAML frontmatter and starts a clean FSRS schedule with the receiver's fresh ID.
 */
export function buildAcceptedCardFile(input: {
  title: string
  markdown: string
  senderLogin: string
  newId: string
  nowMs?: number
  upNext?: boolean
}): { filename: string; content: string } {
  const nowMs = input.nowMs ?? Date.now()
  let line = withCardCreated(withCardId(EMPTY_CARD_LINE, input.newId), cardTime(nowMs))
  if (input.upNext) line = withCardNext(line, true)
  const base = cardFileContent(input.title, input.markdown, line)
  const safeLogin = input.senderLogin.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)
  const withAttribution = safeLogin
    ? base.replace(/^---\n/, `---\nshared_from: "@${safeLogin}"\n`)
    : base
  return {
    filename: cardFileName(input.title, input.newId),
    content: withAttribution,
  }
}

/** Parses 1-step friend or group invite links (web or mac deep-link). */
export function parseInviteInput(text: string): { kind: 'friend' | 'group' | 'code'; code: string } | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  if (/^[a-z0-9]{6,32}$/i.test(raw)) return { kind: 'code', code: raw.toLowerCase() }
  const match = /(?:docs\.yaseenarshad\.com|yaseendocs:\/\/)\/?(friend|group)[#/?](?:code=)?([a-z0-9]{6,32})/i.exec(raw)
  if (match) return { kind: match[1].toLowerCase() as 'friend' | 'group', code: match[2].toLowerCase() }
  return null
}
