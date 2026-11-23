import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * YAZ-5303: the live build's hashed files stay on the host for one more deploy. A page of the old version can ask the
 * HOST for one of its chunks during a swap (Chrome sends a request past the worker while it stops the old worker), and
 * Cloudflare no longer has it after a deploy: it answers the app page. So before each publish, the chunks that the live
 * `sw.js` lists and the new build does not have are copied from the live site into `dist/assets/`. Read-only GETs of
 * public files; no account call. Only `.js` and `.css` under `/assets/`, and only with the right type.
 */
export async function keepPrevious(dist: string, site: string, get: (url: string) => Promise<Response> = (url) => fetch(url, { cache: 'no-store' })): Promise<{ kept: string[]; missing: string[] }> {
  const kept: string[] = []
  const missing: string[] = []
  let sw: string
  try {
    const answer = await get(`${site}/sw.js`)
    if (!answer.ok) return { kept, missing }
    sw = await answer.text()
  } catch {
    return { kept, missing } // no live site yet
  }
  const list = /\bfiles:(\[[^\]]*\])/.exec(sw)?.[1]
  if (!list) return { kept, missing } // a kill switch, or another worker: no list
  for (const path of JSON.parse(list) as string[]) {
    const kind = /^\/assets\/[\w.-]+\.(js|css)$/.exec(path)?.[1]
    if (!kind || existsSync(join(dist, path))) continue
    const answer = await get(`${site}${path}`).catch(() => null)
    const type = answer?.headers.get('content-type') ?? ''
    if (!answer?.ok || !(kind === 'js' ? /javascript/ : /text\/css/).test(type)) {
      missing.push(path)
      continue
    }
    writeFileSync(join(dist, path), Buffer.from(await answer.arrayBuffer()))
    kept.push(path)
  }
  return { kept, missing }
}

/** The site of `wrangler.jsonc` (its one custom domain). */
export function siteOf(wranglerJsonc: string): string {
  const config = JSON.parse(readFileSync(wranglerJsonc, 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { routes: { pattern: string }[] }
  return `https://${config.routes[0].pattern}`
}
