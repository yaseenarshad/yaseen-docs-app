const hashLabel = (label: string) => {
  let hash = 2166136261;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const getOutlineFoldKey = (label: string, occurrence: number) =>
  `${hashLabel(label)}:${occurrence}`;
