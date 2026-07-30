export const BOARD_SORTS = [
  "name-asc",
  "name-desc",
  "created-desc",
  "created-asc",
  "modified-desc",
  "modified-asc",
] as const;

export type BoardSort = typeof BOARD_SORTS[number];

export const BOARD_SORT_STORAGE_KEY = "yaseen-whiteboard-board-sort";

export const getStoredBoardSort = (value: string | null): BoardSort =>
  BOARD_SORTS.includes(value as BoardSort)
    ? (value as BoardSort)
    : "modified-desc";

export const dedupeBoards = <Board extends { _id: string }>(
  boards: Board[],
) => {
  const positions = new Map<string, number>();
  const deduped: Board[] = [];
  for (const board of boards) {
    const position = positions.get(board._id);
    if (position === undefined) {
      positions.set(board._id, deduped.length);
      deduped.push(board);
    } else {
      deduped[position] = board;
    }
  }
  return deduped;
};
