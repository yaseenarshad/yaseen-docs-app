/**
 * A writer's circle (YAZ-4615 D6): the picture when there is one, else initials. `tone` colours the
 * initials: `me` the indigo of your own comments, `agent` the violet of a voice that is not a known
 * person, `person` a quiet neutral for a teammate. `empty` draws the "+" that asks for a profile.
 */
export type AvatarTone = 'me' | 'person' | 'agent'

export const initialsOf = (name: string): string => {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase()
}

export function Avatar({ name, picture, tone, size = 20, empty = false }: { name: string; picture: string | null; tone: AvatarTone; size?: number; empty?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (picture !== null) return <img className="comments-avatar" src={picture} alt="" style={style} draggable={false} />
  return (
    <span className={`comments-avatar comments-avatar--${empty ? 'empty' : tone}`} style={style} aria-hidden>
      {empty ? '+' : tone === 'agent' && name === 'agent' ? 'AI' : initialsOf(name)}
    </span>
  )
}
