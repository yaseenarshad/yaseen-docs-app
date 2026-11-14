/**
 * The two small lines of the card course that parts outside the course use (YAZ-5059): the sidebar's "Copy prompt for
 * your agent" (YAZ-5109) and the course's agent step (YAZ-5124). They live here, not in `script.ts`, so a part in the
 * startup bundle can import them without pulling the whole script out of the lazy course chunk. `script.ts`
 * re-exports both, so the course reads them from the script as before.
 */

/** The first sentence of the prompt for the person's own agent (issue 1C, "Copy prompt for your agent"). `{path}` is the card skill's folder. */
export const AGENT_PROMPT = 'Read the card skill at "{path}" before you make or change cards in this vault.'

/** Chapter 8: the one line after 60 seconds with no new card from the agent (YAZ-5124). The course keeps waiting. */
export const NO_CARDS_YET = 'No new cards yet. Did you check with your agent?'
