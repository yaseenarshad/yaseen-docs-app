/**
 * THE SCENE KIT (YAZ-5121): the pieces every chapter's scenes share. Read `beat.ts` first (time), then `Stage.tsx`
 * (the frame and `useBeat`). The guide to each piece is in the comment "Decision (agent): the scene kit" on YAZ-5121.
 */
export * from './beat'
export { useBeat, Stage, Layer, Words, Fit, litFocus } from './Stage'
export { Paper, Cite, BigNumber, type PaperCues } from './Paper'
export { Counter, Bars, Tally, type Bar } from './Numbers'
export { Curve, Ridge, memory, dayAt, xOf, yOf, curvePoints, pathOf, VIEW, FLOOR, S0, SAMPLE_REVIEWS, type Review, type Axis } from './Curve'
export { CardView, type CardViewProps } from './CardView'
export { Timeline, Calendar, type Stop, type CalendarChip } from './Timeline'
export { Tree, hub, type TreeNode, type TreeEdge, type TreeCardLook } from './Tree'
export { BrainCells } from './BrainCells'
export { AppWindow, cardMenuItems, glowStyle, TryChip, SidebarPreview, MenuPreview, ToolbarPreview, SlashPreview, Pointer, Keys, Caret, type SidebarRow, type MenuItem } from './AppFrame'
export { IndexCard, MiniCard, Gears, Medal, Orb } from './Drawings'
export { Answers, type Answer } from './Answers'
// Chapters 3 to 5 (YAZ-5121): the Inbox, a page and an embed, the agent's chat, a journal's issue, the person, Edit card's keys.
export { InboxView, type InboxViewProps, type InboxAnswerLook } from './InboxView'
export { PageView, PageText, EmbedView, type EmbedViewProps } from './PageView'
export { CardPill, FilterMenu, LinkPicker, LinkedMentions, ReviewsStrip, type ReviewRow } from './AppPanels'
export { AgentChat, type ChatLine, type ChatAsk } from './AgentChat'
export { JournalCover, type JournalIssue } from './Journal'
export { Head, type HeadDot } from './Head'
export { CardEditKeyRow, CardDoneKeys, EditCard, editKey } from './EditKeys'
export { AgentTerminal, type TermLine } from './AgentTerminal'
