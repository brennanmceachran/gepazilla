import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOptimizerState } from "@/components/optimizer/use-optimizer-state";
import {
  coerceReflectionDataset,
  deriveCell,
  mapToDatasetRows,
  numberOrUndefined,
  sanitizeRows,
} from "@/lib/optimizer/state-utils";
import type { ScorerEvaluation } from "@/lib/scorers";
import type { TelemetryEvent } from "@/lib/telemetry";

const makeEvaluation = (overrides: Partial<ScorerEvaluation> = {}): ScorerEvaluation => ({
  status: "ready",
  value: 1,
  ...overrides,
});

describe("mapToDatasetRows", () => {
  it("fills missing ids and defaults fields", () => {
    const rows = mapToDatasetRows([
      { id: "", input: " prompt ", expectedOutput: undefined },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id.length).toBeGreaterThan(0);
    expect(rows[0].input).toBe(" prompt ");
    expect(rows[0].expectedOutput).toBe("");
  });
});

describe("sanitizeRows", () => {
  it("trims inputs and drops empty rows", () => {
    const sanitized = sanitizeRows([
      { id: "1", input: " foo ", expectedOutput: " bar " },
      { id: "2", input: "   ", expectedOutput: "" },
    ]);
    expect(sanitized).toEqual([
      { id: "1", input: "foo", expectedOutput: "bar" },
    ]);
  });
});

describe("numberOrUndefined", () => {
  it("parses numeric strings or returns undefined", () => {
    expect(numberOrUndefined(" 42 ")).toBe(42);
    expect(numberOrUndefined("abc")).toBeUndefined();
    expect(numberOrUndefined(" ")).toBeUndefined();
  });
});

describe("coerceReflectionDataset", () => {
  it("normalizes reflection dataset entries", () => {
    const value = {
      component: [
        { Inputs: { userMessage: "u" }, Feedback: "f" },
        null,
      ],
    };
    const result = coerceReflectionDataset(value);
    expect(result?.component).toHaveLength(1);
    expect(result?.component?.[0]?.Feedback).toBe("f");
  });
});

describe("deriveCell", () => {
  it("returns evaluation unchanged when active", () => {
    const evaluation = makeEvaluation({ status: "ready", value: 0.5 });
    expect(deriveCell(evaluation, true)).toBe(evaluation);
  });

  it("marks pending cells idle when inactive", () => {
    const evaluation = makeEvaluation({ status: "pending", notes: "run" });
    const derived = deriveCell(evaluation, false);
    expect(derived.status).toBe("idle");
    expect(derived.notes).toBe("run");
  });

  it("adds disabled note when evaluation has none", () => {
    const evaluation = makeEvaluation({ status: "ready", notes: undefined });
    const derived = deriveCell(evaluation, false);
    expect(derived.notes).toBe("Scorer disabled");
  });
});

describe("useOptimizerState telemetry buffer", () => {
  it("caps telemetry events and records to the buffer limit", () => {
    const { result } = renderHook(() => useOptimizerState());

    act(() => {
      for (let index = 0; index < 205; index += 1) {
        const event: TelemetryEvent = {
          traceId: `trace-${index}`,
          spanId: `span-${index}`,
          name: "span",
          status: "end",
          timestamp: Date.now() + index,
          durationMs: 5,
          attributes: {
            "gepa.rowId": `row-${index}`,
            "gepa.iteration": index,
            "gepa.role": "assistant",
          },
        };
        result.current.handleTelemetryEvent(event);
      }
    });

    expect(result.current.telemetryRecords.length).toBe(200);
    expect(result.current.telemetryEvents.length).toBe(200);
    const oldestRecord = result.current.telemetryRecords.at(-1);
    expect(oldestRecord?.datasetRowId).toBe("row-5");
  });
});
