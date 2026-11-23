/**
 * Shared Card sanitization and acceptance formatting (YAZ-6200 D7, D8, D9).
 * Strips sender card IDs and FSRS review history before sharing; writes fresh vault ID + `shared_from` on accept.
 */
import { cardFileContent, cardFileName } from './cardFileFormat'
import { EMPTY_CARD_LINE, cardTime, withCardCreated, withCardId, withCardNext } from './cardLine'

export const MAX_SHARED_CARD_BYTES = 64 * 1024
export const MAX_SHARED_NOTE_CHARS = 200
export const MAX_SHARED_TITLE_CHARS = 120

/**
 * Strips private card ID / SM-2 / FSRS review comments (`<!-- card: ... -->`) from a shared
 * deck Markdown file on the fly while preserving the rest of the page/card Markdown.
 */
export function sanitizeSharedMarkdown(markdown: string): string {
  return markdown
    .replace(/^[ \t]*<!--\s*card:[\s\S]*?-->[ \t]*\r?\n?/gim, '')
    .replace(/<!--\s*card:[\s\S]*?-->/gi, '')
}

const ASSET_EXT_RE = /\.(?:png|jpe?g|webp|gif|svg|pdf|mp3|m4a|wav|ogg|mp4|mov|webm|excalidraw|drawio)$/i

function resolveRelativePath(rawTarget: string, filePath?: string): string | null {
  let target = rawTarget.trim()
  if (!target) return null
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim()
  // Strip optional markdown title ("..." or '...')
  target = target.replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, '').trim()
  // Strip fragment and query
  target = target.split('#')[0].split('?')[0].trim()
  if (!target) return null
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(target)) return null
  try {
    target = decodeURIComponent(target)
  } catch {
    // keep raw if malformed percent-encoding
  }

  const baseParts = filePath ? filePath.split('/').slice(0, -1).filter(Boolean) : []
  const relParts = target.replace(/\\/g, '/').split('/')
  const stack = [...baseParts]
  for (const part of relParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    if (part.startsWith('.')) return null
    stack.push(part)
  }
  if (stack.length === 0) return null
  if (stack[0] === '.yaseendocs') return null
  return stack.join('/')
}

/**
 * Extracts deduplicated vault-relative asset paths referenced by Markdown images (`![alt](path)`),
 * Obsidian-style embeds (`![[file.png]]`), and HTML `<img src="path">` tags.
 */
export function extractRelativeAssetPaths(markdown: string, filePath?: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string, requireAssetExt = false) => {
    const resolved = resolveRelativePath(raw, filePath)
    if (!resolved) return
    if (requireAssetExt && !ASSET_EXT_RE.test(resolved)) return
    if (!seen.has(resolved)) {
      seen.add(resolved)
      out.push(resolved)
    }
  }

  // Standard markdown image syntax: ![alt](target)
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    add(m[1], false)
  }
  // Obsidian wiki embeds: ![[path.png]] or ![[path.png|width]]
  for (const m of markdown.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    add(m[1], true)
  }
  // HTML <img src="...">
  for (const m of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    add(m[1] ?? m[2] ?? '', false)
  }
  return out
}

/** Strips sender card ID / FSRS review comments and enforces size limits. */
export function sanitizeSharedCard(title: string, markdown: string, note?: string | null): { title: string; markdown: string; note: string | null } {
  const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, MAX_SHARED_TITLE_CHARS) || 'Shared card'
  const cleanMd = sanitizeSharedMarkdown(markdown)
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
