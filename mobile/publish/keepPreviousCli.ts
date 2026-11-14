import { keepPrevious, siteOf } from './keepPrevious'

/** `npm run mobile:keep-previous` (part of the publish; YAZ-5303): the live chunks stay on the host for one more deploy. */
const mobile = new URL('..', import.meta.url).pathname
const site = siteOf(`${mobile}wrangler.jsonc`)
const { kept, missing } = await keepPrevious(`${mobile}dist`, site)
console.log(`keep-previous: ${kept.length} chunks of the live build at ${site} kept in dist/assets${missing.length ? `; ${missing.length} not found there` : ''}`)
