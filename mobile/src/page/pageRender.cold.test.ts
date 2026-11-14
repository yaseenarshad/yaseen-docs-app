// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderPage, type PageLook } from './pageRender'

/**
 * YAZ-5244: the FIRST slice of a long page, with the renderer cold (this file draws nothing before it). The first start of
 * `marked` and DOMPurify is its own small slices, so no slice comes near the 50 ms limit: each stays under 25 ms of
 * this thread's CPU.
 */
const look: PageLook = { link: (i) => ({ label: i, open: null }), embed: (i) => ({ kind: 'text', text: i }), asset: () => null, card: () => document.createElement('div') }

describe('a long page, cold (YAZ-5244)', () => {
  it('the first slices are short: each under 25 ms of CPU, the first one too', async () => {
    const cpu = () => {
      const u = process.threadCpuUsage()
      return (u.user + u.system) / 1000
    }
    const work: number[] = []
    let last = cpu()
    const slice = async () => {
      work.push(cpu() - last)
      await new Promise((r) => setTimeout(r, 0))
      last = cpu()
    }
    let text = ''
    for (let i = 0; text.length < 300_000; i++) text += `## Part ${i}\n\nSome **made-up** words and a [[link]]. ${'More words. '.repeat(30)}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n`
    await renderPage(text, look, document.createElement('div'), slice)
    console.log(`[4C perf] cold: the first 4 slices ${work.slice(0, 4).map((w) => w.toFixed(1)).join(', ')} ms CPU; longest ${Math.max(...work).toFixed(1)} ms`)
    expect(work[0]).toBeLessThan(25)
    expect(Math.max(...work)).toBeLessThan(25)
  })
})
