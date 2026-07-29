export const SNAPSHOT_INTERVAL_MS = 30_000;

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
