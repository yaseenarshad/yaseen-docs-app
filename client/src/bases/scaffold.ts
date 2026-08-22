import type { RegistryTypeDef } from '@shared/types'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api, BridgeRequestError } from '../api'
import { registry } from './useRegistry'

/**
 * New-entity scaffolding (Bible B, GRO-2202; rulings R3/R5/R8 of the GRO-2200 scope pass).
 *
 * The frontmatter scaffold is generated FROM THE REGISTRY — never hardcoded types: `page_type`
 * plus every declared property, empty (scalar kinds → YAML null, printed `key:`; `list` and
 * `multi-link` → `[]`), so a new page lands in the "No value" groups by design. Templates are
 * opt-in files at `.yaseendocs/templates/<type>.md` (existence = has-template, Round 9 Q3 —
 * type creation never scaffolds one): their frontmatter values override the scaffold key-by-key
 * — `page_type` ALWAYS forced back to the type — and their body becomes the page body.
 *
 * Creating a type through the app is ONE action (`createType`, Round 9 record): registry entry
 * + starter `All <pluralName>.base` at the vault root (Q2, LOCKED for v1 — revisit is GRO-2220),
 * idempotent: an existing base file is skipped silently, never overwritten.
 */

/** `page_type` + every declared property, empty (R3). */
export function scaffoldProperties(type: string, def: RegistryTypeDef): Record<string, unknown> {
  const properties: Record<string, unknown> = { page_type: type }
  for (const [name, p] of Object.entries(def.properties)) {
    properties[name] = p.kind === 'list' || p.kind === 'multi-link' ? [] : null
  }
  return properties
}

/** Where a type's template lives; existence = has-template (R3). */
export function templatePath(root: string, type: string): string {
  return `${root}/.yaseendocs/templates/${type}.md`
}

/**
 * The template's whole file content, or null when the type has none. Read over the ordinary
 * `readFile` bridge — the sanctioned path for markdown at any absolute path (no jail; the
 * dotfolder is invisible to tree/index/watcher, not to direct reads); vaultConfig is JSON-only.
 */
export async function readTemplate(root: string, type: string): Promise<string | null> {
  try {
    return (await api.readFile(templatePath(root, type))).content
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
    throw err
  }
}

export interface EntityParts {
  /** Frontmatter for the new page, `page_type` first. */
  properties: Record<string, unknown>
  /** Page body (the template's body; '' without one). */
  body: string
}

/**
 * Pure merge: registry scaffold ← template frontmatter ← seed values (5D's filter-derived
 * pre-fill), `page_type` forced last (R3/R8). Template keys outside the schema are kept —
 * frontmatter is source of truth, the registry never gates content.
 */
export function applyTemplate(type: string, def: RegistryTypeDef, template: string | null, seed: Record<string, unknown> = {}): EntityParts {
  const scaffold = scaffoldProperties(type, def)
  if (template === null) return { properties: { ...scaffold, ...seed, page_type: type }, body: '' }
  const { frontmatter, body } = splitFrontmatter(template)
  return { properties: { ...scaffold, ...parseFrontmatter(frontmatter).properties, ...seed, page_type: type }, body }
}

/** Template read + merge — what every new-entity surface (sidebar New ▸, 5D New) consumes. */
export async function newEntityParts(root: string, type: string, def: RegistryTypeDef, seed: Record<string, unknown> = {}): Promise<EntityParts> {
  return applyTemplate(type, def, await readTemplate(root, type), seed)
}

/** UI label for a type: explicit `displayName`, else the key (R1.3). */
export function typeLabel(name: string, def: RegistryTypeDef): string {
  return def.displayName ?? name
}

/** Plural: explicit `pluralName`, else label + 's' (the field exists precisely because "Industrys" is wrong). */
export function typePlural(name: string, def: RegistryTypeDef): string {
  return def.pluralName ?? `${typeLabel(name, def)}s`
}

/** `All <pluralName>.base` at the vault root (Round 9 Q2, LOCKED for v1; revisit tracked as GRO-2220). */
export function starterBasePath(root: string, name: string, def: RegistryTypeDef): string {
  return `${root}/All ${typePlural(name, def)}.base`
}

/**
 * Starter base content (R5): the explicit and-map filter form — exactly what the filter builder
 * writes and reads back, so the base self-pins to the type (relation-column-ready) — and one
 * table view ordering `file.name` + the declared properties in declaration order. Generated
 * once; a normal user file afterwards (never regenerated or synced). Type and property names
 * are grammar-constrained at the registry boundary, so no YAML escaping is ever needed here.
 */
export function starterBase(name: string, def: RegistryTypeDef): string {
  const order = ['file.name', ...Object.keys(def.properties)]
  return [
    'filters:',
    '  and:',
    `    - page_type == "${name}"`,
    'views:',
    '  - type: table',
    '    name: Table',
    '    order:',
    ...order.map((key) => `      - ${key}`),
    '',
  ].join('\n')
}

/**
 * The "New type…" action (R5, Round 9 record): registry entry + starter base, one action.
 * Base creation is `wx` (never overwrites); ALREADY_EXISTS skips silently — re-creating a
 * type never clobbers the user's base. Implicit registrations (relation columns, hand edits)
 * never come through here, so they never spawn files.
 */
export async function createType(root: string, name: string, def: RegistryTypeDef): Promise<void> {
  await registry.setType(root, name, def)
  try {
    await api.createFile({ path: starterBasePath(root, name, def), content: starterBase(name, def) })
  } catch (err) {
    if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
  }
}

/** Create `<root>/<folder>` level by level (existing levels tolerated); resolves the absolute dir. */
export async function ensureFolder(root: string, folder: string): Promise<string> {
  let dir = root
  for (const segment of folder.split('/').filter((s) => s !== '')) {
    dir = `${dir}/${segment}`
    try {
      await api.createDir(dir)
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  return dir
}
