export type DocPlacementViewState = {
  version: 1;
  docVersion: number;
  collapsedKeys: string[];
  scrollTop: number;
  updatedAt: number;
};

const STORAGE_KEY = "yaseendraw-doc-placement-view-state-v1";
const MAX_RECORDS = 500;

const recordKey = (boardId: string, elementId: string) =>
  `${boardId}:${elementId}`;

const readAll = (): Record<string, DocPlacementViewState> => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Record<string, DocPlacementViewState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const readDocPlacementViewState = (
  boardId: string,
  elementId: string,
  docVersion: number,
): DocPlacementViewState => {
  const value = readAll()[recordKey(boardId, elementId)];
  return value?.version === 1 && value.docVersion === docVersion
    ? value
    : {
        version: 1,
        docVersion,
        collapsedKeys: [],
        scrollTop: 0,
        updatedAt: Date.now(),
      };
};

export const writeDocPlacementViewState = (
  boardId: string,
  elementId: string,
  state: Omit<DocPlacementViewState, "version" | "updatedAt">,
) => {
  try {
    const all = readAll();
    all[recordKey(boardId, elementId)] = {
      version: 1,
      ...state,
      collapsedKeys: [...new Set(state.collapsedKeys)].slice(0, 200),
      scrollTop: Math.max(0, state.scrollTop),
      updatedAt: Date.now(),
    };
    const entries = Object.entries(all)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_RECORDS);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // View continuity is optional when browser storage is unavailable.
  }
};
