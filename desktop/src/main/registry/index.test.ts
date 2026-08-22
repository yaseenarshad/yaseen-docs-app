import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { RegistryResponse } from '@shared/types'
import { failure, until } from '../fs/testFixture'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { getRegistry, removeProperty, removeType, setProperty, setType, subscribeRegistry } from './index'

const roots: string[] = []
const offs: Array<() => void> = []
afterEach(async () => {
  offs.splice(0).forEach((off) => off())
  await until(() => activeConfigWatcherRoots().length === 0)
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-registry-'))
  roots.push(root)
  return root
}

const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, 'types.json')

async function seed(root: string, content: unknown): Promise<void> {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
}

const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))

describe('getRegistry', () => {
  it('absent file → empty registry with no error, and NEVER creates .yaseendocs (lazy, LOCKED)', async () => {
    const root = await makeRoot()
    expect(await getRegistry(root)).toEqual({ root, version: 1, types: {}, properties: {} })
    expect(await readdir(root)).toEqual([])
  })

  it('parses a valid v1 file: types, vault-wide properties, optional fields', async () => {
    const root = await makeRoot()
    await seed(root, {
      version: 1,
      types: {
        kpi: {
          displayName: 'KPI',
          pluralName: 'KPIs',
          folder: 'kpis',
          properties: { funnel_stages: { kind: 'multi-link', target: 'funnel-stage', required: true }, unit: { kind: 'text' } },
        },
        industry: { properties: {} },
      },
      properties: { related: { kind: 'multi-link' } },
    })
    const reg = await getRegistry(root)
    expect(reg.error).toBeUndefined()
    expect(reg.version).toBe(1)
    expect(reg.types.kpi).toEqual({
      displayName: 'KPI',
      pluralName: 'KPIs',
      folder: 'kpis',
      properties: { funnel_stages: { kind: 'multi-link', target: 'funnel-stage', required: true }, unit: { kind: 'text' } },
    })
    expect(reg.types.industry).toEqual({ properties: {} })
    expect(reg.properties).toEqual({ related: { kind: 'multi-link' } })
  })

  it('an unknown property kind reads as text (forward compat); the file keeps the original string', async () => {
    const root = await makeRoot()
    await seed(root, { version: 1, types: { kpi: { properties: { due: { kind: 'datetime' } } } } })
    const reg = await getRegistry(root)
    expect(reg.types.kpi?.properties.due).toEqual({ kind: 'text' })
    expect(((await onDisk(root)) as { types: { kpi: { properties: { due: { kind: string } } } } }).types.kpi.properties.due.kind).toBe('datetime')
  })

  it('corrupt JSON / non-object root / missing or non-numeric version → empty registry + error string', async () => {
    const root = await makeRoot()
    await seed(root, '{not json')
    let reg = await getRegistry(root)
    expect(reg.types).toEqual({})
    expect(reg.properties).toEqual({})
    expect(reg.error).toBeTruthy()
    await seed(root, [1, 2])
    reg = await getRegistry(root)
    expect(reg.error).toBeTruthy()
    await seed(root, { types: {} }) // no version at all
    reg = await getRegistry(root)
    expect(reg.error).toBeTruthy()
    await seed(root, { version: '1', types: {} }) // non-numeric version
    reg = await getRegistry(root)
    expect(reg.error).toBeTruthy()
  })

  it('version > 1 reads best-effort with NO error and reports the file version', async () => {
    const root = await makeRoot()
    await seed(root, { version: 2, types: { kpi: { properties: { unit: { kind: 'text' } } } }, future_section: true })
    const reg = await getRegistry(root)
    expect(reg.error).toBeUndefined()
    expect(reg.version).toBe(2)
    expect(reg.types.kpi?.properties.unit).toEqual({ kind: 'text' })
  })

  it('root missing / not a dir / relative → NOT_FOUND / NOT_A_DIRECTORY / NOT_ABSOLUTE', async () => {
    const root = await makeRoot()
    expect((await failure(getRegistry(path.join(root, 'gone')))).code).toBe('NOT_FOUND')
    await writeFile(path.join(root, 'a-file'), 'x')
    expect((await failure(getRegistry(path.join(root, 'a-file')))).code).toBe('NOT_A_DIRECTORY')
    expect((await failure(getRegistry('rel'))).code).toBe('NOT_ABSOLUTE')
  })
})

describe('setType', () => {
  it('the first mutation lazily creates .yaseendocs/types.json with a version-1 skeleton', async () => {
    const root = await makeRoot()
    await setType(root, 'kpi', { displayName: 'KPI', properties: { unit: { kind: 'text' } } })
    expect(await onDisk(root)).toEqual({ version: 1, types: { kpi: { properties: { unit: { kind: 'text' } }, displayName: 'KPI' } }, properties: {} })
    expect((await getRegistry(root)).types.kpi?.displayName).toBe('KPI')
  })

  it('merges: absent fields keep stored values; properties replaces whole-map only when given', async () => {
    const root = await makeRoot()
    await setType(root, 'kpi', { displayName: 'KPI', properties: { unit: { kind: 'text' }, related: { kind: 'multi-link' } } })
    await setType(root, 'kpi', { pluralName: 'KPIs' })
    let reg = await getRegistry(root)
    expect(reg.types.kpi?.displayName).toBe('KPI') // kept
    expect(reg.types.kpi?.pluralName).toBe('KPIs')
    expect(Object.keys(reg.types.kpi?.properties ?? {})).toEqual(['unit', 'related']) // untouched
    await setType(root, 'kpi', { properties: { unit: { kind: 'number' } } })
    reg = await getRegistry(root)
    expect(reg.types.kpi?.properties).toEqual({ unit: { kind: 'number' } }) // whole-map replace
    expect(reg.types.kpi?.displayName).toBe('KPI')
  })

  it('rejects bad type names (grammar ^[a-z][a-z0-9-]*$) and writes nothing', async () => {
    const root = await makeRoot()
    for (const bad of ['KPI', 'kpi_x', '9kpi', 'kpi space', '', '-kpi', 'käpi']) {
      expect((await failure(setType(root, bad, {}))).code).toBe('BAD_REQUEST')
    }
    expect((await failure(setType(root, 42 as never, {}))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([]) // no dotfolder from rejected mutations
  })

  it('rejects wrong-typed fields, bad property names/defs inside properties, and page_type', async () => {
    const root = await makeRoot()
    expect((await failure(setType(root, 'kpi', { displayName: 5 as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setType(root, 'kpi', { folder: null as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setType(root, 'kpi', { properties: { 'Bad Name': { kind: 'text' } } }))).code).toBe('BAD_REQUEST')
    expect((await failure(setType(root, 'kpi', { properties: { page_type: { kind: 'text' } } }))).code).toBe('BAD_REQUEST')
    expect((await failure(setType(root, 'kpi', { properties: { unit: { kind: 'nope' as never } } }))).code).toBe('BAD_REQUEST')
    expect((await failure(setType(root, 'kpi', 'not an object' as never))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([])
  })

  it("rejects a 'folder' outside the grammar — '..', absolute, drive-like, backslash, NUL, dot-segments, empty — and writes nothing (GRO-2226 fold-in)", async () => {
    const root = await makeRoot()
    for (const bad of ['..', 'a/../b', '/abs', 'C:', 'C:/x', 'c:\\x', 'a\\b', 'a\0b', '.yaseendocs/templates', './a', 'a/', 'a//b', '']) {
      expect((await failure(setType(root, 'kpi', { folder: bad }))).code).toBe('BAD_REQUEST')
    }
    expect(await readdir(root)).toEqual([]) // no dotfolder from rejected mutations
  })

  it("accepts nested root-relative folders (spaces and mid-segment dots included) and round-trips them into types.json", async () => {
    const root = await makeRoot()
    await setType(root, 'kpi', { folder: 'Content Pillars/1. Agentic Agency' })
    expect((await getRegistry(root)).types.kpi?.folder).toBe('Content Pillars/1. Agentic Agency')
  })

  it("a STORED folder outside the grammar still reads (report-don't-block — use sites treat it as absent, GRO-2226)", async () => {
    const root = await makeRoot()
    await seed(root, { version: 1, types: { kpi: { folder: '../outside', properties: {} } } })
    const reg = await getRegistry(root)
    expect(reg.error).toBeUndefined()
    expect(reg.types.kpi?.folder).toBe('../outside')
  })

  it('ignores unknown keys in the incoming def (they never reach disk)', async () => {
    const root = await makeRoot()
    await setType(root, 'kpi', { displayName: 'KPI', future: true } as never)
    expect(((await onDisk(root)) as { types: { kpi: Record<string, unknown> } }).types.kpi.future).toBeUndefined()
  })
})

describe('removeType', () => {
  it('removes a type; an unknown type is a no-op that creates nothing', async () => {
    const root = await makeRoot()
    await removeType(root, 'ghost') // absent file: no-op, no creation
    expect(await readdir(root)).toEqual([])
    await setType(root, 'kpi', {})
    await setType(root, 'role', {})
    await removeType(root, 'kpi')
    const reg = await getRegistry(root)
    expect(Object.keys(reg.types)).toEqual(['role'])
  })
})

describe('setProperty', () => {
  it("scope 'vault' writes the top-level map; scope { type } writes the type's schema, creating the type entry on demand", async () => {
    const root = await makeRoot()
    await setProperty(root, 'vault', 'related', { kind: 'multi-link' })
    await setProperty(root, { type: 'kpi' }, 'funnel_stages', { kind: 'multi-link', target: 'funnel-stage' })
    const reg = await getRegistry(root)
    expect(reg.properties).toEqual({ related: { kind: 'multi-link' } })
    expect(reg.types.kpi).toEqual({ properties: { funnel_stages: { kind: 'multi-link', target: 'funnel-stage' } } })
  })

  it('rejects bad property names (grammar ^[a-z][a-z0-9_]*$) and page_type (the identity, never declared)', async () => {
    const root = await makeRoot()
    for (const bad of ['Foo', 'foo-bar', '1x', '', 'füü']) {
      expect((await failure(setProperty(root, 'vault', bad, { kind: 'text' }))).code).toBe('BAD_REQUEST')
    }
    expect((await failure(setProperty(root, 'vault', 'page_type', { kind: 'text' }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, { type: 'kpi' }, 'page_type', { kind: 'link' }))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects bad defs (kind outside the enum, wrong-typed target/required) and bad scopes', async () => {
    const root = await makeRoot()
    expect((await failure(setProperty(root, 'vault', 'a', { kind: 'datetime' as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'vault', 'a', { kind: 'link', target: 7 as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'vault', 'a', { kind: 'text', required: 'yes' as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'vault', 'a', null as never))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'everywhere' as never, 'a', { kind: 'text' }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, { type: 'Bad Type' }, 'a', { kind: 'text' }))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([])
  })
})

describe('removeProperty', () => {
  it('removes from either scope; unknown property or type is a no-op', async () => {
    const root = await makeRoot()
    await setProperty(root, 'vault', 'related', { kind: 'multi-link' })
    await setProperty(root, { type: 'kpi' }, 'unit', { kind: 'text' })
    await removeProperty(root, 'vault', 'related')
    await removeProperty(root, { type: 'kpi' }, 'unit')
    await removeProperty(root, { type: 'ghost' }, 'unit') // no-op
    await removeProperty(root, 'vault', 'ghost_prop') // no-op
    const reg = await getRegistry(root)
    expect(reg.properties).toEqual({})
    expect(reg.types.kpi?.properties).toEqual({})
  })
})

describe('corrupt and newer-version files (R2.5)', () => {
  it('every mutation on a corrupt file rejects INVALID_CONFIG; the bytes are never touched or moved aside', async () => {
    const root = await makeRoot()
    await seed(root, '{broken json')
    expect((await failure(setType(root, 'kpi', {}))).code).toBe('INVALID_CONFIG')
    expect((await failure(removeType(root, 'kpi'))).code).toBe('INVALID_CONFIG')
    expect((await failure(setProperty(root, 'vault', 'a', { kind: 'text' }))).code).toBe('INVALID_CONFIG')
    expect((await failure(removeProperty(root, 'vault', 'a'))).code).toBe('INVALID_CONFIG')
    expect(await readFile(file(root), 'utf8')).toBe('{broken json') // byte-identical, no move-aside
    expect(await readdir(path.join(root, VAULT_CONFIG_DIR))).toEqual(['types.json'])
  })

  it('a version > 1 file rejects mutations with INVALID_CONFIG and stays untouched', async () => {
    const root = await makeRoot()
    await seed(root, { version: 2, types: {} })
    expect((await failure(setType(root, 'kpi', {}))).code).toBe('INVALID_CONFIG')
    expect((await failure(setProperty(root, 'vault', 'a', { kind: 'text' }))).code).toBe('INVALID_CONFIG')
    expect(await onDisk(root)).toEqual({ version: 2, types: {} })
  })

  it('mutations on a missing root reject NOT_FOUND and never create it', async () => {
    const root = await makeRoot()
    const gone = path.join(root, 'gone')
    expect((await failure(setType(gone, 'kpi', {}))).code).toBe('NOT_FOUND')
    expect(await readdir(root)).toEqual([])
  })
})

describe('unknown-field preservation (GRO-2201 acceptance: external round-trip without data loss)', () => {
  it('a mutation keeps unknown fields at top level, type level, and property level', async () => {
    const root = await makeRoot()
    await seed(root, {
      version: 1,
      future_top: { keep: 'me' },
      types: {
        kpi: {
          displayName: 'KPI',
          future_type: 42,
          properties: {
            unit: { kind: 'text', future_prop: true },
          },
        },
      },
      properties: { related: { kind: 'multi-link', future_vault_prop: [1, 2] } },
    })
    await setProperty(root, { type: 'kpi' }, 'funnel_stages', { kind: 'multi-link', target: 'funnel-stage' })
    const disk = (await onDisk(root)) as {
      version: number
      future_top: unknown
      types: { kpi: { displayName: string; future_type: unknown; properties: Record<string, Record<string, unknown>> } }
      properties: Record<string, Record<string, unknown>>
    }
    expect(disk.future_top).toEqual({ keep: 'me' }) // top level
    expect(disk.types.kpi.future_type).toBe(42) // type level
    expect(disk.types.kpi.properties.unit).toEqual({ kind: 'text', future_prop: true }) // property level (sibling untouched)
    expect(disk.properties.related).toEqual({ kind: 'multi-link', future_vault_prop: [1, 2] })
    expect(disk.types.kpi.properties.funnel_stages).toEqual({ kind: 'multi-link', target: 'funnel-stage' })
    expect(disk.types.kpi.displayName).toBe('KPI')
  })

  it('setType merge keeps unknown type-level fields; only named keys change', async () => {
    const root = await makeRoot()
    await seed(root, { version: 1, types: { kpi: { future_type: 'x', properties: { unit: { kind: 'text' } } } } })
    await setType(root, 'kpi', { displayName: 'KPI' })
    const disk = (await onDisk(root)) as { types: { kpi: Record<string, unknown> } }
    expect(disk.types.kpi.future_type).toBe('x')
    expect(disk.types.kpi.displayName).toBe('KPI')
    expect(disk.types.kpi.properties).toEqual({ unit: { kind: 'text' } })
  })
})

describe('write ordering', () => {
  it('two mutations fired concurrently both land (the read-modify-write is serialised per root)', async () => {
    const root = await makeRoot()
    await Promise.all([
      setProperty(root, 'vault', 'first', { kind: 'text' }),
      setProperty(root, 'vault', 'second', { kind: 'number' }),
      setType(root, 'kpi', { displayName: 'KPI' }),
    ])
    const reg = await getRegistry(root)
    expect(reg.properties).toEqual({ first: { kind: 'text' }, second: { kind: 'number' } })
    expect(reg.types.kpi?.displayName).toBe('KPI')
  })
})

describe('subscribeRegistry', () => {
  const collect = (root: string): RegistryResponse[] => {
    const seen: RegistryResponse[] = []
    offs.push(subscribeRegistry(root, (reg) => seen.push(reg)))
    return seen
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('an own mutation notifies with the freshly-read registry', async () => {
    const root = await makeRoot()
    const seen = collect(root)
    await sleep(200) // let the watcher settle
    await setProperty(root, 'vault', 'related', { kind: 'multi-link' })
    await until(() => seen.length >= 1)
    const last = seen[seen.length - 1]
    expect(last?.root).toBe(root)
    expect(last?.properties).toEqual({ related: { kind: 'multi-link' } })
  })

  it('an external edit to types.json notifies with the parsed registry; other config files never do', async () => {
    const root = await makeRoot()
    await setProperty(root, 'vault', 'related', { kind: 'multi-link' })
    const seen = collect(root)
    await sleep(300) // let the watcher finish its initial scan
    await writeFile(file(root), `${JSON.stringify({ version: 1, types: { kpi: { properties: {} } } }, null, 2)}\n`)
    await until(() => seen.length >= 1)
    expect(seen[seen.length - 1]?.types.kpi).toEqual({ properties: {} })
    const count = seen.length
    await writeFile(path.join(root, VAULT_CONFIG_DIR, 'view.json'), '{"open":true}')
    await sleep(500)
    expect(seen.length).toBe(count) // view.json is not the registry
  })

  it('an external edit that corrupts the file notifies an errored, empty registry (live repair loop)', async () => {
    const root = await makeRoot()
    await setProperty(root, 'vault', 'related', { kind: 'multi-link' })
    const seen = collect(root)
    await sleep(300)
    await writeFile(file(root), '{broken')
    await until(() => seen.length >= 1 && seen[seen.length - 1]?.error !== undefined)
    expect(seen[seen.length - 1]?.types).toEqual({})
  })
})
