import { describe, expect, it, vi } from "vitest";

import { StreamingPersistence } from "@/lib/streaming-persistence";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";

describe("StreamingPersistence", () => {
  const makeCheckpoint = (iteration: number): CheckpointState => ({
    iteration,
    totalMetricCalls: iteration * 10,
    totalCostUSD: iteration * 0.01,
    rngState: iteration,
    candidates: [],
    perInstanceScores: [],
  });

  it("emits checkpoints in ascending iteration order only", () => {
    const onCheckpoint = vi.fn();
    const persistence = new StreamingPersistence(onCheckpoint);

    persistence.saveCheckpoint(makeCheckpoint(1));
    persistence.saveCheckpoint(makeCheckpoint(1));
    persistence.saveCheckpoint(makeCheckpoint(2));

    expect(onCheckpoint).toHaveBeenCalledTimes(2);
    expect(onCheckpoint.mock.calls[0][0].iteration).toBe(1);
    expect(onCheckpoint.mock.calls[1][0].iteration).toBe(2);
  });

  it("returns the initial checkpoint when provided", () => {
    const initial = makeCheckpoint(5);
    const persistence = new StreamingPersistence(vi.fn(), initial);
    expect(persistence.loadCheckpoint()).toEqual(initial);
  });

  it("forwards archive records when listener provided", () => {
    const onArchive = vi.fn();
    const persistence = new StreamingPersistence(vi.fn(), null, onArchive);

    const record = { ts: Date.now(), iteration: 3, event: "accepted" as const };
    persistence.appendArchive(record);

    expect(onArchive).toHaveBeenCalledWith(record);
  });
});
