import {
  SNAPSHOT_INTERVAL_MS,
  shouldCreateDiagramSnapshot,
} from "./snapshotPolicy";

describe("shouldCreateDiagramSnapshot", () => {
  it("waits five minutes between periodic recovery checkpoints", () => {
    const fiveMinutes = 5 * 60 * 1000;

    expect(SNAPSHOT_INTERVAL_MS).toBe(fiveMinutes);
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 12,
        force: false,
        lastSnapshotAt: 100_000,
        now: 100_000 + fiveMinutes - 1,
      }),
    ).toBe(false);
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 13,
        force: false,
        lastSnapshotAt: 100_000,
        now: 100_000 + fiveMinutes,
      }),
    ).toBe(true);
  });

  it("does not snapshot an empty initial scene", () => {
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 0,
        force: true,
        lastSnapshotAt: null,
        now: 100_000,
      }),
    ).toBe(false);
  });

  it("always snapshots an existing scene before a programmatic edit", () => {
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 12,
        force: true,
        lastSnapshotAt: 99_999,
        now: 100_000,
      }),
    ).toBe(true);
  });

  it("creates periodic snapshots without duplicating the interval", () => {
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 12,
        force: false,
        lastSnapshotAt: null,
        now: 100_000,
      }),
    ).toBe(true);
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 13,
        force: false,
        lastSnapshotAt: 100_000,
        now: 100_000 + SNAPSHOT_INTERVAL_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldCreateDiagramSnapshot({
        currentVersion: 14,
        force: false,
        lastSnapshotAt: 100_000,
        now: 100_000 + SNAPSHOT_INTERVAL_MS,
      }),
    ).toBe(true);
  });
});
