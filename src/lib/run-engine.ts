type RunEngineStatus = "starting" | "running" | "completed" | "errored" | "paused" | "aborted";

type RunEngineEvent =
  | {
      kind: "status";
      status: RunEngineStatus;
      timestamp: number;
    }
  | {
      kind: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      timestamp: number;
      meta?: unknown;
    }
  | {
      kind: "scoreboard";
      payload: unknown;
      timestamp: number;
    }
  | {
      kind: "telemetry";
      payload: unknown;
      timestamp: number;
    }
  | {
      kind: "result";
      payload: unknown;
      timestamp: number;
    }
  | {
      kind: "checkpoint";
      payload: unknown;
      timestamp: number;
    };

type RunEngineSubscriber = (event: RunEngineEvent) => void;

type RunPayloadSnapshot = {
  payload: unknown;
  resumeFrom: unknown;
};

type RunHandle = {
  projectId: string;
  runId: string;
  status: RunEngineStatus;
  createdAt: number;
  payload: RunPayloadSnapshot;
  subscribers: Set<RunEngineSubscriber>;
  events: RunEngineEvent[];
};

type RunStartOptions = {
  payload: unknown;
  resumeFrom?: unknown;
};

const TERMINAL_STATUSES: ReadonlySet<RunEngineStatus> = new Set(["completed", "errored", "aborted"]);

export class RunEngine {
  private readonly runs = new Map<string, RunHandle>();

  start(projectId: string, options: RunStartOptions): { runId: string } {
    const runId = crypto.randomUUID();
    const handle: RunHandle = {
      projectId,
      runId,
      status: "starting",
      createdAt: Date.now(),
      payload: {
        payload: options.payload,
        resumeFrom: options.resumeFrom ?? null,
      },
      subscribers: new Set(),
      events: [],
    };
    this.runs.set(runId, handle);
    this.emit(handle, {
      kind: "status",
      status: "starting",
      timestamp: Date.now(),
    });
    return { runId };
  }

  subscribe(runId: string, subscriber: RunEngineSubscriber): () => void {
    const handle = this.runs.get(runId);
    if (!handle) {
      throw new Error(`Run ${runId} not found`);
    }
    for (const event of handle.events) {
      subscriber(event);
    }
    handle.subscribers.add(subscriber);
    return () => {
      handle.subscribers.delete(subscriber);
      if (handle.subscribers.size === 0 && TERMINAL_STATUSES.has(handle.status)) {
        this.runs.delete(runId);
      }
    };
  }

  ingest(runId: string, event: RunEngineEvent): void {
    const handle = this.runs.get(runId);
    if (!handle) {
      throw new Error(`Run ${runId} not found`);
    }
    if (event.kind === "status") {
      handle.status = event.status;
    }
    this.emit(handle, event);
    if (event.kind === "status" && TERMINAL_STATUSES.has(event.status) && handle.subscribers.size === 0) {
      this.runs.delete(runId);
    }
  }

  abort(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    if (TERMINAL_STATUSES.has(handle.status)) return false;
    handle.status = "aborted";
    this.emit(handle, {
      kind: "status",
      status: "aborted",
      timestamp: Date.now(),
    });
    return true;
  }

  resume(runId: string, resumePayload?: unknown): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    if (handle.status !== "paused" && handle.status !== "errored") {
      return false;
    }
    handle.payload = {
      payload: handle.payload.payload,
      resumeFrom: resumePayload ?? null,
    };
    handle.status = "starting";
    this.emit(handle, {
      kind: "status",
      status: "starting",
      timestamp: Date.now(),
    });
    return true;
  }

  listByProject(projectId: string): Array<{ runId: string; status: RunEngineStatus }> {
    return Array.from(this.runs.values())
      .filter((handle) => handle.projectId === projectId)
      .map((handle) => ({ runId: handle.runId, status: handle.status }));
  }

  clear(): void {
    this.runs.clear();
  }

  private emit(handle: RunHandle, event: RunEngineEvent): void {
    handle.events.push(event);
    for (const subscriber of handle.subscribers) {
      subscriber(event);
    }
  }
}

export const runEngine = new RunEngine();

export type { RunEngineEvent, RunEngineStatus };
