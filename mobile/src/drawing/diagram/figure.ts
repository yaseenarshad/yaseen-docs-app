import './diagram.css'
import type { DiagramDrawn } from './drawDiagram'

/**
 * WHAT A DIAGRAM'S BOX SHOWS (YAZ-5533), in the diagram chunk (none of it is in the install): a page picker for a diagram
 * of several pages (the Mac's "Page ▸"), the picture (a tap opens it full screen, with pinch zoom), and a line when some
 * of its shapes drew as placeholders (their library downloads the first time the phone is online).
 */

/** The doors of the page's drawing code that a diagram's figure uses (`watchDrawings`). */
export interface FigureDoors {
  picture(url: string, alt: string, width: number, height: number): HTMLImageElement
  open(url: string, name: string, width: number, height: number): unknown
  page(id: string): void
}
export type DiagramFigure = (drawn: DiagramDrawn, url: string, name: string, doors: FigureDoors) => HTMLElement[]

/** The parts of a diagram's box, for `watchDrawings` to put in it. */
export const diagramFigure: DiagramFigure = (drawn, url, name, doors) => {
  const many = drawn.pages.length > 1
  const pageName = drawn.pages.find((p) => p.id === drawn.page)?.name
  const title = many && pageName ? `${name} · ${pageName}` : name
  const img = doors.picture(url, `Diagram · ${title}`, drawn.width, drawn.height)
  img.addEventListener('click', () => doors.open(img.src, title, drawn.width, drawn.height))
  const parts: HTMLElement[] = []
  if (many) {
    const label = document.createElement('label')
    label.className = 'page-drawing__pages'
    const words = document.createElement('span')
    words.textContent = 'Page'
    const select = document.createElement('select')
    select.className = 'page-drawing__select'
    for (const [i, page] of drawn.pages.entries()) {
      const option = document.createElement('option')
      option.value = page.id
      option.textContent = `${i + 1}. ${page.name}`
      option.selected = page.id === drawn.page
      select.append(option)
    }
    select.addEventListener('change', () => doors.page(select.value))
    label.append(words, select)
    parts.push(label)
  }
  parts.push(img)
  if (drawn.missing.length > 0) {
    const note = document.createElement('figcaption')
    note.className = 'page-drawing__note'
    note.textContent = "Some shapes in this diagram download the first time you're online."
    parts.push(note)
  }
  return parts
}

