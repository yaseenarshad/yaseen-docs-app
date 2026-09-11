/**
 * `comments/markdown.ts` (YAZ-1472): a comment body is GitHub-flavoured Markdown rendered
 * read-only — `marked` with `breaks` on, then DOMPurify's html profile with style / form / button
 * forbidden on top (a task list's disabled checkbox is the one form control kept). These pin what
 * the pair ACTUALLY emits and what the folded row's one-line summary strips.
 */
import { describe, expect, it } from 'vitest'
import { commentHtml, commentSummary } from './markdown'

describe('commentHtml — GitHub-flavoured Markdown', () => {
  it('headings', () => {
    expect(commentHtml('# Title\n\n## Sub')).toBe('<h1>Title</h1>\n<h2>Sub</h2>\n')
  })

  it('emphasis and strikethrough', () => {
    expect(commentHtml('*em* **strong** ~~gone~~')).toBe('<p><em>em</em> <strong>strong</strong> <del>gone</del></p>\n')
  })

  it('a list', () => {
    expect(commentHtml('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  })

  it('a task list keeps its checkbox, DISABLED: `- [x]` reads as done, `- [ ]` as not', () => {
    const html = commentHtml('- [x] done\n- [ ] todo')
    expect(html).toBe('<ul>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n<li><input disabled="" type="checkbox"> todo</li>\n</ul>\n')
  })

  it('a GFM table', () => {
    expect(commentHtml('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n',
    )
  })

  it('a fenced code block keeps its language class', () => {
    expect(commentHtml('```js\nlet x = 1\n```')).toBe('<pre><code class="language-js">let x = 1\n</code></pre>\n')
  })

  it('a blockquote', () => {
    expect(commentHtml('> quote')).toBe('<blockquote>\n<p>quote</p>\n</blockquote>\n')
  })

  it('a link', () => {
    expect(commentHtml('[site](https://example.com)')).toBe('<p><a href="https://example.com">site</a></p>\n')
  })
})

describe('commentHtml — line breaks', () => {
  it('a single newline is a <br>, the way a typed comment reads', () => {
    expect(commentHtml('one\ntwo')).toBe('<p>one<br>two</p>\n')
  })

  it('a blank line starts a new paragraph', () => {
    expect(commentHtml('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>\n')
  })
})

describe('commentHtml — sanitised', () => {
  it.each([
    ['<script>', 'hi <script>alert(1)</script> there', '<script', '<p>hi  there</p>\n'],
    ['an onerror= handler', '<img src=x onerror=alert(1)>', 'onerror', '<img src="x">'],
    ['a javascript: href', '[x](javascript:alert(1))', 'javascript:', '<p><a>x</a></p>\n'],
    ['<style>', '<style>p{}</style>text', '<style', 'text'],
    ['<form> (its content stays)', '<form>x</form>text', '<form', 'xtext'],
    ['<iframe>', '<iframe src="https://x"></iframe>text', '<iframe', 'text'],
  ])('strips %s', (_label, body, forbidden, expected) => {
    const html = commentHtml(body)
    expect(html).not.toContain(forbidden)
    expect(html).toBe(expected)
  })

  it('keeps a raw <a href="https://…">', () => {
    expect(commentHtml('<a href="https://example.com">site</a>')).toBe('<p><a href="https://example.com">site</a></p>\n')
  })
})

describe('commentSummary — the folded row', () => {
  it.each([
    ['# Heading', 'Heading'],
    ['- [ ] task', 'task'],
    ['1) item', 'item'],
    ['> quote', 'quote'],
    ['\n\n  \nplain after blanks\nsecond line', 'plain after blanks'],
    ['plain text', 'plain text'],
  ])('%j → %j', (body, summary) => {
    expect(commentSummary(body)).toBe(summary)
  })
})
