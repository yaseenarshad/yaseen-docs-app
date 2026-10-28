import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "prune expired diagram snapshots",
  { hours: 24 },
  internal.snapshotRetention.startDailyCleanup,
  {},
);

crons.interval(
  "prune expired Doc snapshots",
  { hours: 24 },
  internal.docSnapshotRetention.startDailyCleanup,
  {},
);

crons.interval(
  "prune expired Board scene grants",
  { hours: 1 },
  internal.boardSceneCleanup.startCleanup,
  {},
);

crons.interval(
  "prune unreferenced Doc assets",
  { hours: 24 },
  internal.docAssets.startCleanup,
  {},
);

crons.interval(
  "purge expired Docs",
  { hours: 24 },
  internal.docs.scheduleExpiredPurges,
  {},
);

export default crons;
