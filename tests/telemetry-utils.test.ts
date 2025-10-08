import { describe, expect, it } from "vitest";

import {
  buildTelemetryRecordFromSpans,
  buildTelemetryRecords,
  deriveTelemetryKey,
} from "@/components/optimizer/run-dock/logs/telemetry-utils";
import type {
  DatasetLookup,
  DatasetRow,
  TelemetryRecord,
  TelemetrySpan,
} from "@/components/optimizer/types";

let spanCounter = 0;
const nextSpanId = () => `span-${++spanCounter}`;

const baseSpan = (overrides: Partial<TelemetrySpan> = {}): TelemetrySpan => ({
  traceId: overrides.traceId ?? "trace-1",
  spanId: overrides.spanId ?? nextSpanId(),
  name: overrides.name ?? "span",
  status: overrides.status ?? "success",
  startTime: overrides.startTime ?? 0,
  endTime: overrides.endTime ?? 5,
  durationMs: overrides.durationMs,
  attributes: overrides.attributes ?? {},
  errorMessage: overrides.errorMessage,
  derived: overrides.derived ?? {},
});

const datasetLookup = (rows: DatasetRow[]): DatasetLookup => ({
  byId: new Map(rows.map((row) => [row.id, { key: "training" as const, row }])),
  byInput: new Map(
    rows.map((row) => [row.input.replace(/\s+/g, " ").trim().toLowerCase(), [{ key: "training" as const, row }]]),
  ),
});

describe("deriveTelemetryKey", () => {
  it("prefers provider response id, then response, then row", () => {
    expect(
      deriveTelemetryKey(baseSpan({ derived: { providerResponseId: "provider" } })),
    ).toBe("provider:provider");
    expect(
      deriveTelemetryKey(baseSpan({ derived: { responseId: "resp" } })),
    ).toBe("response:resp");
    expect(
      deriveTelemetryKey(baseSpan({ derived: { datasetRowId: "row-1" } })),
    ).toBe("row:row-1");
  });
});

describe("buildTelemetryRecordFromSpans", () => {
  it("merges metadata into previous record", () => {
    const previous: TelemetryRecord = {
      traceId: "trace-prev",
      root: baseSpan({ spanId: "root-prev" }),
      children: [],
      status: "success",
      startedAt: 0,
      endedAt: 10,
      durationMs: 10,
      modelId: "model-a",
      provider: "provider-a",
      aggregator: undefined,
      prompt: "Hello",
      response: "First",
      datasetRowId: "row-1",
      datasetRowInput: "Prompt",
      datasetRowExpected: "Expected",
      datasetRowLabel: "row-1",
      fallbackProviders: ["foo"],
      routingAttempts: [
        { provider: "foo", success: false, durationMs: 10 },
      ],
    } as TelemetryRecord;

    const spans: TelemetrySpan[] = [
      baseSpan({
        traceId: "trace-prev",
        derived: {
          providerResponseId: "provider-merged",
          responseId: "resp-1",
          fallbackProviders: ["bar"],
          routingAttempts: [
            { provider: "foo", success: true, durationMs: 20, costUSD: 0.05 },
          ],
          costUSD: 0.05,
        },
      }),
    ];

    const merged = buildTelemetryRecordFromSpans(spans, previous);
    expect(merged.providerResponseId).toBe("provider-merged");
    expect(merged.responseId).toBe("resp-1");
    expect(merged.fallbackProviders?.sort()).toEqual(["bar", "foo"]);
    const attempt = merged.routingAttempts?.find((item) => item.provider === "foo");
    expect(attempt?.success).toBe(true);
    expect(attempt?.durationMs).toBe(20);
    expect(attempt?.costUSD).toBe(0.05);
  });
});

describe("buildTelemetryRecords", () => {
  it("returns one record per provider key", () => {
    const spans: TelemetrySpan[] = [
      baseSpan({ traceId: "trace-1", derived: { providerResponseId: "prov-1", datasetRowId: "row-1" } }),
      baseSpan({ traceId: "trace-2", derived: { providerResponseId: "prov-2", datasetRowId: "row-2" } }),
    ];

    const records = buildTelemetryRecords(spans);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.providerResponseId).sort()).toEqual(["prov-1", "prov-2"]);
  });

  it("hydrates dataset lookup and records prompt diffs per role", () => {
    const spans: TelemetrySpan[] = [
      baseSpan({
        startTime: 0,
        endTime: 5,
        derived: {
          providerResponseId: "prov-lookup-1",
          datasetRowId: "row-lookup-1",
          promptMessages: [{ role: "system", content: "First" }],
          role: "assistant",
        },
      }),
      baseSpan({
        startTime: 10,
        endTime: 15,
        derived: {
          providerResponseId: "prov-lookup-2",
          datasetRowId: "row-lookup-2",
          promptMessages: [{ role: "system", content: "First\nSecond" }],
          role: "assistant",
        },
      }),
    ];

    const lookup = datasetLookup([
      { id: "row-lookup-1", input: "Prompt one", expectedOutput: "Expected" },
      { id: "row-lookup-2", input: "Prompt two", expectedOutput: "Expected" },
    ]);

    const records = buildTelemetryRecords(spans, lookup);
    expect(records).toHaveLength(2);
    const hydrated = records.find((record) => record.datasetRowId === "row-lookup-1");
    expect(hydrated?.datasetRowInput).toBe("Prompt one");
    const diffRecord = records.find((record) => record.datasetRowId === "row-lookup-2");
    expect(diffRecord).toBeDefined();
    expect(diffRecord?.promptDiff?.some((line) => line.type === "add")).toBe(true);
  });
});
