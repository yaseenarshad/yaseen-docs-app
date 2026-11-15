import { addComment, commentsShape, readComments } from '@shared/comments'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { applyComment } from '../../comments/write'
import { chance, int, page, pick, rng } from './gen.testing'
import type { Finding } from './gen.testing'

const BODIES = ['Approved', 'a: b # c - "d"', 'line one\nline two\n  indented', '- dash start', '"quoted"', "it's: ok", '😀 Ünï', '---', '...', 'key: value\nother: x', '   leading', 'trailing   \n\n', '|', '>', '&anchor *ref', '!tag', '{a: 1}', '[x]', '#', 'null', 'true', '123', '\ttab', 'a\r\nb', '']

export function checkCommentSequence(seed: number): Finding[] {
  const r = rng(seed)
  const { text, shape } = page(r, { cards: int(r, 0, 2) })
  const out: Finding[] = []
  const f = (kind: string, detail: string) => out.push({ kind, seed, detail })
  let content = text
  const n = int(r, 1, 3)
  for (let i = 0; i < n; i++) {
    const body = pick(r, BODIES) + (chance(r, 0.3) ? ` ${i}` : '')
    const id = `${seed.toString(16).padStart(4, '0')}${i}abc`.slice(0, 8)
    const before = content
    const res = applyComment(before, { id, at: '2026-11-14T06:00:00Z', by: chance(r, 0.2) ? 'yaseen: "x"' : 'Yaseen', body })
    if (res.kind === 'refused') {
      f(`refused:${res.why}:${shape.fm.split('\n')[1] ?? 'none'}${shape.bom ? ':bom' : ''}`, JSON.stringify({ i, body, before: before.slice(0, 400) }))
      return out
    }
    if (res.kind === 'already') {
      f('already-on-new-id', '')
      return out
    }
    const after = res.content
    // The body stays byte for byte (BOM included), and front matter still parses on the Mac.
    const b0 = splitFrontmatter(before)
    const b1 = splitFrontmatter(after)
    if (shape.bom && !after.startsWith('﻿')) f('bom-moved', JSON.stringify(after.slice(0, 80)))
    if (b0.frontmatter !== '' && b1.body !== b0.body) f('body-changed', '')
    // A page with no block gets one in front of its body; a BOM stays the page's first character, before the block (YAZ-5512 C1).
    const bom = b0.frontmatter === '' && before.startsWith('﻿') ? '﻿' : ''
    if (b0.frontmatter === '' && !(after.startsWith(bom) && after.endsWith(before.slice(bom.length)))) f('body-changed-new-block', JSON.stringify(after.slice(0, 120)))
    // One block only: what follows the block is never a second block the page did not start with (YAZ-5512 C1).
    if (splitFrontmatter(b1.body).frontmatter !== '' && splitFrontmatter(b0.frontmatter === '' ? before.slice(bom.length) : b0.body).frontmatter === '') f('page-got-second-block', JSON.stringify(after.slice(0, 160)))
    const pf = parseFrontmatter(b1.frontmatter)
    if (pf.error !== undefined) f('mac-cannot-parse', pf.error)
    // Other keys unchanged.
    const others = (t: string) => {
      const { properties } = parseFrontmatter(splitFrontmatter(t).frontmatter)
      const { comments: _c, ...rest } = properties
      return JSON.stringify(rest)
    }
    if (others(before) !== others(after)) f('other-keys-changed', `${others(before)} -> ${others(after)}`)
    // The Mac reads the comment with its exact body, once; every earlier comment stays.
    const was = readComments(before)
    const now = readComments(after)
    const mine = now.filter((c) => c.id === id)
    if (mine.length !== 1) f('comment-count', String(mine.length))
    else if (mine[0].body !== body.trimEnd()) f('body-not-exact', `${JSON.stringify(body)} -> ${JSON.stringify(mine[0].body)}`)
    if (now.length !== was.length + 1) f('lost-or-extra', `${was.length} -> ${now.length}`)
    const bodies = (xs: { body: string }[]) => JSON.stringify(xs.map((c) => c.body).sort())
    if (bodies(now.filter((c) => c.id !== id)) !== bodies(was)) f('earlier-comment-changed', `${bodies(was)} -> ${bodies(now)}`)
    // As the Mac's own writer would number it.
    const mac = readComments(addComment(before, body, { id, at: '2026-11-14T06:00:00Z', by: 'x' })).find((c) => c.id === id)
    if (mac?.n !== mine[0]?.n) f('number-differs', `${mac?.n} vs ${mine[0]?.n}`)
    // Only front-matter lines changed (no line end of the body touched).
    const l0 = before.split('\n')
    const l1 = after.split('\n')
    const fmLines0 = b0.frontmatter.split('\n').length - 1
    const fmLines1 = b1.frontmatter.split('\n').length - 1
    if (b0.frontmatter !== '') {
      const head0 = l0.slice(0, fmLines0)
      const head1 = l1.slice(0, fmLines1)
      // the lines before the comments entry and after it stay: compare common prefix + suffix cover all but a contiguous region
      let p = 0
      while (p < head0.length && head0[p] === head1[p]) p++
      let s = 0
      while (s < head0.length - p && head0[head0.length - 1 - s] === head1[head1.length - 1 - s]) s++
      const region = head0.slice(p, head0.length - s).join('\n')
      if (region !== '' && !/^\s*comments\s*:/.test(region) && !/^\s+|^-/.test(region)) f('non-comment-fm-line-changed', JSON.stringify(region))
      const eolMix = (x: string) => /\r\n/.test(x) && /[^\r]\n/.test(x)
      if (!eolMix(before) && eolMix(after)) f('mixed-eol-introduced', '')
    }
    // Retry: the same comment again is `already`.
    if (applyComment(after, { id, at: '2026-11-14T06:00:00Z', by: 'Yaseen', body }).kind !== 'already') f('retry-not-already', '')
    if (commentsShape(after) !== 'list') f('shape-not-list', '')
    content = after
  }
  return out
}
