import { describe, expect, it } from "vitest";

import { createTelemetrySettings } from "@/lib/telemetry";
import type { TelemetryEvent } from "@/lib/telemetry";
import type { Span } from "@opentelemetry/api";

const makeListener = () => {
  const events: TelemetryEvent[] = [];
  const listener = (event: TelemetryEvent) => {
    events.push(event);
  };
  return { listener, events };
};

describe("telemetry", () => {
  it("emits start and end events for spans", () => {
    const { listener, events } = makeListener();
    const settings = createTelemetrySettings(listener);
    const tracer = settings.tracer;

    const span = tracer.startSpan("test-span");
    span.setAttribute("foo", "bar");
    span.end();

    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({ status: "start", name: "test-span" });
    const endEvent = events[1];
    expect(endEvent).toMatchObject({ status: "end", name: "test-span" });
    expect(endEvent?.attributes?.foo).toBe("bar");
    expect(endEvent?.durationMs ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("records error events when span records exception", () => {
    const { listener, events } = makeListener();
    const settings = createTelemetrySettings(listener);
    const tracer = settings.tracer;

    const span = tracer.startSpan("error-span");
    span.recordException(new Error("boom"));
    span.end();

    const errorEvent = events.find((event) => event.status === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorMessage).toContain("boom");
  });

  it("startActiveSpan propagates attributes and handles async errors", async () => {
    const { listener, events } = makeListener();
    const settings = createTelemetrySettings(listener);
    const tracer = settings.tracer;

    await expect(
      tracer.startActiveSpan("active", async (span: Span) => {
        span.setAttribute("phase", "test");
        throw new Error("explode");
      }),
    ).rejects.toThrow("explode");

    const errorEvent = events.find((event) => event.status === "error");
    expect(errorEvent).toBeDefined();
    const endEvent = events.find((event) => event.status === "end");
    expect(endEvent).toBeDefined();
  });
});
