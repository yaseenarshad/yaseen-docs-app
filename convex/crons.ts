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
  "prune expired Board scene grants",
  { hours: 1 },
  internal.boardSceneCleanup.startCleanup,
  {},
);

export default crons;
