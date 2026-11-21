/**
 * LINK SPOTS (YAZ-4943): where each link of a board is, in board units, so a click on Explore's board layer opens it.
 */
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { diagramLinkSpots, drawingLinkSpots, spotAt } from './boardLinks'

const box = { x: 10, y: 20, width: 200, height: 40 }

describe('drawing link spots', () => {
  it('a text with one link: the whole text box; a shape link: the shape box, a `[[link]]` or an address', () => {
    const spots = drawingLinkSpots([
      { id: 't', type: 'text', ...box, text: 'See [[DNS basics]] here' },
      { id: 'r', type: 'rectangle', x: 300, y: 0, width: 50, height: 50, link: '[[TCP]]' },
      { id: 'w', type: 'rectangle', x: 400, y: 0, width: 50, height: 50, link: 'https://example.com' },
      { id: 'p', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'no link' },
      { id: 'd', type: 'text', ...box, text: '[[Gone]]', isDeleted: true },
    ])
    expect(spots).toEqual([
      { ...box, inner: 'DNS basics', wiki: true },
      { x: 300, y: 0, width: 50, height: 50, inner: 'TCP', wiki: true },
      { x: 400, y: 0, width: 50, height: 50, inner: 'https://example.com', wiki: false },
    ])
  })

  it('two or more links: the box splits by line, then by each link`s place in its line', () => {
    const spots = drawingLinkSpots([{ id: 't', type: 'text', x: 0, y: 0, width: 100, height: 40, text: '[[A]]xxxxx[[B]]\n[[C]]' }])
    expect(spots.map((s) => s.inner)).toEqual(['A', 'B', 'C'])
    // Line 1 is 15 characters: A takes 0–5, B 10–15 of 100 px; line 2 is all C.
    expect(spots[0]).toMatchObject({ x: 0, y: 0, height: 20 })
    expect(spots[0].width).toBeCloseTo(100 / 3)
    expect(spots[1].x).toBeCloseTo((100 * 10) / 15)
    expect(spots[2]).toMatchObject({ x: 0, y: 20, width: 100, height: 20 })
  })

  it('spotAt finds the spot under a board point, the last drawn first', () => {
    const spots = drawingLinkSpots([
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100, link: '[[Under]]' },
      { id: 'b', type: 'text', x: 10, y: 10, width: 20, height: 20, text: '[[Over]]' },
    ])
    expect(spotAt(spots, 15, 15)?.inner).toBe('Over')
    expect(spotAt(spots, 80, 80)?.inner).toBe('Under')
    expect(spotAt(spots, 200, 200)).toBeNull()
  })
})

const PAGE = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`
const FILE = (pages: Array<{ id: string; body: string }>) => `<mxfile>${pages.map((p) => `<diagram id="${p.id}" name="${p.id}">${p.body}</diagram>`).join('')}</mxfile>`

describe('diagram link spots', () => {
  it('a cell with a `[[link]]` in its label (HTML too) or a link attribute; a child of a group sits inside its parent; an edge has none', async () => {
    const xml = FILE([
      {
        id: 'p1',
        body: PAGE(
          '<mxCell id="a" value="Go to [[DNS basics]]" style="" vertex="1" parent="1"><mxGeometry x="40" y="60" width="120" height="40" as="geometry"/></mxCell>' +
            '<mxCell id="g" value="" style="group" vertex="1" parent="1"><mxGeometry x="200" y="100" width="300" height="200" as="geometry"/></mxCell>' +
            '<mxCell id="b" value="&lt;b&gt;[[TCP]]&lt;/b&gt;" style="html=1;" vertex="1" parent="g"><mxGeometry x="10" y="20" width="80" height="30" as="geometry"/></mxCell>' +
            '<UserObject label="Site" link="https://example.com" id="u"><mxCell style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></UserObject>' +
            '<mxCell id="e" value="[[Edge]]" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>',
        ),
      },
      { id: 'p2', body: PAGE('<mxCell id="c" value="[[Other]]" vertex="1" parent="1"><mxGeometry x="5" y="5" width="10" height="10" as="geometry"/></mxCell>') },
    ])
    expect(await diagramLinkSpots(xml, null)).toEqual([
      { x: 40, y: 60, width: 120, height: 40, inner: 'DNS basics', wiki: true },
      { x: 210, y: 120, width: 80, height: 30, inner: 'TCP', wiki: true },
      { x: 0, y: 0, width: 10, height: 10, inner: 'https://example.com', wiki: false },
    ])
    expect(await diagramLinkSpots(xml, 'p2')).toEqual([{ x: 5, y: 5, width: 10, height: 10, inner: 'Other', wiki: true }])
    // A page that is gone: the first, as the picture does.
    expect((await diagramLinkSpots(xml, 'gone')).map((s) => s.inner)).toEqual(['DNS basics', 'TCP', 'https://example.com'])
  })

  it('a compressed page (draw.io`s deflate + base64) reads the same; a broken file gives none', async () => {
    const model = PAGE('<mxCell id="a" value="[[Packed]]" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>')
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64')
    expect(await diagramLinkSpots(FILE([{ id: 'p', body: packed }]), null)).toEqual([{ x: 1, y: 2, width: 3, height: 4, inner: 'Packed', wiki: true }])
    expect(await diagramLinkSpots('<mxfile><diagram id="p">%%%</diagram></mxfile>', null)).toEqual([])
    expect(await diagramLinkSpots('not xml', null)).toEqual([])
  })
})
