import * as snapshotPolicy from "./snapshotPolicy";

describe("snapshot retention constants", () => {
  it("keeps 30 days of history and at least 100 checkpoints", () => {
    expect(snapshotPolicy.SNAPSHOT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(snapshotPolicy.MINIMUM_RETAINED_SNAPSHOTS).toBe(100);
  });
});

describe("selectExpiredDiagramSnapshotIds", () => {
  it("provides a pure retention selector", () => {
    expect(typeof snapshotPolicy.selectExpiredDiagramSnapshotIds).toBe(
      "function",
    );
  });

  it("selects old snapshots outside the newest retention floor", () => {
    expect(
      snapshotPolicy.selectExpiredDiagramSnapshotIds({
        snapshotsNewestFirst: [
          { id: "newest", createdAt: 100 },
          { id: "second", createdAt: 90 },
          { id: "oldest", createdAt: 80 },
        ],
        cutoff: 1_000,
        minimumRetained: 2,
      }),
    ).toEqual(["oldest"]);
  });

  it("keeps recent snapshots outside the newest retention floor", () => {
    expect(
      snapshotPolicy.selectExpiredDiagramSnapshotIds({
        snapshotsNewestFirst: [
          { id: "newest", createdAt: 1_200 },
          { id: "second", createdAt: 1_100 },
          { id: "recent", createdAt: 1_000 },
        ],
        cutoff: 900,
        minimumRetained: 2,
      }),
    ).toEqual([]);
  });

  it("keeps a snapshot created exactly at the cutoff", () => {
    expect(
      snapshotPolicy.selectExpiredDiagramSnapshotIds({
        snapshotsNewestFirst: [
          { id: "newest", createdAt: 1_200 },
          { id: "boundary", createdAt: 900 },
          { id: "older", createdAt: 899 },
        ],
        cutoff: 900,
        minimumRetained: 1,
      }),
    ).toEqual(["older"]);
  });

  it("retains at least the newest 100 snapshots even when all are old", () => {
    const snapshotsNewestFirst = Array.from({ length: 101 }, (_, index) => ({
      id: `snapshot-${index}`,
      createdAt: 1_000 - index,
    }));

    expect(
      snapshotPolicy.selectExpiredDiagramSnapshotIds({
        snapshotsNewestFirst,
        cutoff: 2_000,
        minimumRetained: 100,
      }),
    ).toEqual(["snapshot-100"]);
  });
});

describe("shouldContinueSnapshotBatchCleanup", () => {
  it("provides a bounded-cleanup continuation policy", () => {
    expect(typeof snapshotPolicy.shouldContinueSnapshotBatchCleanup).toBe(
      "function",
    );
  });

  it("continues after deleting every row from a non-final page", () => {
    expect(
      snapshotPolicy.shouldContinueSnapshotBatchCleanup({
        deleted: 20,
        pageSize: 20,
        isDone: false,
      }),
    ).toBe(true);
  });

  it.each([
    { deleted: 20, pageSize: 20, isDone: true },
    { deleted: 19, pageSize: 20, isDone: false },
    { deleted: 0, pageSize: 0, isDone: false },
  ])("stops when a batch cannot make more progress", (args) => {
    expect(snapshotPolicy.shouldContinueSnapshotBatchCleanup(args)).toBe(false);
  });
});
