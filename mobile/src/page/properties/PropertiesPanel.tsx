import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DateValue, FileValue, LinkValue, fromYaml, linkText, render, type Resolver, type Value } from '@client/views/expr/values'
import { reservedKeyText, reservedKeys } from '@client/links/reservedKeys'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { isCardMark } from '@shared/cardFileFormat'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { WIKILINK_RE } from '@shared/linkRewrite'
import { TITLE_KEY } from '@shared/pageName'
import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../../search/vaultData'
import { openLink, type LinkDoor } from '../openLink'
import { resolveSourceOf } from '../pageLook'
import './properties.css'

/**
 * A PAGE'S PROPERTIES, READ ONLY (YAZ-5459): the Mac's Properties panel as it shows a read-only page
 * (`FrontmatterPanel.tsx`, `readOnly`), with the Mac's own code for the values:
 *  - ROWS: the page's own fields in the file's order; in a vault with IDs `in` and `title` are no rows (the title is the
 *    page's title, `in` the folders' blocks); a card file's mark (`kind: card`) is no row; `comments` is the page's
 *    comment stream, never a property (the index leaves it out, `indexRecord.ts`).
 *  - The app's own keys (`reservedKeys`: `id`, `also_in`, `readonly`, the page switches …) show their value with a
 *    "Reserved" tag, as the Mac; a value no typed editor holds (a nested map, many lines) shows with a "YAML" tag.
 *  - VALUES (`fromYaml`, `render`, the Mac's cell look): a date as `2026-11-14` (`14:30` with a time), a number as is,
 *    a check box ticked or not (it cannot change), a list as chips, a link as a pill with its page's title that opens the
 *    page (the one link door), a text holding `[[links]]` with each link a pill; `also_in` names each folder by its title.
 *
 * Slides in from the right; a tap outside it, a swipe to the right, ✕ or Escape closes it. Nothing is written.
 */

export interface Row {
  key: string
  raw: unknown
  chip: 'reserved' | 'yaml' | null
}

const isScalar = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
/** The Mac's `isOpaque`: what no typed editor holds. */
function isOpaque(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some((item) => !isScalar(item) || (typeof item === 'string' && item.includes('\n')))
  if (!isScalar(raw)) return !(raw instanceof Date)
  return typeof raw === 'string' && raw.includes('\n')
}

/** The rows of `record`, by the Mac's read-only rules. */
export function propertyRows(record: IndexRecord, ids: boolean): Row[] {
  const reserved = reservedKeys(ids)
  return Object.entries(record.properties)
    .filter(([key, value]) => !isCardMark(key, value) && !(ids && (key === FOLDER_VALUES_KEY || key === TITLE_KEY)))
    .map(([key, raw]) => ({ key, raw, chip: reserved.has(key) ? 'reserved' : isOpaque(raw) ? 'yaml' : null }))
}

const SWIPE_PX = 60

export default function PropertiesPanel({ record, data, door, onClose }: { record: IndexRecord; data: VaultData; door: LinkDoor; onClose: () => void }) {
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // The slide: drawn off the edge first, then in (no slide with Reduce Motion: the CSS says so).
    const frame = requestAnimationFrame(() => setShown(true))
    closeBtn.current?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const open = (path: string) => {
    onClose()
    openLink(door, { kind: 'page', path })
  }
  const rows = propertyRows(record, data.ids)
  return (
    <div className="props" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="props__panel"
        data-shown={shown || undefined}
        role="dialog"
        aria-label="Properties"
        style={drag > 0 ? { transform: `translateX(${drag}px)`, transition: 'none' } : undefined}
        onTouchStart={(e) => (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchMove={(e) => {
          if (start.current === null) return
          const dx = e.touches[0].clientX - start.current.x
          const dy = Math.abs(e.touches[0].clientY - start.current.y)
          if (dx > 0 && dx > dy) setDrag(dx)
        }}
        onTouchEnd={() => {
          const far = drag > SWIPE_PX
          start.current = null
          setDrag(0)
          if (far) onClose()
        }}
      >
        <div className="props__head">
          <h2 className="props__title">Properties</h2>
          <button ref={closeBtn} type="button" className="icon-btn props__close" aria-label="Close properties" onClick={onClose}>
            ✕
          </button>
        </div>
        <PropertyRows rows={rows} data={data} open={open} />
      </aside>
    </div>
  )
}

/**
 * The panel's rows (YAZ-5459), alone: a key and its value each, read only. The card strip's Properties part
 * (`cardStrip/CardStrip.tsx`, YAZ-5508) shows a card's own properties with them, the same rows and look as a page's.
 */
export function PropertyRows({ rows, data, open, className = 'props__rows' }: { rows: readonly Row[]; data: VaultData; open: (path: string) => void; className?: string }) {
  const source = resolveSourceOf(data)
  const resolve: Resolver = (target) => {
    const path = source.resolve?.(target) ?? null
    const found = path === null ? undefined : data.byPath[path]
    return found === undefined ? null : new FileValue(found)
  }
  const folderName = (entry: unknown): unknown => (typeof entry === 'string' ? data.folders.find((f) => f.id !== undefined && f.id.toLowerCase() === entry.toLowerCase())?.title ?? entry : entry)
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.key} className="props__row" data-key={row.key}>
          <dt className="props__key">{row.key}</dt>
          <dd className="props__value">
            <ValueView v={fromYaml(row.key === ALSO_IN_KEY ? (Array.isArray(row.raw) ? row.raw.map(folderName) : folderName(row.raw)) : row.raw)} resolve={resolve} open={open} />
            {row.chip !== null && (
              <span className="props__chip" title={row.chip === 'reserved' ? reservedKeyText(row.key) : 'No typed editor can hold this value'}>
                {row.chip === 'reserved' ? 'Reserved' : 'YAML'}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A card's own properties (off its card line, YAZ-5379) as rows, in the line's order: no app keys, no YAML chips. */
export const cardPropertyRows = (values: Readonly<Record<string, unknown>>): Row[] => Object.entries(values).map(([key, raw]) => ({ key, raw, chip: null }))

/** One value, as the Mac's read-only cell (`cellContent`): a check box, chips, link pills, or its text. */
function ValueView({ v, resolve, open }: { v: Value; resolve: Resolver; open: (path: string) => void }): ReactNode {
  if (typeof v === 'boolean')
    return (
      <span className="props__check" role="img" aria-label={v ? 'Checked' : 'Not checked'} data-checked={v}>
        {v ? '✓' : ''}
      </span>
    )
  if (Array.isArray(v)) return v.map((item, i) => <Chip key={i} v={item} resolve={resolve} open={open} />)
  if (v instanceof LinkValue || v instanceof FileValue) return <Chip v={v} resolve={resolve} open={open} />
  if (typeof v === 'string' && v.includes('[[')) {
    const parts: ReactNode[] = []
    let last = 0
    for (const m of v.matchAll(WIKILINK_RE)) {
      const link = m[1] === '' ? fromYaml(m[0]) : null
      if (!(link instanceof LinkValue)) continue
      parts.push(v.slice(last, m.index), <LinkPill key={m.index} link={link} resolve={resolve} open={open} />)
      last = m.index + m[0].length
    }
    parts.push(v.slice(last))
    return <>{parts}</>
  }
  const text = render(v, resolve)
  return <span className={v instanceof DateValue ? 'props__text props__text--date' : typeof v === 'number' ? 'props__text props__text--number' : 'props__text'}>{text}</span>
}

function Chip({ v, resolve, open }: { v: Value; resolve: Resolver; open: (path: string) => void }) {
  if (v instanceof LinkValue) return <LinkPill link={v} resolve={resolve} open={open} />
  if (v instanceof FileValue)
    return (
      <button type="button" className="wikilink props__pill" onClick={() => open(v.record.path)}>
        {v.record.title ?? v.record.basename}
      </button>
    )
  return <span className="props__chip-value">{render(v, resolve)}</span>
}

/** A link value: the page's pill by its title (the Mac's `LinkChip` on a folder page); a link to nothing reads as missing. */
function LinkPill({ link, resolve, open }: { link: LinkValue; resolve: Resolver; open: (path: string) => void }) {
  const text = linkText(link, resolve)
  const record = resolve(link.target.split('#', 1)[0].split('|', 1)[0].trim())?.record
  if (record === undefined) return <span className="wikilink wikilink--unresolved props__pill">{text}</span>
  return (
    <button type="button" className="wikilink props__pill" onClick={() => open(record.path)}>
      {text}
    </button>
  )
}
