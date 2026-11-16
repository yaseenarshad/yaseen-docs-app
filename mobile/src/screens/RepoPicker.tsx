import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, SAVE_FAILED, signInHelp, type Help } from '../app/help'
import type { SignInError } from '../auth/check'
import { REPO_LIST_CAP, listTokenRepos, lookForVault, orderRepos, type RepoList, type TokenRepo, type VaultLook } from '../auth/repos'
import { listInstalledRepos } from '../auth/githubApp'
import type { SignInOutcome } from '../auth/signIn'
import { vaultId } from '../store'
import { Problem } from './Frame'

/**
 * The repo picker. The token's repos, as a list to tap; a tap runs the existing sign-in (`addVault`, the
 * check on save of 3E, unchanged). Its own chunk: it loads when the person taps "Show my repos".
 * - Likely vaults first: the app looks for `.yaseendocs/` in the first `LOOK_FIRST` repos (the most recent pushes)
 *   before it shows the list. Each other row is looked at when it comes on screen; its mark shows, and the order stays.
 * - The list lives in this component's state only: never stored, never logged.
 */
export const LOOK_FIRST = 12
/** At most this many looks at one time. */
const LOOKS_AT_ONCE = 4
/** More repos than this: a search box. */
export const SEARCH_OVER = 8
/** At most this many rows show; the search box finds the others. */
export const ROWS_MAX = 50

type Listed = { state: 'loading' } | { state: 'failed'; error: SignInError } | { state: 'ready'; repos: TokenRepo[]; capped: boolean }

/**
 * Where the repos come from:
 * - `token`: a pasted token's repos (`GET /user/repos`, YAZ-5408).
 * - `github` (YAZ-5645): the repos chosen for the app on GitHub (its installations), with the account's access token.
 *   A tap adds the vault on the account's sign-in (it refreshes by itself). The ways out: "Choose repos on GitHub" and
 *   "Use a token instead".
 */
export type RepoSource = { kind: 'token'; token: string } | { kind: 'github'; login: string }

export interface RepoPickerProps {
  source: RepoSource
  /** "Use another token" (a token) or "Use a token instead" (GitHub). */
  onOtherToken: () => void
  onTyped: () => void
  /** GitHub: opens GitHub's page to choose the repos (`choose-repos`). */
  onChooseRepos?: () => void
  /** GitHub: "Sign in with GitHub" again (the account was signed out). */
  onSignInGithub?: () => void
}

export default function RepoPicker({ source, onOtherToken, onTyped, onChooseRepos, onSignInGithub }: RepoPickerProps) {
  const app = useApp()
  const github = source.kind === 'github' ? source.login : null
  const githubAccess = app.githubAccess
  /** The token the list, the looks and the pick use: the pasted one, or the account's (read when the list loads). */
  const tokenRef = useRef(source.kind === 'token' ? source.token : '')
  tokenRef.current = source.kind === 'token' ? source.token : tokenRef.current
  const token = source.kind === 'token' ? source.token : null
  const deps = useMemo(() => ({ fetch: app.services.fetch, now: app.services.now }), [app.services.fetch, app.services.now])
  const [attempt, setAttempt] = useState(0)
  const [listed, setListed] = useState<Listed>({ state: 'loading' })
  const [looks, setLooks] = useState<Record<string, VaultLook>>({})
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const [help, setHelp] = useState<Help | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const alive = useRef(true)
  const asked = useRef(new Set<string>())
  const lastPick = useRef<string | null>(null)
  /** Set in the same turn as the tap (as `checking` in `SignIn.tsx`), so a second tap before the next render does nothing. */
  const checking = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  /**
   * Looks at each repo once, at most `LOOKS_AT_ONCE` at a time: the first looks and the rows' looks go through ONE
   * queue. `queued` gives the look's answer; `look` (a row on screen) sets its mark.
   */
  const { look, queued } = useMemo(() => {
    const queue: { repo: TokenRepo; done: (found: VaultLook) => void }[] = []
    let running = 0
    const pump = () => {
      while (running < LOOKS_AT_ONCE && queue.length > 0) {
        const { repo, done } = queue.shift()!
        running++
        void lookForVault(tokenRef.current, repo, deps).then((found) => {
          running--
          done(found)
          pump()
        })
      }
    }
    const queued = (repo: TokenRepo) => new Promise<VaultLook>((done) => (queue.push({ repo, done }), pump()))
    const look = (repo: TokenRepo) => {
      if (asked.current.has(repo.fullName)) return
      asked.current.add(repo.fullName)
      void queued(repo).then((found) => alive.current && setLooks((l) => ({ ...l, [repo.fullName]: found })))
    }
    return { look, queued }
    // A new token (another pasted token) starts the looks again; a refreshed GitHub token is read at each look.
  }, [token, github, deps])

  useEffect(() => {
    let current = true
    setListed({ state: 'loading' })
    setHelp(null)
    void (async () => {
      let out: RepoList
      if (github === null) out = await listTokenRepos(tokenRef.current, deps)
      else {
        const access = await githubAccess(github)
        if (!current) return
        if (access === null) out = { ok: false, error: { kind: 'unauthorized' } }
        else {
          tokenRef.current = access
          out = await listInstalledRepos(access, deps)
        }
      }
      if (!current) return
      if (!out.ok) return setListed({ state: 'failed', error: out.error })
      const first = out.repos.slice(0, LOOK_FIRST)
      const found = await Promise.all(first.map(async (r) => [r.fullName, await queued(r)] as const))
      if (!current) return
      for (const r of first) asked.current.add(r.fullName)
      const known = Object.fromEntries(found)
      setLooks(known)
      setListed({ state: 'ready', repos: orderRepos(out.repos, known), capped: out.capped })
    })()
    return () => void (current = false)
  }, [token, github, deps, attempt, queued, githubAccess])

  const onPhone = useMemo(() => new Set(app.list.vaults.map((v) => vaultId(v))), [app.list.vaults])
  const repos = listed.state === 'ready' ? listed.repos : []
  const words = query.trim().toLowerCase()
  const found = words === '' ? repos : repos.filter((r) => r.fullName.toLowerCase().includes(words))
  const shown = found.slice(0, ROWS_MAX)

  const pick = async (repo: TokenRepo) => {
    if (picking !== null || checking.current) return
    checking.current = true
    lastPick.current = repo.fullName
    setPicking(repo.fullName)
    setHelp(null)
    let outcome: SignInOutcome
    try {
      outcome = await app.addVault({ repo: repo.fullName, token: tokenRef.current, ...(github !== null && { github }) })
    } catch {
      checking.current = false
      if (alive.current) (setPicking(null), setHelp(SAVE_FAILED))
      return
    }
    checking.current = false
    if (!alive.current) return
    setPicking(null)
    if (outcome.ok) return
    setHelp(signInHelp(outcome.error, github !== null))
    setOpenId(outcome.error.kind === 'already-added' ? vaultId(outcome.error) : null)
  }

  const forward = (h: Help, failedList: boolean) => {
    switch (h.forward) {
      case 'token-guide':
      case 'repo-guide':
        app.go({ type: 'open', route: { kind: 'guide' } })
        break
      case 'edit-repo':
        onTyped()
        break
      case 'open-vault':
        if (openId !== null) void app.switchVault(openId)
        break
      case 'choose-repos':
        onChooseRepos?.()
        break
      case 'sign-in-github':
        onSignInGithub?.()
        break
      case 'retry': {
        const again = repos.find((r) => r.fullName === lastPick.current)
        if (failedList || again === undefined) setAttempt((n) => n + 1)
        else void pick(again)
        break
      }
    }
  }

  const tail = github !== null ? (
    <div className="repo-picker__ways">
      <button type="button" className="link-btn" onClick={onChooseRepos}>
        Choose repos on GitHub
      </button>
      <button type="button" className="link-btn" onClick={onOtherToken}>
        Use a token instead
      </button>
    </div>
  ) : (
    <div className="repo-picker__ways">
      <button type="button" className="link-btn" onClick={onOtherToken}>
        Use another token
      </button>
      <button type="button" className="link-btn" onClick={onTyped}>
        Type the repo name
      </button>
    </div>
  )

  if (listed.state === 'loading')
    return (
      <div className="stack" aria-busy="true">
        <p className="lead" role="status">
          {github !== null ? `Looking for the repos of @${github}…` : 'Looking for the repos of this token…'}
        </p>
        {tail}
      </div>
    )

  if (listed.state === 'failed') {
    const h = signInHelp(listed.error, github !== null)
    return (
      <div className="stack">
        <Problem message={h.message} action={FORWARD_LABEL[h.forward]} onAction={() => forward(h, true)} />
        {tail}
      </div>
    )
  }

  return (
    <div className="stack repo-picker">
      <p className="lead">{github !== null ? `Signed in as @${github}. Choose the repo of your vault.` : 'Choose the repo of your vault.'}</p>
      {listed.capped && <p className="muted">{`This token can see more than ${REPO_LIST_CAP.toLocaleString('en-US')} repos. The list shows the ${REPO_LIST_CAP.toLocaleString('en-US')} with the latest changes. For another one, type the repo name.`}</p>}
      {repos.length > SEARCH_OVER && (
        <label className="field">
          <span className="field__label">Find a repo</span>
          <input type="search" name="find" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
      )}
      {help !== null && <Problem message={help.message} action={FORWARD_LABEL[help.forward]} onAction={() => forward(help, false)} />}
      {shown.length === 0 ? (
        <p className="muted">No repo has this name.</p>
      ) : (
        <ul className="rows" aria-label="Repos">
          {shown.map((repo) => (
            <RepoRow key={repo.fullName} repo={repo} look={looks[repo.fullName]} added={onPhone.has(vaultId({ repo: repo.fullName, branch: repo.defaultBranch }))} picking={picking} onSeen={look} onPick={pick} />
          ))}
        </ul>
      )}
      {found.length > shown.length && <p className="muted">{`${shown.length} of ${found.length} show. Type a name to find another.`}</p>}
      {tail}
    </div>
  )
}

function RepoRow({ repo, look, added, picking, onSeen, onPick }: { repo: TokenRepo; look: VaultLook | undefined; added: boolean; picking: string | null; onSeen: (r: TokenRepo) => void; onPick: (r: TokenRepo) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  // A row looks for its vault when it comes on screen (no look for rows the person never sees).
  useEffect(() => {
    const el = ref.current
    if (el === null || typeof IntersectionObserver !== 'function') return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        onSeen(repo)
        seen.disconnect()
      }
    })
    seen.observe(el)
    return () => seen.disconnect()
  }, [repo, onSeen])
  const vault = look === 'vault'
  const busy = picking === repo.fullName
  const label = [repo.fullName, repo.private ? 'private' : null, vault ? 'a vault' : null, added ? 'added' : null].filter(Boolean).join(', ')
  return (
    <li className="row">
      <button ref={ref} type="button" className="row__button repo-row" aria-label={label} aria-busy={busy} disabled={added || picking !== null} onClick={() => onPick(repo)}>
        <span className="repo-row__name">
          {repo.fullName}
          {repo.private && <span className="repo-row__meta"> · private</span>}
        </span>
        {busy ? <span className="row__side">Checking…</span> : added ? <span className="row__side">Added</span> : vault ? <span className="repo-row__mark">Vault</span> : null}
      </button>
    </li>
  )
}
