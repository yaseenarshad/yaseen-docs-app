// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderPage, splitBlocks, type PageLook } from './pageRender'
import { ATTACK, remoteAttributes, watchWrites } from './testing'

/**
 * A slicer that yields after each piece and records the CPU time of THIS thread (`process.threadCpuUsage`) spent between
 * two yields: the renderer's own slice of work. Waiting for the machine is no CPU time, so the load does not count.
 */
function cpuSlices(): { slice: () => Promise<void>; work: number[] } {
  const cpu = () => {
    const u = process.threadCpuUsage()
    return (u.user + u.system) / 1000
  }
  const work: number[] = []
  let last = cpu()
  return {
    work,
    async slice() {
      work.push(cpu() - last)
      await new Promise((r) => setTimeout(r, 0))
      last = cpu()
    },
  }
}

/** A look with a made-up vault: two pages, one card file, one picture, one PDF. */
const look: PageLook = {
  link: (inner) => {
    const page = inner.split('|')[0].split('#')[0].trim()
    const words = inner.includes('|') ? inner.split('|')[1] : null
    if (page === 'Trip plan') return { label: words ?? 'Trip plan', open: { kind: 'page', path: 'Trip plan.md' } }
    if (page === 'DEMO-40') return { label: 'Capital of Spain', open: { kind: 'card', path: 'cards/capital.md', id: 'DEMO-40' } }
    if (page === 'Guide.pdf') return { label: 'Guide.pdf', open: { kind: 'file', path: 'docs/Guide.pdf' } }
    if (page === 'DEMO-99') return { label: 'DEMO-99', open: null, missing: 'Missing page · DEMO-99' }
    return { label: words ?? page, open: null }
  },
  embed: (inner) => {
    if (inner === 'DEMO-40') return { kind: 'card', id: 'DEMO-40' }
    if (inner === 'DEMO-77') return { kind: 'missing-card', id: 'DEMO-77' }
    if (inner === 'pic.png') return { kind: 'picture', path: 'assets/pic.png', alt: 'pic.png' }
    if (inner === 'song.mp3') return { kind: 'sound', path: 'assets/song.mp3' }
    if (inner.endsWith('.excalidraw')) return { kind: 'drawing', name: inner }
    return { kind: 'text', text: `![[${inner}]]` }
  },
  asset: (src) => (src === 'pic.png' || src === 'assets/pic.png' ? 'assets/pic.png' : src === 'Guide.pdf' ? 'docs/Guide.pdf' : src === 'Trip%20plan.md' ? 'Trip plan.md' : null),
  card: (text) => {
    const el = document.createElement('div')
    el.className = 'test-card'
    el.textContent = text
    return el
  },
}

async function draw(markdown: string): Promise<HTMLElement> {
  const host = document.createElement('div')
  await renderPage(markdown, look, host)
  return host
}

const EVERY_BLOCK = `# Heading one
## Heading two
### Heading three

A paragraph with **bold**, *italic*, ~~gone~~, \`code\`, ==marked== and <u>under</u>.
A second line in the same paragraph.

- one
- two
  - nested
1. first
2. second

- [ ] to do
- [x] done

| Name | Value |
| --- | :-: |
| a | 1 |

\`\`\`ts
const x = 1 < 2
\`\`\`

> A quote.

> [!tip] Good to know
> The callout text.

---

![A picture](pic.png)

[[Trip plan]], [[Trip plan|the plan]], [[Nowhere]], [[DEMO-40]], [[DEMO-99]], [[Guide.pdf]], [web](https://example.com/a?b=1), [file](Guide.pdf), [md link](Trip%20plan.md), [top](#heading-one)

![[DEMO-40]]

![[DEMO-77]]

![[song.mp3]]

![[board.excalidraw]]

\`\`\`card
la biblioteca
---
the library
\`\`\`
<!-- card: DEMO-12, 2026-11-01T10:00Z good -->
`

describe('a page, read only, with no editor (YAZ-5079)', () => {
  it('draws every block type as the Mac shows it', async () => {
    const el = await draw(EVERY_BLOCK)
    expect([...el.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName}:${h.textContent}`)).toEqual(['H1:Heading one', 'H2:Heading two', 'H3:Heading three'])
    const p = el.querySelector('p')!
    expect(p.querySelector('strong')?.textContent).toBe('bold')
    expect(p.querySelector('em')?.textContent).toBe('italic')
    expect(p.querySelector('del')?.textContent).toBe('gone')
    expect(p.querySelector('code')?.textContent).toBe('code')
    expect(p.querySelector('mark')?.textContent).toBe('marked')
    expect(p.querySelector('u')?.textContent).toBe('under')
    // A single line break is a line break, as the Mac's page shows it (softBreaks.css).
    expect(p.querySelector('br')).not.toBeNull()
    expect(el.querySelector('ul ul li')?.textContent).toBe('nested')
    expect([...el.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['first', 'second'])
    // A task box is a mark, not a control: nothing to tick in stage one.
    const tasks = [...el.querySelectorAll('.page-task')]
    expect(tasks.map((t) => t.getAttribute('aria-label'))).toEqual(['Not done', 'Done'])
    expect(el.querySelector('input')).toBeNull()
    expect(el.querySelector('.page-table > table th')?.textContent).toBe('Name')
    expect(el.querySelector('pre > code.language-ts')?.textContent).toBe('const x = 1 < 2\n')
    expect(el.querySelector('blockquote:not(.page-callout)')?.textContent?.trim()).toBe('A quote.')
    const callout = el.querySelector('.page-callout')!
    expect(callout.getAttribute('data-callout')).toBe('tip')
    expect(callout.querySelector('.page-callout__title')?.textContent).toBe('Good to know')
    expect(callout.textContent).toContain('The callout text.')
    expect(callout.textContent).not.toContain('[!tip]')
    expect(el.querySelector('hr')).not.toBeNull()
  })

  it('YAZ-5212: footnotes, block math and table cell notes, as the Mac shows them (no raw Markdown)', async () => {
    const el = await draw(
      [
        'Footnote here[^1]. And [^note].',
        '[^1]: The note.',
        '[^note]: A second note.',
        'Dollars are text, as on the Mac: $500K–$1M.',
        '$$\\int_0^1 x\\,dx$$',
        '| Name | Value |\n| --- | --- |\n| a[^cell-1] | 1 |',
        '[^cell-1]: The cell note.',
      ].join('\n\n'),
    )
    const text = el.textContent ?? ''
    expect(text).not.toContain('[^')
    expect(text).not.toContain('$$')
    expect([...el.querySelectorAll('sup.page-fnref a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['1', '#fn-1'],
      ['note', '#fn-note'],
    ])
    expect([...el.querySelectorAll('.page-footnote')].map((f) => [f.id, f.textContent])).toEqual([
      ['fn-1', '1The note.'],
      ['fn-note', 'noteA second note.'],
    ])
    // The Mac draws no math (its Latex feature is off: YAZ-977): a block shows its source as code, inline dollars stay.
    expect(el.querySelector('pre.page-math code')?.textContent).toBe('\\int_0^1 x\\,dx')
    expect(text).toContain('$500K–$1M.')
    // A cell note is hidden under its table, as on the Mac (YAZ-3818); the cell keeps a small mark.
    expect(el.querySelector('td sup.page-cellnote')).not.toBeNull()
    expect(text).not.toContain('The cell note.')
  })

  it('YAZ-5208: an attack page fetches nothing from another host; a web picture, sound or video is a link to tap', async () => {
    const watch = watchWrites()
    const el = document.createElement('div')
    document.body.append(el)
    try {
      await renderPage(ATTACK, look, el)
    } finally {
      watch.stop()
    }
    expect(watch.remote).toEqual([])
    expect(remoteAttributes(el)).toEqual([])
    expect(el.querySelector('video, audio, source, track, picture, object, embed, iframe, link, meta, base, svg, form, input, button, [background], [style], [srcset], [poster]')).toBeNull()
    const web = [...el.querySelectorAll<HTMLAnchorElement>('a.page-media--web')]
    expect(web.length).toBeGreaterThanOrEqual(4)
    expect(web.every((a) => a.target === '_blank' && a.rel === 'noopener noreferrer')).toBe(true)
    expect(web.map((a) => a.textContent)).toContain('Picture from the web · md picture')
    expect(web.map((a) => a.textContent)).toContain('Sound from the web · md sound')
    expect(web.map((a) => a.textContent)).toContain('Video from the web · video')
    el.remove()
  })

  it('a picture of the vault waits for its bytes: no address the browser would fetch', async () => {
    const el = await draw('![A picture](pic.png)\n\n![[pic.png]]\n\n![gone](missing.png)\n\n![web](https://example.com/x.png)')
    const pics = [...el.querySelectorAll<HTMLImageElement>('img[data-vault-src]')]
    expect(pics.map((i) => [i.dataset.vaultSrc, i.getAttribute('src'), i.alt])).toEqual([
      ['assets/pic.png', null, 'A picture'],
      ['assets/pic.png', null, 'pic.png'],
    ])
    // A picture the vault does not have, and one from the web (the page's CSP loads none): a calm line, no fetch.
    expect([...el.querySelectorAll('.page-media--missing')].map((m) => m.textContent)).toEqual(['Missing picture · missing.png'])
    // A web picture is never fetched: a link the person may tap (Safari).
    expect(el.querySelector<HTMLAnchorElement>('a.page-media--web')?.textContent).toBe('Picture from the web · web')
    expect(el.querySelector('img[src^="http"]')).toBeNull()
  })

  it('links: a page link opens the page, a card link the card, a broken link says so, a web link opens Safari', async () => {
    const el = await draw('[[Trip plan]] [[Trip plan|the plan]] [[Nowhere]] [[DEMO-40]] [[DEMO-99]] [[Guide.pdf]] [web](https://example.com/a?b=1) [file](Guide.pdf) [md](Trip%20plan.md) [mail](mailto:a@b.c) [top](#x)')
    const links = [...el.querySelectorAll('a')].map((a) => [a.textContent, a.dataset.open ?? null, a.dataset.path ?? null, a.getAttribute('target'), a.className])
    expect(links).toEqual([
      ['Trip plan', 'page', 'Trip plan.md', null, 'wikilink'],
      ['the plan', 'page', 'Trip plan.md', null, 'wikilink'],
      ['Nowhere', null, null, null, 'wikilink wikilink--unresolved'],
      ['Capital of Spain', 'card', 'cards/capital.md', null, 'wikilink wikilink--card'],
      ['DEMO-99', null, null, null, 'wikilink wikilink--unresolved'],
      ['Guide.pdf', 'file', 'docs/Guide.pdf', null, 'wikilink'],
      ['web', null, null, '_blank', ''],
      ['file', 'file', 'docs/Guide.pdf', null, ''],
      ['md', 'page', 'Trip plan.md', null, ''],
      ['mail', null, null, '_blank', ''],
      ['top', null, null, null, ''],
    ])
    expect(el.querySelector('a[target="_blank"]')?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(el.querySelector('.wikilink--unresolved')?.getAttribute('title')).toBeNull()
    expect([...el.querySelectorAll('.wikilink--unresolved')][1].getAttribute('aria-label')).toBe('Missing page · DEMO-99')
  })

  it('embeds: a card in place, a missing card as the Mac says it, a sound, a drawing to open on the Mac', async () => {
    const el = await draw('![[DEMO-40]]\n\n![[DEMO-77]]\n\n![[song.mp3]]\n\n![[board.excalidraw]]\n\n![[Some page]]')
    expect(el.querySelector('[data-card-embed]')?.getAttribute('data-card-embed')).toBe('DEMO-40')
    expect(el.querySelector('.card-embed--missing')?.textContent).toBe('Missing card · DEMO-77')
    expect(el.querySelector('[data-vault-sound]')?.getAttribute('data-vault-sound')).toBe('assets/song.mp3')
    expect(el.querySelector('.page-media--board')?.textContent).toBe('Drawing · board.excalidraw · Open it on the Mac')
    expect(el.textContent).toContain('![[Some page]]')
  })

  it("a page's own card: the card drawn read only, its card line out of sight", async () => {
    const el = await draw('Before.\n\n```card\nla biblioteca\n---\nthe library\n```\n<!-- card: DEMO-12, 2026-11-01T10:00Z good -->\n\nAfter.')
    expect(el.querySelector('.page-card .test-card')?.textContent).toBe('la biblioteca\n---\nthe library')
    expect(el.querySelector('.page-card')?.getAttribute('data-card-id')).toBe('DEMO-12')
    expect(el.textContent).not.toContain('card: DEMO-12')
    expect(el.textContent).toContain('After.')
  })

  it('a page is untrusted: no script runs, no handler stays, no javascript: link', async () => {
    const w = window as unknown as { ran?: number }
    w.ran = 0
    const el = await draw(
      [
        '<script>window.ran = 1</script>',
        '<img src="x.png" onerror="window.ran = 2">',
        '<a href="javascript:window.ran = 3">click</a> [md](javascript:window.ran=4)',
        '<iframe src="https://example.com"></iframe><object data="x"></object><embed src="x">',
        '<div onclick="window.ran = 5" style="position:fixed">styled</div>',
        '<form><input value="x"><button>b</button></form>',
        '[[x" onmouseover="window.ran=6]]',
        '<svg><script>window.ran = 7</script></svg>',
      ].join('\n\n'),
    )
    document.body.append(el)
    await new Promise((r) => setTimeout(r, 20))
    for (const a of el.querySelectorAll('a')) a.click()
    for (const d of el.querySelectorAll('div')) d.click()
    expect(w.ran).toBe(0)
    expect(el.querySelector('script, iframe, object, embed, form, input, button, style')).toBeNull()
    // No attribute is a handler, and no address runs code. (A link's TEXT may say anything: it is text.)
    const attrs = [...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => `${a.name}=${a.value}`))
    expect(attrs.filter((a) => /^on/i.test(a) || /javascript:/i.test(a))).toEqual([])
    expect(el.querySelector('[style]')).toBeNull()
    el.remove()
  })

  it('splits a long page only between blocks, never inside a fence', () => {
    const fence = '```\na\n\nb\n```'
    const text = `${'x'.repeat(30)}\n\n${fence}\n\n${'y'.repeat(30)}`
    const parts = splitBlocks(text, 10)
    expect(parts.join('')).toBe(text)
    expect(parts.some((p) => p.includes(fence))).toBe(true)
    expect(splitBlocks('short', 10)).toEqual(['short'])
  })

  it('YAZ-5213: a 2 MB page draws in slices, and no slice of its work takes 50 ms (CPU time of this thread)', async () => {
    const block = (i: number) => `## Part ${i}\n\nSome **made-up** words, a [[Trip plan]] link and \`code\`. ${'More words here. '.repeat(20)}\n\n- one\n- two\n\n`
    let text = ''
    for (let i = 0; text.length < 2_000_000; i++) text += block(i)
    const parts = (text.match(/^## Part/gm) ?? []).length
    const host = document.createElement('div')
    const t0 = performance.now()
    const run = cpuSlices()
    await renderPage(text, look, host, run.slice)
    const ms = performance.now() - t0
    expect(host.querySelectorAll('h2').length).toBe(parts)
    const sorted = [...run.work].sort((x, y) => x - y)
    console.log(`[4C perf] a ${(text.length / 1e6).toFixed(1)} MB page (${parts} parts) in jsdom: ${ms.toFixed(0)} ms in all, ${run.work.length} slices; CPU of a slice: median ${sorted[sorted.length >> 1].toFixed(1)} ms, longest ${sorted.at(-1)!.toFixed(1)} ms`)
    expect(run.work.length).toBeGreaterThan(100)
    // The page's own work between two yields, in CPU time of this thread: the load of the machine does not count.
    expect(sorted.at(-1)!).toBeLessThan(50)
  }, 300_000)

  it('YAZ-5213: the slice measure is honest: a 200 ms busy loop in one piece shows as a slice of 200 ms', async () => {
    const slow: PageLook = {
      ...look,
      card: (t) => {
        // 200 ms of this thread's CPU (a wall-clock loop on a busy machine gets less CPU).
        const cpu = () => process.threadCpuUsage().user / 1000
        const end = cpu() + 200
        while (cpu() < end);
        return look.card(t)
      },
    }
    let text = `\`\`\`card\nslow\n\`\`\`\n\n`
    while (text.length < 80_000) text += `${'Words. '.repeat(30)}\n\n`
    const run = cpuSlices()
    await renderPage(text, slow, document.createElement('div'), run.slice)
    expect(Math.max(...run.work)).toBeGreaterThanOrEqual(150)
  })
})
