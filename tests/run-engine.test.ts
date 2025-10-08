import { afterEach, describe, expect, it } from "vitest";

import { RunEngine, type RunEngineEvent } from "@/lib/run-engine";

const createEngine = () => new RunEngine();

describe("RunEngine", () => {
  afterEach(() => {
    // Ensure individual engine instances can be garbage collected.
  });

  it("creates a run handle and replays initial status to subscribers", () => {
    const engine = createEngine();
    const { runId } = engine.start("project-1", { payload: { foo: "bar" } });
    const events: RunEngineEvent[] = [];

    const unsubscribe = engine.subscribe(runId, (event) => {
      events.push(event);
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", status: "starting" });
    expect(engine.listByProject("project-1")).toHaveLength(1);

    unsubscribe();
  });

  it("ingests events and notifies subscribers in order", () => {
    const engine = createEngine();
    const { runId } = engine.start("project-2", { payload: {} });
    const events: RunEngineEvent[] = [];
    const unsubscribe = engine.subscribe(runId, (event) => events.push(event));

    engine.ingest(runId, { kind: "status", status: "running", timestamp: Date.now() });
    engine.ingest(runId, {
      kind: "log",
      level: "info",
      message: "optimizer started",
      timestamp: Date.now(),
    });

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ kind: "status", status: "running" });
    expect(events[2]).toMatchObject({ kind: "log", message: "optimizer started" });

    unsubscribe();
  });

  it("aborts and cleans up terminal runs once unsubscribed", () => {
    const engine = createEngine();
    const { runId } = engine.start("project-3", { payload: {} });
    const events: RunEngineEvent[] = [];
    const unsubscribe = engine.subscribe(runId, (event) => events.push(event));

    const aborted = engine.abort(runId);
    expect(aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "status", status: "aborted" });

    unsubscribe();
    expect(engine.listByProject("project-3")).toHaveLength(0);
  });

  it("resumes paused runs by emitting a new starting status", () => {
    const engine = createEngine();
    const { runId } = engine.start("project-4", { payload: {} });
    const events: RunEngineEvent[] = [];
    const unsubscribe = engine.subscribe(runId, (event) => events.push(event));

    engine.ingest(runId, { kind: "status", status: "paused", timestamp: Date.now() });
    const resumed = engine.resume(runId);
    expect(resumed).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "status", status: "starting" });

    unsubscribe();
  });
});
