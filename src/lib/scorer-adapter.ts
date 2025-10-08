import {
  DefaultAdapter,
  type DefaultAdapterOptions,
  type DefaultAdapterTask,
} from "@currentai/dsts";
import type { Candidate, EvaluationBatch } from "@currentai/dsts/dist/types";
import type { GatewayProvider } from "@ai-sdk/gateway";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { AsyncLocalStorage } from "async_hooks";

import type { OptimizeScorerConfig } from "@/lib/schemas";
import {
  evaluateScorer,
  evaluateScorerSync,
  resolvePlugin,
  type ScorerEvaluationOptions,
} from "@/lib/scorers";
import type { ScorerEvaluation } from "@/lib/scorers";
import type { GatewayProviderOptions } from "@/lib/provider-options";

export type DatasetRowMeta = {
  id: string;
  input: string;
  expectedOutput?: string;
};

export type TaskWithMeta<T = string> = DefaultAdapterTask<T> & {
  __rowMeta?: DatasetRowMeta;
};

type LoggerFn = (level: string, message: string, data?: unknown) => void;

type AdapterModel = string | LanguageModelV2;

type BaseAdapterOptions = Omit<DefaultAdapterOptions, "model" | "providerOptions" | "maxConcurrency">;

type ScorerAdapterOptions = BaseAdapterOptions & {
  model: AdapterModel;
  modelId: string;
  providerOptions?: GatewayProviderOptions;
  maxConcurrency?: number;
  scorers: OptimizeScorerConfig[];
  logger?: LoggerFn;
  reflectionSampleSize?: number;
  gatewayProvider?: GatewayProvider;
};

// AsyncLocalStorage lets us stamp the current dataset row onto telemetry spans without
// relying on mutable module-level state. Note: ALS is Node-only; if we ever port this
// adapter to a different runtime we’ll need an alternate context mechanism.
export const telemetryRowStorage = new AsyncLocalStorage<DatasetRowMeta | null>();

const resolveRowMeta = (task: TaskWithMeta<string>, index: number): DatasetRowMeta => ({
  id: task.__rowMeta?.id ?? `row-${index}`,
  input:
    task.__rowMeta?.input
    ?? (typeof task.input === "string" ? task.input : JSON.stringify(task.input)),
  expectedOutput: task.__rowMeta?.expectedOutput ?? task.expectedOutput,
});

export class ScorerAdapter extends DefaultAdapter<string> {
  private scorers: OptimizeScorerConfig[];
  private log?: LoggerFn;
  private readonly concurrency: number;
  private readonly reflectionSampleSize: number;
  private readonly adapterProviderOptions?: GatewayProviderOptions;
  private readonly gatewayProvider?: GatewayProvider;

  constructor(options: ScorerAdapterOptions) {
    const {
      model,
      modelId,
      scorers,
      logger,
      reflectionSampleSize,
      providerOptions,
      gatewayProvider,
      maxConcurrency,
      ...adapterOptions
    } = options;

    const defaultAdapterOptions: DefaultAdapterOptions = {
      ...adapterOptions,
      model: modelId,
      ...(providerOptions ? { providerOptions } : {}),
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    };

    super(defaultAdapterOptions);
    if (typeof model !== "string") {
      (this as unknown as { model: AdapterModel }).model = model;
    }
    this.scorers = scorers;
    this.log = logger;
    this.concurrency = Math.max(1, maxConcurrency ?? 10);
    const parsedSampleSize = typeof reflectionSampleSize === "number" && reflectionSampleSize > 0
      ? Math.floor(reflectionSampleSize)
      : undefined;
    this.reflectionSampleSize = Math.max(1, parsedSampleSize ?? 3);
    this.adapterProviderOptions = providerOptions;
    this.gatewayProvider = gatewayProvider;
  }

  setScorers(next: OptimizeScorerConfig[]) {
    this.scorers = next;
  }

  setLogger(logger?: LoggerFn) {
    this.log = logger;
  }

  async evaluate(
    batch: TaskWithMeta<string>[],
    candidate: Candidate,
    captureTraces = false,
  ): Promise<EvaluationBatch> {
    const singleResults: EvaluationBatch[] = new Array(batch.length);

    let cursor = 0;
    const maxWorkers = Math.min(this.concurrency, Math.max(batch.length, 1));

    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= batch.length) break;

        const task = batch[index];
        const rowMeta = resolveRowMeta(task, index);
        singleResults[index] = await telemetryRowStorage.run(rowMeta, () =>
          super.evaluate([task], candidate, captureTraces),
        );
      }
    };

    await Promise.all(Array.from({ length: maxWorkers }, () => worker()));

    const outputs: unknown[] = [];
    const scores: number[] = [];
    const metrics: Array<{ latency_ms: number; cost_usd: number; aggregate_score?: number }> = [];
    const trajectories: EvaluationBatch["trajectories"] = captureTraces ? [] : null;

    singleResults.forEach((result, index) => {
      outputs[index] = result.outputs?.[0];
      scores[index] = typeof result.scores?.[0] === "number" ? (result.scores?.[0] as number) : 0;

      const metricEntry = result.metrics?.[0];
      const latency = typeof metricEntry?.latency_ms === "number" ? metricEntry.latency_ms : 0;
      const cost = typeof metricEntry?.cost_usd === "number" ? metricEntry.cost_usd : 0;
      const aggregateScore = typeof (metricEntry as Record<string, unknown>)?.aggregate_score === "number"
        ? Number((metricEntry as Record<string, unknown>).aggregate_score)
        : undefined;
      metrics[index] = {
        latency_ms: latency,
        cost_usd: cost,
        ...(aggregateScore !== undefined ? { aggregate_score: aggregateScore } : {}),
      };

      if (captureTraces && trajectories && result.trajectories) {
        trajectories[index] = result.trajectories[0];
      }
    });

    const evaluation: EvaluationBatch = {
      outputs,
      scores,
      metrics,
      trajectories,
    };

    const activeScorers = this.scorers.filter((scorer) => scorer.enabled && scorer.weight > 0);
    if (activeScorers.length === 0) {
      return evaluation;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const task = batch[index];
      const rowMeta = resolveRowMeta(task, index);

      this.log?.("debug", "Scoring dataset row", {
        rowId: rowMeta.id,
        rowInputPreview: createPreview(rowMeta.input),
        rowExpectedPreview: rowMeta.expectedOutput ? createPreview(rowMeta.expectedOutput) : undefined,
        hasExpectedOutput: Boolean(rowMeta.expectedOutput && rowMeta.expectedOutput.length > 0),
      });

      const candidateOutput = outputs[index];
      const existingScore = typeof evaluation.scores[index] === "number" ? evaluation.scores[index] : null;

      let totalWeight = 0;
      let weightedSum = 0;
      const diagnostics: string[] = [];

      for (const scorer of activeScorers) {
        const plugin = resolvePlugin(scorer.type);
        if (!plugin) continue;

        let evaluationResult: ScorerEvaluation;
        const scorerOptions = this.buildScorerOptions();
        if (plugin.mode === "async") {
          try {
            evaluationResult = await evaluateScorer(
              scorer,
              {
                input: rowMeta.input,
                expectedOutput: rowMeta.expectedOutput,
                candidate: candidateOutput,
              },
              scorerOptions,
            );
          } catch (error) {
            evaluationResult = {
              status: "error",
              value: null,
              notes: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          evaluationResult = evaluateScorerSync(
            scorer,
            {
              input: rowMeta.input,
              expectedOutput: rowMeta.expectedOutput,
              candidate: candidateOutput,
            },
            scorerOptions,
          );
        }

        const hasNumericValue = typeof evaluationResult.value === "number";
        const numericValue = hasNumericValue ? (evaluationResult.value as number) : null;
        if (evaluationResult.status === "ready" && numericValue !== null) {
          totalWeight += scorer.weight;
          weightedSum += scorer.weight * numericValue;
        } else if (evaluationResult.status === "error") {
          void this.log?.("warn", "Scorer evaluation failed", {
            scorerId: scorer.id,
            rowId: rowMeta.id,
            notes: evaluationResult.notes,
          });
        }

        const label = (scorer.label?.trim().length ? scorer.label : plugin.defaultLabel) ?? scorer.type;
        const shouldReport =
          evaluationResult.status !== "ready"
          || numericValue === null
          || (numericValue !== null && numericValue < 0.999)
          || Boolean(evaluationResult.notes);
        if (shouldReport) {
          const valuePart = numericValue !== null ? numericValue.toFixed(2) : "—";
          let summary = `${label}: ${valuePart}`;
          if (evaluationResult.status === "error") {
            summary += evaluationResult.notes ? ` (error: ${evaluationResult.notes})` : " (error)";
          } else if (evaluationResult.notes) {
            summary += ` (${evaluationResult.notes})`;
          }
          diagnostics.push(summary);
        }
      }

      const aggregate = totalWeight > 0
        ? weightedSum / totalWeight
        : existingScore ?? 0;
      evaluation.scores[index] = aggregate;
      if (evaluation.metrics && evaluation.metrics[index]) {
        (evaluation.metrics[index] as Record<string, unknown>).aggregate_score = aggregate;
      }

      if (evaluation.trajectories && evaluation.trajectories[index]) {
        (evaluation.trajectories[index] as Record<string, unknown>).scorerDiagnostics = diagnostics;
      }
    }

    return evaluation;
  }

  makeReflectiveDataset(
    candidate: Candidate,
    evalBatch: EvaluationBatch,
    componentsToUpdate: string[],
  ) {
    if (!evalBatch.trajectories) {
      return super.makeReflectiveDataset(candidate, evalBatch, componentsToUpdate);
    }

    const dataset: Record<string, Array<Record<string, unknown>>> = {};
    for (const component of componentsToUpdate) {
      const examples: Array<Record<string, unknown>> = [];
      for (let i = 0; i < evalBatch.trajectories.length; i += 1) {
        const trace = evalBatch.trajectories[i];
        const score = evalBatch.scores[i];
        if (score < 0.9) {
          const diagnostics = Array.isArray((trace as Record<string, unknown>).scorerDiagnostics)
            ? ((trace as Record<string, unknown>).scorerDiagnostics as string[])
            : [];
          const feedbackBase = this.composeFeedback(trace, score);
          const diagnosticText = diagnostics.length > 0
            ? `${feedbackBase} | Scorer diagnostics → ${diagnostics.join("; ")}`
            : feedbackBase;
          examples.push({
            Inputs: {
              userMessage: trace.userPrompt,
              systemPrompt: trace.systemPrompt,
            },
            "Generated Outputs": trace.output || trace.error || "No output",
            Feedback: diagnosticText,
          });
        }
      }

      if (examples.length === 0 && evalBatch.trajectories.length > 0) {
        const sampleCount = Math.min(this.reflectionSampleSize, evalBatch.trajectories.length);
        for (let i = 0; i < sampleCount; i += 1) {
          const trace = evalBatch.trajectories[i];
          const score = evalBatch.scores[i];
          const diagnostics = Array.isArray((trace as Record<string, unknown>).scorerDiagnostics)
            ? ((trace as Record<string, unknown>).scorerDiagnostics as string[])
            : [];
          const feedbackBase = this.composeFeedback(trace, score);
          const diagnosticText = diagnostics.length > 0
            ? `${feedbackBase} | Scorer diagnostics → ${diagnostics.join("; ")}`
            : feedbackBase;
          examples.push({
            Inputs: {
              userMessage: trace.userPrompt,
              systemPrompt: trace.systemPrompt,
            },
            "Generated Outputs": trace.output || trace.error || "No output",
            Feedback: diagnosticText,
          });
        }
      }

      dataset[component] = examples;
    }
    if (this.log) {
      try {
        this.log("debug", "Reflection feedback dataset", {
          components: Object.keys(dataset),
          dataset,
        });
      } catch (error) {
        void this.log("warn", "Failed to log reflection feedback dataset", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return dataset;
  }

  private composeFeedback(trace: Record<string, unknown>, score: number): string {
    const parts: string[] = [];
    const error = trace.error as string | undefined;
    if (error) {
      parts.push(`Error: ${error}`);
    }
    const expected = trace.expectedOutput;
    if (expected !== undefined) {
      parts.push(`Expected: ${JSON.stringify(expected)}`);
      const got = trace.output ?? trace.error ?? null;
      if (got !== null && got !== undefined) {
        parts.push(`Got: ${JSON.stringify(got)}`);
      }
    }
    parts.push(`Score: ${score}`);
    if (score === 0 && !error) {
      parts.push("The output did not match the expected result.");
    }
    return parts.join(" | ");
  }

  private buildScorerOptions(): ScorerEvaluationOptions | undefined {
    if (!this.adapterProviderOptions && !this.gatewayProvider) return undefined;
    return {
      ...(this.adapterProviderOptions ? { providerOptions: this.adapterProviderOptions } : {}),
      ...(this.gatewayProvider ? { gatewayProvider: this.gatewayProvider } : {}),
    };
  }
}

const createPreview = (value: string, max: number = 80): string => {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
};
