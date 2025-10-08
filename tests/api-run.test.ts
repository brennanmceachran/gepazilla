import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as runPost } from "@/app/api/run/route";
import type { OptimizeScorerConfig } from "@/lib/schemas";
import type { TaskWithMeta } from "@/lib/scorer-adapter";

const optimizeMock = vi.hoisted(() => vi.fn<(options: Record<string, unknown>) => Promise<unknown>>());
const evaluateScorerMock = vi.hoisted(() =>
  vi.fn(async () => ({ status: "ready" as const, value: 1, notes: "ok" })),
);

vi.mock("@currentai/dsts", () => ({
  GEPA: class {
    constructor(private readonly options: Record<string, unknown>) {}

    async optimize() {
      return optimizeMock(this.options);
    }
  },
}));

const telemetryContext: { current: Record<string, unknown> | null } = { current: null };

vi.mock("@/lib/scorer-adapter", () => {
  type LoggerFn = (level: string, message: string, meta?: unknown) => Promise<void> | void;

  interface MockScorerAdapterOptions {
    scorers?: OptimizeScorerConfig[];
    logger?: LoggerFn;
  }

  class MockScorerAdapter {
    scorers: OptimizeScorerConfig[];
    logger?: LoggerFn;

    constructor(options: MockScorerAdapterOptions) {
      this.scorers = options.scorers ?? [];
      this.logger = options.logger;
    }

    setScorers(next: OptimizeScorerConfig[]) {
      this.scorers = next;
    }

    async evaluate(
      tasks: TaskWithMeta<string>[],
      candidate: { system?: string } | null,
      captureTraces?: boolean,
    ) {
      if (this.logger) {
        for (const task of tasks) {
          await this.logger("debug", "Scoring dataset row", task.__rowMeta ?? {});
        }
      }
      const outputs = tasks.map(() => candidate?.system ?? "candidate");
      const scores = tasks.map(() => 0.75);
      const metrics = tasks.map(() => ({ latency_ms: 5, cost_usd: 0.01, aggregate_score: 0.75 }));
      const trajectories = captureTraces
        ? tasks.map(() => ({ scorerDiagnostics: ["Exact match: 1.00"] }))
        : null;
      return { outputs, scores, metrics, trajectories };
    }
  }

  return {
    ScorerAdapter: MockScorerAdapter,
    telemetryRowStorage: {
      run: async <T>(meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> => {
        const previous = telemetryContext.current;
        telemetryContext.current = meta;
        try {
          return await fn();
        } finally {
          telemetryContext.current = previous;
        }
      },
      getStore: () => telemetryContext.current,
    },
  };
});

vi.mock("@/lib/telemetry", () => ({
  createTelemetrySettings: () => ({}),
}));

vi.mock("@/lib/scorers", async (original) => {
  const actual = (await original()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateScorer: evaluateScorerMock,
  };
});

afterEach(() => {
  optimizeMock.mockReset();
  evaluateScorerMock.mockClear();
});

const decoder = new TextDecoder();

interface ParsedEvent {
  type: string;
  data: unknown;
}

const withGatewayKey = (init?: RequestInit) =>
  new Request("http://localhost/api/run", {
    headers: {
      "Content-Type": "application/json",
      "X-GEPA-Gateway-Key": "test-key",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

async function readSseEvents(response: Response): Promise<ParsedEvent[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing response body");
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const blocks = text.split("\n\n").map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    let type = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const data = dataLines.length > 0 ? JSON.parse(dataLines.join("\n")) : null;
    return { type, data };
  });
}

describe("/api/run POST", () => {
  const basePayload = {
    taskModel: "model",
    reflectionModel: "reflect",
    reflectionHint: "",
    maxIterations: 1,
    reflectionMinibatchSize: 3,
    candidateSelectionStrategy: "current_best" as const,
    skipPerfectScore: false,
    seedSystemPrompt: "seed",
    maxMetricCalls: 10,
    maxBudgetUSD: 1,
    trainset: [
      { id: "row-1", input: "Prompt", expectedOutput: "Answer" },
    ],
    valset: [] as [],
    scorers: [
      {
        id: "scorer-1",
        label: "Exact",
        type: "exact_match" as const,
        enabled: true,
        weight: 1,
      },
    ],
  };

  it("streams status, result, and scoreboard events", async () => {
    const result = {
      bestCandidate: { system: "Answer" },
      history: [],
      paretoFront: [],
      iterations: 1,
      totalMetricCalls: 1,
      totalCostUSD: 0.02,
    };
    optimizeMock.mockResolvedValueOnce(result);

    const response = await runPost(
      withGatewayKey({
        method: "POST",
        body: JSON.stringify(basePayload),
      }),
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const events = await readSseEvents(response);
    expect(events[0]?.type).toBe("status");

    const resultData = events.find((event) => event.type === "result")?.data as
      | { result?: { bestCandidate?: { system?: string } } }
      | undefined;
    expect(resultData?.result?.bestCandidate?.system).toBe("Answer");

    const scoreboardData = events.find((event) => event.type === "scoreboard")?.data as
      | {
          datasets?: {
            training?: Array<{ total: number }>;
          };
        }
      | undefined;
    expect(scoreboardData?.datasets?.training).toHaveLength(1);
    expect(scoreboardData?.datasets?.training?.[0].total).toBe(1);

    const finalStatus = [...events].reverse().find((event) => event.type === "status");
    const statusData = finalStatus?.data as { status?: string } | undefined;
    expect(statusData?.status).toBe("completed");
  });

  it("emits error event when optimization fails", async () => {
    optimizeMock.mockRejectedValueOnce(new Error("optimizer exploded"));

    const response = await runPost(
      withGatewayKey({
        method: "POST",
        body: JSON.stringify(basePayload),
      }),
    );

    const events = await readSseEvents(response);
    const errorData = events.find((event) => event.type === "error")?.data as { message?: string } | undefined;
    expect(errorData?.message).toContain("optimizer exploded");
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await runPost(
      withGatewayKey({
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON payload");
  });

  it("returns 400 for schema violations", async () => {
    const invalidPayload = {
      taskModel: "model",
      reflectionModel: "reflect",
      reflectionHint: "",
      maxIterations: 1,
      reflectionMinibatchSize: 3,
      candidateSelectionStrategy: "current_best" as const,
      skipPerfectScore: false,
      seedSystemPrompt: "seed",
      trainset: [] as [],
      scorers: [] as [],
    };

    const response = await runPost(
      withGatewayKey({
        method: "POST",
        body: JSON.stringify(invalidPayload),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid configuration");
  });

  it("returns 401 when no gateway key is provided", async () => {
    const response = await runPost(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload),
      }),
    );
    expect(response.status).toBe(401);
  });
});
