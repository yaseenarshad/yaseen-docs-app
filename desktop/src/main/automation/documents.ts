import { addReview, deleteReview, resetReviews, reviewsOf, setInReview, sanitizeReviewSettings, REVIEW_SETTINGS_FILE } from '@shared/reviews'
import { rootOfPath } from '@shared/types'
import { dirname } from 'node:path'
import { createDir } from '../fs/create'
import { doorOf } from '../vaultIndex/mint'
import { readConfig } from '../vaultConfig'
import { AutomationFailure } from '@shared/automation'
import { addComment, deleteComment, editComment, newCommentId, nowIso, readComments } from '@shared/comments'
import { setFrontmatterIn } from '@shared/frontmatter'
import { isMarkdown } from '@shared/fileKind'
import type { AppState } from '@shared/types'
import { absolute, readSaved, resolveTarget, scopeRoots, type ResourceScope, type TargetInput } from './resources'
import { decodeViewOnlyText, writeFile } from '../fs/file'
import { revisionOf } from '../fs/revision'
import { newNote } from '../notes/note'
import type { SavedCallback } from '../documentSaves'

export async function documentCommand(state: AppState, command: string, args: Record<string, unknown>, body: Buffer, hasContent = body.length > 0, record?: SavedCallback): Promise<unknown> {
  const { roots } = await scopeRoots(state, args as ResourceScope)
  if (command === 'folder.create') {
    const path = absolute(args.path as string)
    await resolveTarget(roots, { path: dirname(path) })
    const root = rootOfPath(roots, path)
    if (!root || roots.includes(path)) throw new AutomationFailure('OUTSIDE_SCOPE', 'Create a folder inside the selected vault.')
    return { ...await createDir({ path, ...(args.title === undefined ? {} : { title: args.title as string }) }, await doorOf(root)), diskSaved: true }
  }
  if (command === 'note.create') {
    const folder = await resolveTarget(roots, { path: args.folder as string })
    return newNote(folder, args.title as string, hasContent ? decodeViewOnlyText(body, folder) : undefined)
  }
  const path = await resolveTarget(roots, args as TargetInput)
  const before = await readSaved(path)
  const comments = command.startsWith('comment.') ? readComments(before.content) : []
  if (command === 'review.list') {
    const items = reviewsOf(before.content), offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { path, revision: before.revision, items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
  }
  if (command === 'comment.list') {
    const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
    return { path, revision: before.revision, items: comments.slice(offset, offset + limit), total: comments.length, nextOffset: offset + limit < comments.length ? offset + limit : null }
  }
  if (before.revision !== args.revision) throw new AutomationFailure('CONFLICT', 'The saved file no longer matches this revision. Read it again before editing.')
  if ((command.startsWith('property.') || command.startsWith('comment.') || command.startsWith('review.')) && !isMarkdown(path)) throw new AutomationFailure('UNSUPPORTED_EXTENSION', 'Properties and comments require a Markdown document.')
  let content = before.content
  let comment: string | undefined
  switch (command) {
    case 'review.keep': content = addReview(content, nowIso()); break
    case 'review.remove': content = deleteReview(content, args.at as string); break
    case 'review.reset': content = resetReviews(content); break
    case 'review.setEnabled': content = setInReview(content, args.enabled as boolean, sanitizeReviewSettings(await readConfig(rootOfPath(roots, path)!, REVIEW_SETTINGS_FILE))); break
    case 'file.write': content = decodeViewOnlyText(body, path); break
    case 'file.append': content += decodeViewOnlyText(body, path); break
    case 'property.set': case 'property.remove': {
      const keys = args.keys as string[]
      if (!keys.length || keys.some(key => !key || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new AutomationFailure('INVALID_INPUT', 'Supply a non-empty property key path.')
      if (keys[0] === 'comments') throw new AutomationFailure('INVALID_INPUT', 'Use the comment commands to preserve comment ownership rules.')
      content = setFrontmatterIn(content, keys, command === 'property.remove' ? undefined : args.value)
      break
    }
    case 'comment.add': {
      const replyTo = args.replyTo as string | undefined
      if (replyTo && !comments.some(item => item.id === replyTo && item.reply_to === undefined)) throw new AutomationFailure('NOT_FOUND', 'The parent comment was not found. Use a top-level comment ID.')
      comment = newCommentId()
      content = addComment(content, decodeViewOnlyText(body, path), { id: comment, at: nowIso(), replyTo, title: args.title as string | undefined, by: (args.by as string | undefined)?.trim() || 'agent' })
      break
    }
    case 'comment.update': case 'comment.remove': {
      const target = comments.find(item => item.id === args.comment)
      if (!target) throw new AutomationFailure('NOT_FOUND', 'The comment was not found.')
      if (target.by === undefined) throw new AutomationFailure('COMMENT_OWNERSHIP', 'This comment was left by a person. Edit or delete it in the app.')
      comment = target.id
      content = command === 'comment.remove' ? deleteComment(content, target.id) : editComment(content, target.id, decodeViewOnlyText(body, path), nowIso(), args.title as string ?? target.title ?? '')
      break
    }
    default: throw new AutomationFailure('UNKNOWN_COMMAND', 'No document adapter exists for this command.')
  }
  const saved = await writeFile({ path, content, expectedRevision: before.revision })
  await record?.(roots, saved.path)
  return { ...saved, revision: revisionOf(content, saved.mtime), diskSaved: true, rendererMerged: false, changed: content !== before.content, ...(comment ? { comment } : {}) }
}
