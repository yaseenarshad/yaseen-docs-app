export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MINIMUM_RETAINED_SNAPSHOTS = 100;

export const selectExpiredDiagramSnapshotIds = <SnapshotId>(args: {
  snapshotsNewestFirst: readonly {
    id: SnapshotId;
    createdAt: number;
  }[];
  cutoff: number;
  minimumRetained: number;
}): SnapshotId[] =>
  args.snapshotsNewestFirst
    .slice(args.minimumRetained)
    .filter((snapshot) => snapshot.createdAt < args.cutoff)
    .map((snapshot) => snapshot.id);

export const shouldContinueSnapshotBatchCleanup = (args: {
  deleted: number;
  pageSize: number;
  isDone: boolean;
}) => !args.isDone && args.deleted === args.pageSize && args.pageSize > 0;

export const shouldCreateDiagramSnapshot = (args: {
  currentVersion: number;
  force: boolean;
  lastSnapshotAt: number | null;
  now: number;
}) => {
  if (args.currentVersion === 0) {
    return false;
  }
  if (args.force || args.lastSnapshotAt === null) {
    return true;
  }
  return args.now - args.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
};
