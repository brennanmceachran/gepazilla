import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryEvent } from "@/lib/telemetry";

const makeEvent = (index = 0): TelemetryEvent => ({
  traceId: `trace-${index}`,
  spanId: `span-${index}`,
  name: "span",
  status: "end",
  timestamp: Date.now() + index,
  durationMs: 5,
  attributes: {
    "gepa.iteration": index,
    "gepa.role": "assistant",
    "gepa.rowId": `row-${index}`,
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("useOptimizerState debug telemetry logging", () => {
  it("logs telemetry diagnostics when debug flag enabled", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_DEBUG_TELEMETRY", "true");
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { useOptimizerState } = await import("@/components/optimizer/use-optimizer-state");
    const { result } = renderHook(() => useOptimizerState());

    act(() => {
      result.current.handleTelemetryEvent(makeEvent(1));
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("does not log when debug flag disabled", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_DEBUG_TELEMETRY", "false");
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { useOptimizerState } = await import("@/components/optimizer/use-optimizer-state");
    const { result } = renderHook(() => useOptimizerState());

    act(() => {
      result.current.handleTelemetryEvent(makeEvent(2));
    });

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
