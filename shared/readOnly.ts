/**
 * THE HUMAN'S READ-ONLY SWITCH, stored IN the file (YAZ-3076 D1), so it moves with the file: a
 * rename by any tool keeps it, GitHub sync carries it to the other Mac, and an agent that reads the
 * file sees it. It is a setting of THIS app only — an agent or any other tool still writes the file.
 *
 *  - a note: `readonly: true` in the frontmatter (a reserved key, `client/src/links/reservedKeys.ts`);
 *  - a drawing: `"readonly": true` in the top-level `yaseendraw` block (YAZ-1834), which the save door
 *    carries forward like every extra key of the block;
 *  - a diagram: `yaseendraw-readonly="1"` on the root `<mxfile>`, beside the dates (YAZ-1802 D7).
 *
 * NO ENTRY MEANS EDITABLE, so old files and files from other tools need no migration (S1). Only the
 * value `true` (a note, a drawing) or `"1"` (a diagram) counts; any other value is editable and "on"
 * writes the correct one (S8). "Off" REMOVES the key or the attribute, never writes `false` (S3).
 * The same value again returns the SAME string or object, so the caller writes nothing (S11).
 *
 * Pure: no fs, no DOM. Main's door (`desktop/src/main/fs/boardReadOnly.ts`) and the renderer
 * (`transformFile` for a note) both use it. Tests: `desktop/src/main/fs/readOnly.test.ts`.
 */
import { BOARD_META_KEY, withSwitchTime } from './drawingAssets'
import { mxfileOpenTag, wrapBareModel } from './diagramFile'
import { frontmatterInterior, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { isFiniteNumber, isRecord } from './guards'

/** The key in a note's frontmatter and in a drawing's `yaseendraw` block. */
export const READ_ONLY_KEY = 'readonly'
/** The attribute on a diagram's root `<mxfile>`. */
export const DIAGRAM_READ_ONLY_ATTR = 'yaseendraw-readonly'

// ---------- A note ----------

/**
 * Whether the note's frontmatter says `readonly: true`. A block without the word is not parsed at
 * all; a block that does not parse is editable — the switch is never guessed.
 */
export function isNoteReadOnly(content: string): boolean {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter.includes(READ_ONLY_KEY)) return false
  return isReadOnlyProperties(parseFrontmatter(frontmatter).properties)
}

/**
 * The same rule on properties already parsed — a note as the index holds it (YAZ-3076 D6, S57): the
 * folder views read each row's switch here, with no read of their own.
 */
export const isReadOnlyProperties = (properties: Readonly<Record<string, unknown>>): boolean => properties[READ_ONLY_KEY] === true

/**
 * The note with the switch on or off, every other byte kept (`setFrontmatterProperty`, S2). Off of
 * a block that held only the switch removes the block too, so a note that had no frontmatter gets
 * its own bytes back (S4). Throws `FrontmatterWriteError` on a block that does not parse.
 */
export function setNoteReadOnly(content: string, on: boolean): string {
  if (on) return isNoteReadOnly(content) ? content : setFrontmatterProperty(content, READ_ONLY_KEY, true)
  const next = setFrontmatterProperty(content, READ_ONLY_KEY, undefined)
  if (next === content) return content
  const { frontmatter, body } = splitFrontmatter(next)
  return frontmatterInterior(frontmatter).trim() === '' ? body : next
}

// ---------- A drawing ----------

/** Whether the scene's `yaseendraw` block says `"readonly": true`. A top-level key of that name is not the switch. */
export function isDrawingReadOnly(scene: Record<string, unknown>): boolean {
  const block = scene[BOARD_META_KEY]
  return isRecord(block) && block[READ_ONLY_KEY] === true
}

/**
 * The scene with the switch on or off; the SAME object when it already is (S11). The block comes
 * back FIRST, where the tree and the save door read it off the file head. A block with no dates gets
 * `bornAt` (the file's mtime) for both, as `guardedStamp` dates a dateless board — without two finite
 * dates the save door would not trust the block, and the next save would drop the switch. Every
 * other key of the block and the scene stays (S5). The switch records `at` as its change time
 * (YAZ-3943 1E: the newest change wins a two-Mac merge), so off keeps the block, with its dates.
 */
export function withDrawingReadOnly(scene: Record<string, unknown>, on: boolean, bornAt: number, at = Date.now()): Record<string, unknown> {
  const { [BOARD_META_KEY]: own, ...rest } = scene
  const held = isRecord(own) && READ_ONLY_KEY in own
  if (on ? isDrawingReadOnly(scene) : !held) return scene
  const { [READ_ONLY_KEY]: _old, createdAt, updatedAt, ...extras } = isRecord(own) ? own : {}
  const dates = { createdAt: isFiniteNumber(createdAt) ? createdAt : bornAt, updatedAt: isFiniteNumber(updatedAt) ? updatedAt : bornAt }
  return { [BOARD_META_KEY]: withSwitchTime({ ...dates, ...extras, ...(on ? { [READ_ONLY_KEY]: true } : {}) }, READ_ONLY_KEY, at), ...rest }
}

// ---------- A diagram ----------

/**
 * A diagram's own "Link preview on hover" OFF (YAZ-4748 D10, a board's `"hoverLinks": false`): `yaseendraw-hoverlinks="0"`
 * on the root `<mxfile>`, by the read-only switch's rules below. No attribute is on.
 */
export const DIAGRAM_HOVER_LINKS_ATTR = 'yaseendraw-hoverlinks'

/** A switch on the root tag: `attr` in either quote style, with the space before it; `one` only with `value`. */
function flagPatterns(attr: string, value: string): { any: RegExp; one: RegExp } {
  return { any: new RegExp(`\\s${attr}\\s*=\\s*(["']).*?\\1`, 'g'), one: new RegExp(`\\s${attr}\\s*=\\s*(["'])${value}\\1`) }
}

const READ_ONLY_FLAG = flagPatterns(DIAGRAM_READ_ONLY_ATTR, '1')
const HOVER_LINKS_OFF_FLAG = flagPatterns(DIAGRAM_HOVER_LINKS_ATTR, '0')

function hasDiagramFlag(xml: string, flag: { one: RegExp }): boolean {
  const tag = mxfileOpenTag(xml)
  return tag !== null && flag.one.test(xml.slice(tag.start, tag.end))
}

/**
 * The diagram with the switch on or off; the SAME string when it already is (S11). On adds the
 * attribute at the END of the root tag, so the dates stay first (YAZ-1802 D7), and off removes
 * exactly those bytes: on then off is the same file (S6). A bare `<mxGraphModel>` is wrapped the
 * way draw.io saves it, then marked (S7). Anything that is not a diagram comes back as it is.
 */
function setDiagramFlag(xml: string, attr: string, value: string, flag: { any: RegExp; one: RegExp }, on: boolean): string {
  const tag = mxfileOpenTag(xml)
  if (tag === null) {
    const wrapped = on ? wrapBareModel(xml) : xml
    return wrapped === xml ? xml : setDiagramFlag(wrapped, attr, value, flag, true)
  }
  if (tag.end === xml.length) return xml
  const open = xml.slice(tag.start, tag.end)
  // `search`, not `test`: `any` is global, and `test` would carry its `lastIndex` into the next call.
  if (on ? flag.one.test(open) : open.search(flag.any) === -1) return xml
  const cleared = open.replace(flag.any, '')
  const marked = !on ? cleared : cleared.endsWith('/') ? `${cleared.slice(0, -1)} ${attr}="${value}"/` : `${cleared} ${attr}="${value}"`
  return `${xml.slice(0, tag.start)}${marked}${xml.slice(tag.end)}`
}

/** Whether the root `<mxfile>` tag carries `yaseendraw-readonly="1"`. A bare `<mxGraphModel>` never does. */
export const isDiagramReadOnly = (xml: string): boolean => hasDiagramFlag(xml, READ_ONLY_FLAG)

/** The diagram read only or not (`setDiagramFlag`'s rules). */
export const setDiagramReadOnly = (xml: string, on: boolean): string => setDiagramFlag(xml, DIAGRAM_READ_ONLY_ATTR, '1', READ_ONLY_FLAG, on)

/** Whether the diagram turned its own "Link preview on hover" off (D10). */
export const isDiagramHoverLinksOff = (xml: string): boolean => hasDiagramFlag(xml, HOVER_LINKS_OFF_FLAG)

/** The diagram's own "Link preview on hover" off or on again (`setDiagramFlag`'s rules: on removes the attribute). */
export const setDiagramHoverLinksOff = (xml: string, off: boolean): string => setDiagramFlag(xml, DIAGRAM_HOVER_LINKS_ATTR, '0', HOVER_LINKS_OFF_FLAG, off)
