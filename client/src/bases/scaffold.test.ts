/**
 * New-entity scaffolding (Bible B, GRO-2202): the frontmatter scaffold comes from the REGISTRY
 * (never hardcoded types), templates at `.yaseendocs/templates/<type>.md` override key-by-key
 * (`page_type` always forced back), the starter base self-pins to its type, and `createType`
 * is one action: registry entry + `All <plural>.base` at the vault root (idempotent — an
 * existing base file skips silently, never overwrites). `api` mocked like newNote.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegistryTypeDef } from '@shared/types'
import { parseBase } from './baseFile'
import type { FolderPageSettings } from './folderPageSettings'
import { pinnedType } from './relation'
import {
  applyTemplate,
  createType,
  ensureFolder,
  folderPageTemplatePath,
  newEntityParts,
  newPageFromFolderPage,
  readTemplate,
  scaffoldFromFolderPage,
  scaffoldProperties,
  starterBase,
  starterBasePath,
  templatePath,
  typeLabel,
  typePlural,
  usableFolder,
} from './scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    readFile: vi.fn(),
    createFile: vi.fn(),
    createDir: vi.fn(),
    registry: { setType: vi.fn() },
  },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createFile = vi.mocked(api.createFile)
const createDir = vi.mocked(api.createDir)
const setType = vi.mocked(api.registry.setType)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

beforeEach(() => {
  vi.clearAllMocks()
})

/** The R1 example's kpi type. */
const KPI: RegistryTypeDef = {
  displayName: 'KPI',
  pluralName: 'KPIs',
  properties: {
    funnel_stages: { kind: 'multi-link', target: 'funnel-stage' },
    kpi_category: { kind: 'text' },
    unit: { kind: 'text' },
  },
}

describe('scaffoldProperties', () => {
  it('page_type + every declared property, empty: scalar kinds → null, list/multi-link → []', () => {
    expect(
      scaffoldProperties('problem', {
        properties: {
          funnel_stage: { kind: 'link', target: 'funnel-stage' },
          kpis_impacted: { kind: 'multi-link', target: 'kpi', required: true },
          steps: { kind: 'list' },
          due: { kind: 'date' },
          done: { kind: 'checkbox' },
          score: { kind: 'number' },
          sku_tag: { kind: 'text' },
        },
      }),
    ).toEqual({
      page_type: 'problem',
      funnel_stage: null,
      kpis_impacted: [],
      steps: [],
      due: null,
      done: null,
      score: null,
      sku_tag: null,
    })
  })

  it('an empty schema scaffolds page_type alone (a type may have no declared properties, R7)', () => {
    expect(scaffoldProperties('industry', { properties: {} })).toEqual({ page_type: 'industry' })
  })
})

describe('applyTemplate', () => {
  it('no template → scaffold + seed, page_type forced', () => {
    expect(applyTemplate('kpi', KPI, null)).toEqual({
      properties: { page_type: 'kpi', funnel_stages: [], kpi_category: null, unit: null },
      body: '',
    })
  })

  it('template frontmatter overrides key-by-key, page_type ALWAYS forced back; body becomes the page body', () => {
    const template = '---\npage_type: wrong\nkpi_category: leading\nextra: kept\n---\n# Scaffolded\n\nNotes.\n'
    expect(applyTemplate('kpi', KPI, template)).toEqual({
      properties: { page_type: 'kpi', funnel_stages: [], kpi_category: 'leading', unit: null, extra: 'kept' },
      body: '# Scaffolded\n\nNotes.\n',
    })
  })

  it('merge order: registry scaffold ← template ← seed, page_type forced last (5D convergence)', () => {
    const template = '---\nkpi_category: leading\nunit: "%"\n---\n'
    expect(applyTemplate('kpi', KPI, template, { unit: 'days', page_type: 'other' })).toEqual({
      properties: { page_type: 'kpi', funnel_stages: [], kpi_category: 'leading', unit: 'days' },
      body: '',
    })
  })

  it('a template whose frontmatter is not valid YAML contributes body only — the scaffold survives (report-never-block)', () => {
    const template = '---\nkpi_category: [unclosed\n---\nBody survives.\n'
    expect(applyTemplate('kpi', KPI, template)).toEqual({
      properties: { page_type: 'kpi', funnel_stages: [], kpi_category: null, unit: null },
      body: 'Body survives.\n',
    })
  })

  it('a template with no frontmatter contributes body only', () => {
    expect(applyTemplate('industry', { properties: {} }, 'Just prose.\n')).toEqual({
      properties: { page_type: 'industry' },
      body: 'Just prose.\n',
    })
  })
})

describe('readTemplate / newEntityParts', () => {
  it('reads `.yaseendocs/templates/<type>.md`; NOT_FOUND → null (existence = has-template)', async () => {
    expect(templatePath('/v', 'kpi')).toBe('/v/.yaseendocs/templates/kpi.md')
    readFile.mockRejectedValue(notFound())
    expect(await readTemplate('/v', 'kpi')).toBeNull()
    readFile.mockResolvedValue({ path: '/v/.yaseendocs/templates/kpi.md', content: 'T', mtime: 1, size: 1 })
    expect(await readTemplate('/v', 'kpi')).toBe('T')
    expect(readFile).toHaveBeenCalledWith('/v/.yaseendocs/templates/kpi.md')
  })

  it('other read failures propagate', async () => {
    readFile.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(readTemplate('/v', 'kpi')).rejects.toThrow('permission denied')
  })

  it('newEntityParts = template read + merge', async () => {
    readFile.mockResolvedValue({ path: '/v/.yaseendocs/templates/kpi.md', content: '---\nunit: "%"\n---\nBody\n', mtime: 1, size: 1 })
    expect(await newEntityParts('/v', 'kpi', KPI)).toEqual({
      properties: { page_type: 'kpi', funnel_stages: [], kpi_category: null, unit: '%' },
      body: 'Body\n',
    })
  })
})

/** A folder page's declaration — the 2A shape, columns spanning every kind. */
const METRICS: FolderPageSettings = {
  columns: {
    owner: { kind: 'link', target: 'person' },
    kpis: { kind: 'multi-link', target: 'kpi', required: true },
    steps: { kind: 'list' },
    due: { kind: 'date' },
    done: { kind: 'checkbox' },
    score: { kind: 'number' },
    unit: { kind: 'text' },
  },
  views: [{ type: 'outline', name: 'Outline' }],
  problems: [],
}

const EMPTY_COLUMNS = { owner: null, kpis: [], steps: [], due: null, done: null, score: null, unit: null }

describe('scaffoldFromFolderPage (🔒 Q5)', () => {
  it('every declared column empty — list/multi-link → [], scalar kinds → null — and folder_pages LAST', () => {
    const properties = scaffoldFromFolderPage('Metrics', METRICS)
    expect(properties).toEqual({ ...EMPTY_COLUMNS, folder_pages: ['[[Metrics]]'] })
    expect(Object.keys(properties).at(-1)).toBe('folder_pages')
  })

  it('the new page is a NORMAL page: no folder_page flag is ever born here (that is 4B\'s)', () => {
    expect('folder_page' in scaffoldFromFolderPage('Metrics', METRICS)).toBe(false)
  })

  it('a folder page declaring no columns scaffolds the membership alone', () => {
    expect(scaffoldFromFolderPage('Metrics', { columns: {}, views: [], problems: [] })).toEqual({
      folder_pages: ['[[Metrics]]'],
    })
  })
})

describe('folderPageTemplatePath / newPageFromFolderPage (🔒 Q6)', () => {
  it('the template lives beside the type templates; existence = has-template, unchanged', () => {
    expect(folderPageTemplatePath('/v', 'Metrics')).toBe('/v/.yaseendocs/templates/Metrics.md')
    expect(folderPageTemplatePath('/v', 'Meta Ads')).toBe('/v/.yaseendocs/templates/Meta Ads.md')
  })

  it('no template → scaffold + seed, folder_pages still last (a new seed key never displaces it), body \'\'', async () => {
    readFile.mockRejectedValue(notFound())

    const parts = await newPageFromFolderPage('/v', 'Metrics', METRICS, { unit: 'days', spend: 12 })

    expect(readFile).toHaveBeenCalledWith('/v/.yaseendocs/templates/Metrics.md')
    expect(parts).toEqual({
      properties: { ...EMPTY_COLUMNS, unit: 'days', spend: 12, folder_pages: ['[[Metrics]]'] },
      body: '',
    })
    expect(Object.keys(parts.properties).at(-1)).toBe('folder_pages')
  })

  it('merge order: scaffold ← template ← seed; extra template keys survive; folder_pages forced back and last; body verbatim', async () => {
    readFile.mockResolvedValue({
      path: '/v/.yaseendocs/templates/Metrics.md',
      content: '---\nunit: "%"\nscore: 1\nextra: kept\nfolder_pages: ["[[Wrong]]"]\n---\n# Scaffolded\n\nNotes.\n',
      mtime: 1,
      size: 1,
    })

    const parts = await newPageFromFolderPage('/v', 'Metrics', METRICS, { score: 3, folder_pages: ['[[Also wrong]]'] })

    expect(parts).toEqual({
      properties: { ...EMPTY_COLUMNS, unit: '%', score: 3, extra: 'kept', folder_pages: ['[[Metrics]]'] },
      body: '# Scaffolded\n\nNotes.\n',
    })
    expect(Object.keys(parts.properties).at(-1)).toBe('folder_pages')
  })

  it('other read failures propagate', async () => {
    readFile.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(newPageFromFolderPage('/v', 'Metrics', METRICS)).rejects.toThrow('permission denied')
  })
})

describe('names', () => {
  it('label = displayName ?? key; plural = pluralName ?? displayName+s ?? key+s', () => {
    expect(typeLabel('kpi', KPI)).toBe('KPI')
    expect(typeLabel('funnel-stage', { properties: {} })).toBe('funnel-stage')
    expect(typePlural('kpi', KPI)).toBe('KPIs')
    expect(typePlural('industry', { displayName: 'Industry', properties: {} })).toBe('Industrys')
    expect(typePlural('role', { properties: {} })).toBe('roles')
    expect(starterBasePath('/v', 'kpi', KPI)).toBe('/v/All KPIs.base')
  })
})

describe('starterBase', () => {
  it('explicit and-map filter + one table view ordering file.name + declared properties (R5)', () => {
    expect(starterBase('kpi', KPI)).toBe(
      [
        'filters:',
        '  and:',
        '    - page_type == "kpi"',
        'views:',
        '  - type: table',
        '    name: Table',
        '    order:',
        '      - file.name',
        '      - funnel_stages',
        '      - kpi_category',
        '      - unit',
        '',
      ].join('\n'),
    )
  })

  it('parses as a base and self-pins to the type (relation-column-ready)', () => {
    const { def } = parseBase(starterBase('kpi', KPI))
    expect(pinnedType(def, def.views[0])).toBe('kpi')
    expect(def.views[0].order).toEqual(['file.name', 'funnel_stages', 'kpi_category', 'unit'])
  })

  it('an empty schema orders file.name alone', () => {
    const { def } = parseBase(starterBase('industry', { properties: {} }))
    expect(def.views[0].order).toEqual(['file.name'])
  })
})

describe('createType', () => {
  it('one action: registry.setType + starter base at the vault root', async () => {
    setType.mockResolvedValue(undefined)
    createFile.mockResolvedValue({ path: '/v/All KPIs.base', mtime: 1, size: 1 })

    await createType('/v', 'kpi', KPI)

    expect(setType).toHaveBeenCalledWith('/v', 'kpi', KPI)
    expect(createFile).toHaveBeenCalledWith({ path: '/v/All KPIs.base', content: starterBase('kpi', KPI) })
  })

  it('an existing starter base skips silently — never overwritten (idempotent, R5)', async () => {
    setType.mockResolvedValue(undefined)
    createFile.mockRejectedValue(alreadyExists())

    await expect(createType('/v', 'kpi', KPI)).resolves.toBeUndefined()
  })

  it('a failed registry write propagates and creates no base file', async () => {
    setType.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'types.json is unreadable'))

    await expect(createType('/v', 'kpi', KPI)).rejects.toThrow('unreadable')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('usableFolder (GRO-2226: report-don\'t-block at use time)', () => {
  it('passes a stored folder inside the grammar through; absent → null', () => {
    expect(usableFolder({ folder: 'kpis', properties: {} })).toBe('kpis')
    expect(usableFolder({ folder: 'Content Pillars/1. Agentic Agency', properties: {} })).toBe('Content Pillars/1. Agentic Agency')
    expect(usableFolder({ properties: {} })).toBeNull()
  })

  it('a hand-edited folder outside the grammar reads as absent — never a refusal to use the vault', () => {
    for (const bad of ['..', 'a/../b', '/abs', 'C:/x', 'a\\b', 'a\0b', '.yaseendocs/templates', './a', 'a/', '']) {
      expect(usableFolder({ folder: bad, properties: {} })).toBeNull()
    }
  })
})

describe('ensureFolder', () => {
  it('creates each missing level, tolerates existing ones, resolves the absolute dir', async () => {
    createDir.mockRejectedValueOnce(alreadyExists())
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'kpis/growth')).toBe('/v/kpis/growth')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/v/kpis', '/v/kpis/growth'])
  })

  it('other failures propagate', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(ensureFolder('/v', 'kpis')).rejects.toThrow('permission denied')
  })
})
