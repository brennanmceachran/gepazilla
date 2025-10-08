import type { ArchiveRecord, CheckpointState } from "@currentai/dsts/dist/persistence";

export type CheckpointListener = (checkpoint: CheckpointState) => void;
export type ArchiveListener = (record: ArchiveRecord) => void;

/**
 * Persistence adapter that forwards checkpoints to a callback instead of writing to disk.
 * DSTS calls saveCheckpoint/appendArchive during optimize(); we expose those events
 * so the API route can stream them back to the client over SSE.
 */
export class StreamingPersistence {
  private lastIteration = -1;

  constructor(
    private readonly onCheckpoint: CheckpointListener,
    private readonly initialCheckpoint?: CheckpointState | null,
    private readonly onArchive?: ArchiveListener,
  ) {}

  saveCheckpoint(state: CheckpointState): void {
    if (typeof state?.iteration !== "number") return;
    if (state.iteration <= this.lastIteration) return;
    this.lastIteration = state.iteration;
    this.onCheckpoint(state);
  }

  loadCheckpoint(): CheckpointState | null {
    return this.initialCheckpoint ?? null;
  }

  appendArchive(record: ArchiveRecord): void {
    if (!this.onArchive) return;
    this.onArchive(record);
  }
}
