/**
 * Git's own SHA of a file's bytes (`git hash-object`): SHA-1 of `blob <size>\0<bytes>`. The tree from GitHub gives each
 * file this SHA, so the phone can tell whether a stored copy is the one GitHub has, with no download (row F5: an
 * interrupted download continues, and what it stored is not fetched again). `crypto.subtle` runs off the UI thread.
 */
export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const all = new Uint8Array(head.byteLength + bytes.byteLength)
  all.set(head)
  all.set(bytes, head.byteLength)
  const digest = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
