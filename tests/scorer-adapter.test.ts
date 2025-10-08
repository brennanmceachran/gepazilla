import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayProvider } from "@ai-sdk/gateway";

import { ScorerAdapter } from "@/lib/scorer-adapter";
import { createScorerConfig } from "@/lib/scorers";
import type { OptimizeScorerConfig } from "@/lib/schemas";
import type { TaskWithMeta } from "@/lib/scorer-adapter";

const evaluateMock = vi.fn<
  (tasks: TaskWithMeta<string>[], candidate: { system?: string } | null, captureTraces?: boolean) => Promise<{
    outputs: Array<string | undefined>;
    scores: number[];
    metrics: Array<{ latency_ms: number; cost_usd: number; aggregate_score?: number }>;
    trajectories: Array<Record<string, unknown>> | null;
  }>
>();

vi.mock("@currentai/dsts", () => ({
  DefaultAdapter: class {
    async evaluate(tasks: TaskWithMeta<string>[], candidate: { system?: string } | null, captureTraces?: boolean) {
      return evaluateMock(tasks, candidate, captureTraces);
    }

    makeReflectiveDataset() {
      return { fallback: true };
    }
  },
}));

vi.mock("@currentai/dsts/dist/types", () => ({}));

type AdapterOptions = ConstructorParameters<typeof ScorerAdapter>[0];

type TrajectoryStub = {
  userPrompt?: string;
  systemPrompt?: string;
  output?: string;
  scorerDiagnostics?: string[];
  [key: string]: unknown;
};

const baseTrajectories: TrajectoryStub[] = [
  { userPrompt: "u1", systemPrompt: "s1", output: "o1" },
  { userPrompt: "u2", systemPrompt: "s2", output: "o2" },
  { userPrompt: "u3", systemPrompt: "s3", output: "o3" },
  { userPrompt: "u4", systemPrompt: "s4", output: "o4" },
];

const makeTask = (): TaskWithMeta<string> => ({
  input: "Prompt",
  expectedOutput: "Answer",
  scorer: () => 0,
  __rowMeta: {
    id: "row-1",
    input: "Prompt",
    expectedOutput: "Answer",
  },
});

const adapterOptions = (overrides: Partial<AdapterOptions>): AdapterOptions => ({
  model: "test",
  modelId: "test",
  maxConcurrency: 2,
  scorers: [],
  experimentalTelemetry: undefined,
  logger: undefined,
  ...overrides,
});

afterEach(() => {
  evaluateMock.mockReset();
  vi.restoreAllMocks();
});

describe("ScorerAdapter reflective dataset", () => {
  beforeEach(() => {
    evaluateMock.mockResolvedValue({
      outputs: [],
      scores: [],
      metrics: [],
      trajectories: null,
    });
  });

  it("includes all scores below threshold", () => {
    const adapter = new ScorerAdapter(adapterOptions({ scorers: [] }));
    const dataset = adapter.makeReflectiveDataset(
      { system: "prompt" },
      {
        scores: [0.8, 0.91, 0.4, 1.0],
        outputs: [],
        trajectories: baseTrajectories as TrajectoryStub[],
        metrics: [],
      },
      ["system"],
    );

    const systemExamples = dataset.system ?? [];
    expect(systemExamples).toHaveLength(2);
    const feedback = systemExamples.map((example) => String(example.Feedback));
    expect(feedback.every((text) => text.includes("Score"))).toBe(true);
  });

  it("appends scorer diagnostics to feedback", () => {
    const adapter = new ScorerAdapter(adapterOptions({ scorers: [] }));
    const dataset = adapter.makeReflectiveDataset(
      { system: "prompt" },
      {
        scores: [0.5],
        outputs: [],
        trajectories: [
          {
            userPrompt: "u",
            systemPrompt: "s",
            output: "o",
            scorerDiagnostics: ["Exact: 0.50"],
          },
        ],
        metrics: [],
      },
      ["system"],
    );

    const feedback = dataset.system?.[0]?.Feedback as string | undefined;
    expect(feedback).toContain("Scorer diagnostics");
    expect(feedback).toContain("Exact: 0.50");
  });

  it("respects reflection sample size when all scores high", () => {
    const adapter = new ScorerAdapter(adapterOptions({ scorers: [], reflectionSampleSize: 5 }));
    const dataset = adapter.makeReflectiveDataset(
      { system: "prompt" },
      {
        scores: [0.95, 0.97, 1, 0.93],
        outputs: [],
        trajectories: baseTrajectories,
        metrics: [],
      },
      ["system"],
    );

    expect(dataset.system).toHaveLength(4);
  });

  it("samples reflections even when trajectories lack diagnostics", () => {
    const adapter = new ScorerAdapter(adapterOptions({ reflectionSampleSize: 2 }));
    const dataset = adapter.makeReflectiveDataset(
      { system: "prompt" },
      {
        scores: [0.95, 0.96],
        outputs: [],
        trajectories: [
          { userPrompt: "u1", systemPrompt: "s1" },
          { userPrompt: "u2", systemPrompt: "s2" },
        ],
        metrics: [],
      },
      ["system"],
    );

    expect(dataset.system).toHaveLength(2);
    const feedback = dataset.system?.map((example) => example.Feedback as string) ?? [];
    expect(feedback.every((text) => text.includes("Score"))).toBe(true);
  });
});

describe("ScorerAdapter evaluation", () => {
  const createAdapter = (overrides: Partial<AdapterOptions>) =>
    new ScorerAdapter(adapterOptions(overrides));

  const makeScorers = (): OptimizeScorerConfig[] => [
    createScorerConfig("exact_match", { weight: 2, enabled: true }),
    createScorerConfig("regex_presence", {
      weight: 1,
      params: { pattern: "missing" },
    }),
  ];

  it("aggregates weighted scores and diagnostics", async () => {
    evaluateMock.mockImplementation(async (tasks, candidate, captureTraces) => ({
      outputs: tasks.map(() => candidate?.system ?? ""),
      scores: [0.25],
      metrics: [{ latency_ms: 10, cost_usd: 1 }],
      trajectories: captureTraces
        ? [{ userPrompt: "Prompt", systemPrompt: "System", output: "Answer" }]
        : null,
    }));

    const adapter = createAdapter({ scorers: makeScorers(), logger: vi.fn(), maxConcurrency: 2 });

    const batch = [makeTask()];
    const result = await adapter.evaluate(batch, { system: "Answer" }, true);

    expect(result.scores[0]).toBeCloseTo((2 * 1 + 1 * 0) / 3, 5);
    expect(result.metrics?.[0].aggregate_score).toBeCloseTo(result.scores[0]);
    const trajectoryDiagnostics = (result.trajectories?.[0] as Record<string, unknown>).scorerDiagnostics;
    expect(Array.isArray(trajectoryDiagnostics)).toBe(true);
  });

  it("logs warnings when async scorer fails and preserves existing score", async () => {
    evaluateMock.mockResolvedValue({
      outputs: ["Generated"],
      scores: [0.4],
      metrics: [{ latency_ms: 5, cost_usd: 1, aggregate_score: 0.4 }],
      trajectories: null,
    });

    const scorersModule = await import("@/lib/scorers");
    vi.spyOn(scorersModule, "evaluateScorer").mockRejectedValueOnce(new Error("bad scorer"));

    const warnLogger = vi.fn();
    const adapter = createAdapter({
      scorers: [createScorerConfig("llm_rubric", { enabled: true, params: { rubric: "r" } })],
      logger: warnLogger,
    });

    const batch = [makeTask()];
    const result = await adapter.evaluate(batch, { system: "System" });

    expect(result.scores[0]).toBe(0.4);
    expect(result.metrics?.[0].aggregate_score).toBe(0.4);
    expect(warnLogger).toHaveBeenCalledWith("warn", "Scorer evaluation failed", expect.any(Object));
  });

  it("passes gateway provider and provider options into scorer evaluations", async () => {
    evaluateMock.mockResolvedValue({
      outputs: ["Generated"],
      scores: [0.5],
      metrics: [{ latency_ms: 5, cost_usd: 1, aggregate_score: 0.5 }],
      trajectories: null,
    });

    const scorersModule = await import("@/lib/scorers");
    const asyncScorerSpy = vi.spyOn(scorersModule, "evaluateScorer").mockResolvedValue({
      status: "ready",
      value: 0.9,
      notes: "ok",
    });

    const mockLanguageModel = {} as ReturnType<GatewayProvider["languageModel"]>;
    const gatewayProvider = Object.assign(
      vi.fn(() => mockLanguageModel),
      {
        languageModel: vi.fn(() => mockLanguageModel),
        textEmbeddingModel: vi.fn(),
        imageModel: vi.fn(),
        getAvailableModels: vi.fn(),
        getCredits: vi.fn(),
      },
    ) as GatewayProvider;

    const providerOptions = { gateway: { apiKey: "mock-key" } };

    const adapter = createAdapter({
      scorers: [createScorerConfig("llm_rubric", { enabled: true, params: { rubric: "grade" } })],
      logger: vi.fn(),
      providerOptions,
      gatewayProvider,
    });

    const batch = [makeTask()];
    await adapter.evaluate(batch, { system: "System prompt" });

    expect(asyncScorerSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        providerOptions,
        gatewayProvider,
      }),
    );

    asyncScorerSpy.mockRestore();
  });

  it("honours maxConcurrency when evaluating batches", async () => {
    const active = { current: 0, peak: 0 };
    evaluateMock.mockImplementation(async () => {
      active.current += 1;
      active.peak = Math.max(active.peak, active.current);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active.current -= 1;
      return {
        outputs: ["Answer"],
        scores: [0],
        metrics: [{ latency_ms: 0, cost_usd: 0 }],
        trajectories: null,
      };
    });

    const adapter = createAdapter({ scorers: [], maxConcurrency: 2 });

    const tasks = Array.from({ length: 5 }, makeTask);
    await adapter.evaluate(tasks, { system: "System" });

    expect(active.peak).toBeLessThanOrEqual(2);
  });
});
