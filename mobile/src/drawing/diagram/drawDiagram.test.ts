// @vitest-environment jsdom
/**
 * YAZ-5533: the app's side of draw.io's frame (the Mac's `renderDiagram.ts` protocol). jsdom runs no frame, so the
 * frame's page is played here: its "ready", its answers, and the messages a stranger sends. The real frame is proved
 * in Chrome (`publish/proveDiagrams.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramUnavailable, IDLE_CLOSE_MS, LOADED_GRACE_MS, RENDER_PATH, diagramRenderer, type DiagramRenderer } from './drawDiagram'

let renderer: DiagramRenderer | null = null
afterEach(() => {
  renderer?.close()
  renderer = null
  vi.useRealTimers()
  document.body.replaceChildren()
})

const frame = () => document.querySelector<HTMLIFrameElement>('iframe')
const tick = () => new Promise((r) => setTimeout(r, 0))

/** The frame's page says something to the app (`from`: another window plays a stranger). */
function say(msg: unknown, from: Window | null = frame()!.contentWindow, origin = location.origin) {
  window.dispatchEvent(new MessageEvent('message', { data: typeof msg === 'string' ? msg : JSON.stringify(msg), source: from, origin }))
}

/** Every request the app posted to the frame. */
function requests(): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = []
  vi.spyOn(frame()!.contentWindow!, 'postMessage').mockImplementation(((data: string, target: string) => void sent.push({ ...JSON.parse(data), target })) as never)
  return sent
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="412px" height="240px" viewBox="-0.5 -0.5 412 240"><g/></svg>'

describe("the app's side of draw.io's frame (YAZ-5533)", () => {
  it('ONE hidden frame of this site, its renderer page, sandboxed to scripts and its own origin; laid out off the screen', async () => {
    renderer = diagramRenderer()
    void renderer.draw({ text: '<mxfile/>', theme: 'light' }).catch(() => undefined)
    void renderer.draw({ text: '<mxfile/>', theme: 'dark' }).catch(() => undefined)
    await tick()
    expect(document.querySelectorAll('iframe').length).toBe(1)
    const f = frame()!
    expect(f.getAttribute('src')).toBe(RENDER_PATH)
    expect(RENDER_PATH).toMatch(/^\/drawio\/[\w]+\/render$/)
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(f.getAttribute('aria-hidden')).toBe('true')
    expect(f.style.visibility).toBe('hidden')
    expect(f.style.left).toBe('-20000px')
  })

  it("the Mac's request, to this site only; the answer: the SVG text, its size, the pages, the page drawn, the shapes to come", async () => {
    renderer = diagramRenderer()
    const drawn = renderer.draw({ text: '<mxfile>x</mxfile>', theme: 'dark', page: 'p2' })
    await tick()
    const sent = requests()
    say({ event: 'ready' })
    await tick()
    expect(sent).toEqual([{ id: 'd1', xml: '<mxfile>x</mxfile>', theme: 'dark', adaptive: 'auto', format: 'svgText', scale: 1, padding: 10, looks: null, page: 'p2', target: location.origin }])
    say({ event: 'shapes', id: 'd1', missing: ['aws4.xml'] })
    say({ id: 'd1', ok: true, svg: SVG, pages: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 7 }], page: 'p2', bounds: { x: 0, y: 0, width: 1, height: 1 } })
    expect(await drawn).toEqual({ svg: SVG, width: 412, height: 240, pages: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }], page: 'p2', missing: ['aws4.xml'] })
  })

  it("an empty page is 'empty'; a failure is a failure (\"Can't show this diagram\")", async () => {
    renderer = diagramRenderer()
    const a = renderer.draw({ text: 'x', theme: 'light' })
    const b = renderer.draw({ text: 'y', theme: 'light' })
    await tick()
    say({ event: 'ready' })
    await tick()
    say({ id: 'd1', ok: true, svg: '', pages: [], page: null })
    say({ id: 'd2', ok: false, error: 'not a draw.io diagram' })
    expect(await a).toBe('empty')
    await expect(b).rejects.toThrow('not a draw.io diagram')
  })

  it('a message from another window, another origin, or not JSON is not an answer', async () => {
    renderer = diagramRenderer()
    const drawn = renderer.draw({ text: 'x', theme: 'light' })
    await tick()
    say({ event: 'ready' })
    await tick()
    const other = document.createElement('iframe')
    document.body.append(other)
    say({ id: 'd1', ok: true, svg: '<svg width="1" height="1"/>', pages: [] }, other.contentWindow)
    say({ id: 'd1', ok: true, svg: '<svg width="2" height="2"/>', pages: [] }, frame()!.contentWindow, 'https://evil.example')
    say('not json')
    say({ id: 'd1', ok: true, svg: SVG, pages: [] })
    expect((await drawn) !== 'empty' && (await drawn as { width: number }).width).toBe(412)
  })

  it('the frame loaded but never said "ready" (no signal, the first time: the worker\'s 503): DiagramUnavailable, and the next try makes a new frame', async () => {
    vi.useFakeTimers()
    renderer = diagramRenderer()
    const drawn = renderer.draw({ text: 'x', theme: 'light' })
    const caught = drawn.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(0)
    const first = frame()!
    first.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(LOADED_GRACE_MS + 1)
    const err = await caught
    expect(err).toBeInstanceOf(DiagramUnavailable)
    expect((err as Error).name).toBe('DiagramUnavailable')
    expect(first.isConnected).toBe(false)
    void renderer.draw({ text: 'x', theme: 'light' }).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(frame()).not.toBe(first)
    expect(frame()).not.toBeNull()
  })

  it('the frame closes after its idle time with no picture asked', async () => {
    vi.useFakeTimers()
    renderer = diagramRenderer()
    const drawn = renderer.draw({ text: 'x', theme: 'light' })
    await vi.advanceTimersByTimeAsync(0)
    say({ event: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    say({ id: 'd1', ok: true, svg: SVG, pages: [] })
    await drawn
    expect(frame()).not.toBeNull()
    await vi.advanceTimersByTimeAsync(IDLE_CLOSE_MS + 1)
    expect(frame()).toBeNull()
  })
})
