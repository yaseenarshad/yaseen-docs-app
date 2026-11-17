import AWS from './diagrams/aws.drawio?raw'
import COMPRESSED from './diagrams/compressed.drawio?raw'
import FLOWCHART from './diagrams/flowchart.drawio?raw'
import HOSTILE from './diagrams/hostile.drawio?raw'
import MATHS from './diagrams/maths.drawio?raw'
import MULTIPAGE from './diagrams/multipage.drawio?raw'

/**
 * Made-up plain draw.io diagrams, for the screen fixture `#fixture=page-diagrams` and the headless proofs
 * (`publish/proveDiagrams.ts`): a flowchart (HTML labels, Inter, draw.io's flowchart shapes, a cylinder, a note), AWS
 * shapes with a Cisco router, three pages, a compressed file of two pages, maths labels (left out on the phone: raw
 * TeX) and a hostile file whose labels try to run script. Only tests and the `--mode fixtures` build reach this file.
 */
export const DIAGRAMS: Record<string, string> = {
  'flowchart.drawio': FLOWCHART,
  'aws.drawio': AWS,
  'multipage.drawio': MULTIPAGE,
  'compressed.drawio': COMPRESSED,
  'maths.drawio': MATHS,
  'hostile.drawio': HOSTILE,
}

const bytes = (text: string) => new TextEncoder().encode(text)

export const DIAGRAM_FILES: Record<string, string | Uint8Array> = {
  'Diagrams.md': `---\ntitle: Diagrams\nid: DEMO-7\n---\n\n# Diagrams\n\nThe sign-up flow:\n\n![[flowchart.drawio]]\n\nThe cloud:\n\n![[aws.drawio]]\n\nThree pages:\n\n![[multipage.drawio]]\n\nCompressed:\n\n![[compressed.drawio]]\n\nMaths:\n\n![[maths.drawio]]\n\nLabels that try to run script:\n\n![[hostile.drawio]]\n\nThe end.\n`,
  ...Object.fromEntries(Object.entries(DIAGRAMS).map(([name, text]) => [`Drawings/${name}`, bytes(text)])),
}
