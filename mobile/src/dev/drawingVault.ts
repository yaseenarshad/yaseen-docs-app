import { SUN_PNG } from './readerVault'

/**
 * A made-up page with drawings (YAZ-5440), for the tests and the screen fixture `#fixture=page-drawing`: an Excalidraw
 * drawing with text and a picture from `assets/`, a draw.io picture (`.drawio.svg`), a plain draw.io file and a broken
 * drawing. Only tests and the `--mode fixtures` build reach this file.
 */

const el = (o: Record<string, unknown>) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, seed: 7, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: null, updated: 1, link: null, locked: false, ...o })
const text = (id: string, x: number, y: number, words: string, size = 24) =>
  el({ type: 'text', id, x, y, width: words.length * size * 0.55, height: size * 1.25, text: words, originalText: words, fontSize: size, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true })

/** The id of the picture inside the drawing: `assets/<id>.png`, as the Mac stores a board's pictures. */
export const GARDEN_PICTURE_ID = 'a1b2c3sun'

export const GARDEN_SCENE = {
  type: 'excalidraw',
  version: 2,
  source: 'https://yaseen-docs.app',
  elements: [
    text('title', 40, 20, 'Garden plan', 32),
    el({ type: 'rectangle', id: 'bed1', x: 40, y: 90, width: 220, height: 130, backgroundColor: '#b2f2bb', roundness: { type: 3 } }),
    text('t1', 70, 140, 'Tomatoes'),
    el({ type: 'rectangle', id: 'bed2', x: 320, y: 90, width: 220, height: 130, backgroundColor: '#ffec99', roundness: { type: 3 } }),
    text('t2', 360, 140, 'Beans'),
    el({ type: 'ellipse', id: 'pond', x: 120, y: 280, width: 180, height: 100, backgroundColor: '#a5d8ff' }),
    text('t3', 170, 315, 'Pond'),
    el({ type: 'arrow', id: 'path', x: 300, y: 330, width: 140, height: -100, points: [[0, 0], [140, -100]], startArrowhead: null, endArrowhead: 'arrow', roundness: { type: 2 } }),
    el({ type: 'image', id: 'sun', x: 450, y: 250, width: 96, height: 54, fileId: GARDEN_PICTURE_ID, status: 'saved', scale: [1, 1] }),
  ],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
  files: {},
}

/** A draw.io diagram saved as a picture: an SVG with its diagram inside (`content`), and a script that must never run. */
export const FLOW_DRAWIO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="140" viewBox="0 0 420 140" content="&lt;mxfile&gt;&lt;/mxfile&gt;"><script>window.drawioRan = 1</script><rect x="10" y="40" width="120" height="60" rx="9" fill="#dae8fc" stroke="#6c8ebf"/><text x="70" y="75" text-anchor="middle" font-family="Helvetica" font-size="14">Seed</text><path d="M130 70 H 280" stroke="#333" stroke-width="2" marker-end="url(#a)"/><defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#333"/></marker></defs><rect x="285" y="40" width="120" height="60" rx="9" fill="#d5e8d4" stroke="#82b366"/><text x="345" y="75" text-anchor="middle" font-family="Helvetica" font-size="14">Harvest</text></svg>`

export const DRAWING_FILES: Record<string, string | Uint8Array> = {
  'Garden plan.md': `---\ntitle: Garden plan\nid: DEMO-5\n---\n\n# Garden plan\n\nThe beds for the spring.\n\n![[garden.excalidraw]]\n\nFrom seed to harvest:\n\n![[flow.drawio.svg]]\n\nThe old plan: ![[old plan.drawio]]\n\n![[broken.excalidraw]]\n\nThe end.\n`,
  'garden.excalidraw': new TextEncoder().encode(JSON.stringify(GARDEN_SCENE)),
  [`assets/${GARDEN_PICTURE_ID}.png`]: SUN_PNG,
  'flow.drawio.svg': new TextEncoder().encode(FLOW_DRAWIO_SVG),
  'old plan.drawio': new TextEncoder().encode('<mxfile><diagram id="d" name="Page-1"></diagram></mxfile>'),
  'broken.excalidraw': new TextEncoder().encode('{ this is not a drawing'),
}
