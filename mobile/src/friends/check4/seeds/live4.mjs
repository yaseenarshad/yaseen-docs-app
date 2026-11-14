// CHECKER round 4 (YAZ-5083): the v2 list SHAPE on real GitHub. Secret test gists, made-up data, description
// "notecards-test ...", at most 25 gist writes, every gist deleted at the end and checked with a list call.
// The token is read from the env file inside this process and never printed or written.
import { readFileSync } from 'node:fs'

const envText = readFileSync('/Users/yasin/Desktop/mochi github app.env', 'utf8')
const TOKEN = (envText.match(/github_pat_[A-Za-z0-9_]+/) ?? [])[0]
if (!TOKEN) throw new Error('no token')
const API = 'https://api.github.com'
let writes = 0
const MAX_WRITES = 25
const made = []
const out = []
const log = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  out.push(line)
  console.log(line.replaceAll(TOKEN, '<token>'))
}

async function gh(method, path, body) {
  if (method !== 'GET') {
    if (++writes > MAX_WRITES) throw new Error('write budget')
  }
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'notecards-test-checker', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* */
  }
  return { status: res.status, json, headers: Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-ratelimit') || k === 'date' || k === 'etag')) }
}
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const fakeId = () => hex(32)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function create(desc, files) {
  const r = await gh('POST', '/gists', { description: `notecards-test ${desc}`, public: false, files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c }])) })
  if (r.status !== 201) throw new Error(`create ${desc}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`)
  made.push(r.json.id)
  return r.json
}
const patch = (id, files) => gh('PATCH', `/gists/${id}`, { files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, c === null ? null : { content: c }])) })
const read = (id) => gh('GET', `/gists/${id}`)
const names = (g) => Object.keys(g?.files ?? {})

try {
  // ---- 1. A v2 list with 40 entry files: read it back whole ----
  const listFiles = { 'notecards-friends.json': JSON.stringify({ v: 2, nickname: null, vaults: ['test/vault'] }) }
  const entries = []
  for (let i = 0; i < 40; i++) {
    const mine = fakeId()
    entries.push(mine)
    listFiles[`notecards-friends.f.${mine}.json`] = JSON.stringify({ v: 1, name: `Test friend ${i}`, theirs: fakeId() })
  }
  const L = await create('list-40', listFiles)
  const r1 = await read(L.id)
  const g1 = r1.json
  const truncFiles = Object.values(g1.files).filter((f) => f.truncated).length
  const fullContent = Object.entries(g1.files).every(([n, f]) => f.content === listFiles[n])
  log('1 list of 41 files: read', r1.status, 'files', names(g1).length, 'gist.truncated', g1.truncated, 'files truncated', truncFiles, 'all contents equal', fullContent)

  // ---- 2. A gist with 305 files: the listing limit ----
  try {
  const big = {}
  for (let i = 0; i < 305; i++) big[`notecards-friends.x.${fakeId()}-t${i.toString(36)}.json`] = JSON.stringify({ v: 1, kinds: ['friend'], rekey: true, at: '' })
  big['notecards-friends.json'] = JSON.stringify({ v: 2, nickname: null, vaults: [] })
  big['notecards-friends.n.0-' + fakeId() + '.json'] = '{"v":1}'
  const B = await create('list-307', big)
  const rb = await read(B.id)
  const nb = names(rb.json)
  const sorted = [...nb].sort()
  const missingHead = !nb.includes('notecards-friends.json')
  const missingGen = !nb.some((n) => n.startsWith('notecards-friends.n.'))
  log('2 gist of 307 files: read', rb.status, 'files returned', nb.length, 'gist.truncated', rb.json.truncated, 'head present', !missingHead, 'generation present', !missingGen, 'returned in name order', JSON.stringify(nb) === JSON.stringify(sorted))
  const listed = await gh('GET', '/gists?per_page=10')
  const item = (listed.json ?? []).find((g) => g.id === B.id)
  log('2b list item of the 307-file gist: files named', item ? Object.keys(item.files).length : 'not in first page', 'truncated field', item?.truncated)

  } catch (err) {
    log('2 ERROR', String(err?.message ?? err).slice(0, 300))
  }

  // ---- 3. Two PATCHes at the same moment, on DIFFERENT files (two rounds) ----
  for (let round = 0; round < 2; round++) {
    const [a, b] = await Promise.all([patch(L.id, { [`notecards-friends.s.${fakeId()}.json`]: `{"v":1,"at":"r${round}a"}` }), patch(L.id, { [`notecards-friends.s.${fakeId()}.json`]: `{"v":1,"at":"r${round}b"}` })])
    const after = await read(L.id)
    const got = names(after.json).filter((n) => n.includes('.s.')).length
    log(`3.${round} two PATCHes, different files:`, a.status, b.status, a.status === 409 || b.status === 409 ? `409 body ${JSON.stringify((a.status === 409 ? a : b).json)}` : '', 'shared files now', got)
    await sleep(1500)
  }

  // ---- 4. Two PATCHes at the same moment on the SAME file ----
  const target = `notecards-friends.f.${entries[0]}.json`
  const [c, d] = await Promise.all([patch(L.id, { [target]: '{"v":1,"name":"WRITER-C","theirs":"aaaa"}' }), patch(L.id, { [target]: '{"v":1,"name":"WRITER-D","theirs":"bbbb"}' })])
  const afterSame = await read(L.id)
  log('4 two PATCHes, same file:', c.status, d.status, 'file now', afterSame.json.files[target]?.content)
  await sleep(1500)

  // ---- 5. A PATCH that deletes a file while another adds one ----
  const gone = `notecards-friends.f.${entries[1]}.json`
  const added = `notecards-friends.x.${entries[1]}-fr${hex(6)}.json`
  const [e, f] = await Promise.all([patch(L.id, { [gone]: null }), patch(L.id, { [added]: '{"v":1,"kinds":["friend"],"rekey":true,"at":""}' })])
  const after5 = await read(L.id)
  log('5 delete one file || add another:', e.status, f.status, 'deleted file gone', !(gone in after5.json.files), 'new file there', added in after5.json.files)
  await sleep(1500)

  // ---- 6. A PATCH that deletes a file that is not there (two devices finish one remove) ----
  const r6 = await patch(L.id, { [gone]: null })
  log('6 delete a file that is already gone:', r6.status, r6.status >= 400 ? JSON.stringify(r6.json).slice(0, 300) : '')
  const extra = `notecards-friends.d.${fakeId()}.json`
  const r6b = await patch(L.id, { [gone]: null, [extra]: '{"v":1}' })
  const after6 = await read(L.id)
  log('6b same delete together with a new file:', r6b.status, 'new file there', extra in after6.json.files, r6b.status >= 400 ? JSON.stringify(r6b.json).slice(0, 300) : '')
  await sleep(1500)

  // ---- 7. A read during a multi-file write: all-old or all-new? ----
  const k1 = `notecards-friends.f.${entries[2]}.json`
  const k2 = `notecards-friends.f.${entries[3]}.json`
  const k3 = `notecards-friends.f.${entries[4]}.json`
  const reads = []
  const w = patch(L.id, { [k1]: '{"v":1,"name":"NEW","theirs":"cccc"}', [k2]: '{"v":1,"name":"NEW","theirs":"cccc"}', [k3]: '{"v":1,"name":"NEW","theirs":"cccc"}' })
  for (let i = 0; i < 4; i++) {
    reads.push(read(L.id))
    await sleep(120)
  }
  const wr = await w
  const views = (await Promise.all(reads)).map((r) => [k1, k2, k3].map((k) => (r.json.files[k]?.content?.includes('NEW') ? 'N' : 'o')).join(''))
  log('7 reads during a 3-file PATCH:', wr.status, 'views', views.join(' '), 'mixed', views.some((v) => v !== 'NNN' && v !== 'ooo'))
  await sleep(1500)

  // ---- 8. A pointer: its revisions, then the remove (delete); what a removed friend with only its ID sees ----
  const statsId = fakeId()
  const P = await create('pointer', { 'notecards-pointer.json': JSON.stringify({ v: 1, stats: statsId, reads: fakeId() }) })
  const newStats = fakeId()
  const p8 = await patch(P.id, { 'notecards-pointer.json': JSON.stringify({ v: 1, stats: newStats, reads: P.files['notecards-pointer.json'].content.match(/"reads":"([0-9a-f]+)"/)[1] }) })
  const commits = await gh('GET', `/gists/${P.id}/commits`)
  const revTexts = []
  for (const cmt of commits.json ?? []) {
    const rv = await gh('GET', `/gists/${P.id}/${cmt.version}`)
    revTexts.push(Object.values(rv.json?.files ?? {}).map((x) => x.content).join('\n'))
  }
  const namesList = revTexts.some((t) => t.includes(L.id))
  log('8 pointer: PATCH', p8.status, 'revisions', commits.status, (commits.json ?? []).length, 'any revision names the list gist ID', namesList, 'IDs in revisions', revTexts.map((t) => (t.match(/[0-9a-f]{32}/g) ?? []).length).join(','))
  const ver = commits.json?.[1]?.version
  const del = await gh('DELETE', `/gists/${P.id}`)
  made.splice(made.indexOf(P.id), 1)
  await sleep(2000)
  const after8 = await read(P.id)
  const commits8 = await gh('GET', `/gists/${P.id}/commits`)
  const old8 = ver ? await gh('GET', `/gists/${P.id}/${ver}`) : { status: 'n/a' }
  // Without a token too (a friend's app reads with its own token, a person by hand may not).
  const anon = await fetch(`${API}/gists/${P.id}`, { headers: { 'User-Agent': 'notecards-test-checker' } })
  log('8b after the delete: read', after8.status, 'commits', commits8.status, 'old revision', old8.status, 'read with no token', anon.status, 'delete', del.status)

  // ---- 9. The list gist's own revision history (only its owner knows the ID) ----
  const lc = await gh('GET', `/gists/${L.id}/commits?per_page=100`)
  log('9 list revisions', lc.status, (lc.json ?? []).length)
} catch (err) {
  log('ERROR', String(err?.message ?? err))
} finally {
  for (const id of made) {
    const r = await gh('DELETE', `/gists/${id}`)
    log('delete', id.slice(0, 6), r.status)
  }
  await sleep(2000)
  const all = await gh('GET', '/gists?per_page=100')
  const left = (all.json ?? []).filter((g) => (g.description ?? '').startsWith('notecards-test'))
  log('clean-up: notecards-test gists left in the list call:', left.length, 'gist writes used:', writes)
}
