/**
 * A reader for Cloudflare's `_headers` file (static assets; YAZ-5087), used by the tests and by the local server
 * (`serve.ts`). Cloudflare's rules: a line that starts at column 0 is a path pattern (`*` is a splat, `:name` one
 * part); an indented `Name: value` line sets a header; an indented `! Name` removes that header that EARLIER rules set.
 * Every rule that matches applies, in file order; a header set by two rules has both values, joined with ", ".
 */

export interface HeaderRule {
  pattern: string
  lines: ({ kind: 'set'; name: string; value: string } | { kind: 'detach'; name: string })[]
}

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), lines: [] })
      continue
    }
    const rule = rules.at(-1)
    if (!rule) throw new Error(`_headers: a header with no path: ${raw}`)
    const line = raw.trim()
    if (line.startsWith('!')) rule.lines.push({ kind: 'detach', name: line.slice(1).trim().toLowerCase() })
    else {
      const colon = line.indexOf(':')
      if (colon < 1) throw new Error(`_headers: not "Name: value": ${raw}`)
      rule.lines.push({ kind: 'set', name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() })
    }
  }
  return rules
}

export function matches(pattern: string, path: string): boolean {
  const re = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+'))
    .join('.*')
  return new RegExp(`^${re}$`).test(path)
}

/** The headers Cloudflare sends for `path` (names in lower case). */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue
    // The detaches of a rule remove what EARLIER rules set; then the rule's own values are added.
    for (const line of rule.lines) if (line.kind === 'detach') delete out[line.name]
    for (const line of rule.lines) if (line.kind === 'set') out[line.name] = out[line.name] === undefined ? line.value : `${out[line.name]}, ${line.value}`
  }
  return out
}

/** A CSP as directive → its values. */
export function cspOf(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) map.set(name.toLowerCase(), values)
  }
  return map
}
