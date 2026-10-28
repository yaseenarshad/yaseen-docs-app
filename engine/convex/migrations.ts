import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import schema from "./schema";
import { normalizeBoardTitle } from "./boardPersistence";

export const migrations = new Migrations(components.migrations, { schema });

export const getUntitledBoardTitlePatch = (document: { title: string }) =>
  document.title === "Untitled diagram"
    ? ({ title: "Untitled board" } as const)
    : null;

export const renameUntitledDiagrams = migrations.define({
  table: "diagrams",
  migrateOne: async (_ctx, diagram) =>
    getUntitledBoardTitlePatch(diagram) ?? undefined,
});

export const getNormalizedBoardTitlePatch = (document: {
  title: string;
  normalizedTitle?: string;
}) => {
  const normalizedTitle = normalizeBoardTitle(document.title);
  return document.normalizedTitle === normalizedTitle
    ? null
    : { normalizedTitle };
};

export const backfillNormalizedBoardTitles = migrations.define({
  table: "diagrams",
  migrateOne: async (_ctx, diagram) =>
    getNormalizedBoardTitlePatch(diagram) ?? undefined,
});

export const run = migrations.runner();

export const runBackfillNormalizedBoardTitles = migrations.runner(
  internal.migrations.backfillNormalizedBoardTitles,
);

export const runAll = migrations.runner([
  internal.migrations.renameUntitledDiagrams,
  internal.migrations.backfillNormalizedBoardTitles,
]);
