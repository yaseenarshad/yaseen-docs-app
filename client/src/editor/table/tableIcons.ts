/**
 * The table menu's icons (the YAZ-4163 demo: Yaseen picked the icons of the approved mockup): Tabler Icons, outline,
 * v3.19.0 (MIT, https://tabler.io/icons), each as its inner SVG markup on a 24 × 24 grid. `tablerIcon` draws one in
 * the text colour, lines only.
 */
const TABLER = {
  tableRow: '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z"/><path d="M9 3l-6 6"/><path d="M14 3l-7 7"/><path d="M19 3l-7 7"/><path d="M21 6l-4 4"/><path d="M3 10h18"/><path d="M10 10v11"/>',
  baselineDensityMedium: '<path d="M4 20h16"/><path d="M4 12h16"/><path d="M4 4h16"/>',
  arrowsHorizontal: '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M3 12l18 0"/>',
  alignLeft: '<path d="M4 6l16 0"/><path d="M4 12l10 0"/><path d="M4 18l14 0"/>',
  alignCenter: '<path d="M4 6l16 0"/><path d="M8 12l8 0"/><path d="M6 18l12 0"/>',
  alignRight: '<path d="M4 6l16 0"/><path d="M10 12l10 0"/><path d="M6 18l14 0"/>',
  layoutAlignTop: '<path d="M4 4l16 0"/><path d="M9 8m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/>',
  layoutAlignMiddle: '<path d="M4 12l5 0"/><path d="M15 12l5 0"/><path d="M9 6m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/>',
  layoutAlignBottom: '<path d="M4 20l16 0"/><path d="M9 4m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/>',
  arrowsMinimize: '<path d="M5 9l4 0l0 -4"/><path d="M3 3l6 6"/><path d="M5 15l4 0l0 4"/><path d="M3 21l6 -6"/><path d="M19 9l-4 0l0 -4"/><path d="M15 9l6 -6"/><path d="M19 15l-4 0l0 4"/><path d="M15 15l6 6"/>',
  lineHeight: '<path d="M3 8l3 -3l3 3"/><path d="M3 16l3 3l3 -3"/><path d="M6 5l0 14"/><path d="M13 6l7 0"/><path d="M13 12l7 0"/><path d="M13 18l7 0"/>',
  arrowsMaximize: '<path d="M16 4l4 0l0 4"/><path d="M14 10l6 -6"/><path d="M8 20l-4 0l0 -4"/><path d="M4 20l6 -6"/><path d="M16 20l4 0l0 -4"/><path d="M14 14l6 6"/><path d="M8 4l-4 0l0 4"/><path d="M4 4l6 6"/>',
  textWrap: '<path d="M4 6l16 0"/><path d="M4 18l5 0"/><path d="M4 12h13a3 3 0 0 1 0 6h-4l2 -2m0 4l-2 -2"/>',
} as const

export type TablerIcon = keyof typeof TABLER

export const tablerIcon = (name: TablerIcon) => (): SVGElement => {
  const template = document.createElement('template')
  template.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${TABLER[name]}</svg>`
  return template.content.firstElementChild as SVGElement
}
