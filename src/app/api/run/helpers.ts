import type { GatewayProvider } from "@ai-sdk/gateway";
import type { GatewayProviderOptions } from "@/lib/provider-options";
import type { OptimizeScorerConfig } from "@/lib/schemas";
import { evaluateScorer } from "@/lib/scorers";
import type { TaskWithMeta } from "@/lib/scorer-adapter";


export type DatasetItem = {
  id?: string;
  input: string;
  expectedOutput?: string;
};

export type DatasetRowMeta = Required<Pick<DatasetItem, "id">> & Omit<DatasetItem, "id">;

export type PreparedDataset = {
  tasks: TaskWithMeta<string>[];
  rows: DatasetRowMeta[];
};

export type ScoreCellPayload = {
  value: number | null;
  status: "idle" | "pending" | "ready" | "error";
  notes?: string;
};

export type ScoreboardRowPayload = {
  id: string;
  total: number | null;
  scorers: Record<string, ScoreCellPayload>;
};

export function parseIterationValue(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).iteration;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function updateEvaluationRole(current: string | null, message: string): string | null {
  switch (message) {
    case "Evaluating parent candidate on minibatch":
      return "parent_minibatch";
    case "Evaluating new candidate on minibatch":
      return "candidate_minibatch";
    case "Evaluating candidate on full dataset":
      return "candidate_full";
    case "Reflection feedback dataset":
    case "Using default LLM reflection":
    case "Reflective dataset created":
    case "Generating new text for component":
    case "Component text updated":
    case "Evaluation complete for reflection":
      return "reflection";
    case "Minibatch evaluation scores":
    case "Candidate evaluation complete":
      return null;
    default:
      return current;
  }
}

export function prepareDataset(items: DatasetItem[]): PreparedDataset {
  const rows: DatasetRowMeta[] = items.map((item, index) => ({
    id: item.id && item.id.length > 0 ? item.id : `row-${index}`,
    input: item.input,
    expectedOutput: item.expectedOutput,
  }));

  const tasks: TaskWithMeta<string>[] = rows.map((row) => ({
    input: row.input,
    expectedOutput: row.expectedOutput,
    scorer: () => 0,
    __rowMeta: row,
  }));

  return { tasks, rows };
}

export async function computeScoreboard(
  rows: DatasetRowMeta[],
  outputs: unknown[],
  scorers: OptimizeScorerConfig[],
  providerOptions?: GatewayProviderOptions,
  gatewayProvider?: GatewayProvider,
): Promise<ScoreboardRowPayload[]> {
  if (scorers.length === 0) return [];

  const scorerOptions =
    providerOptions || gatewayProvider
      ? {
          ...(providerOptions ? { providerOptions } : {}),
          ...(gatewayProvider ? { gatewayProvider } : {}),
        }
      : undefined;

  return Promise.all(
    rows.map(async (row, index) => {
      const generated = index < outputs.length ? outputs[index] : undefined;
      const cells: Record<string, ScoreCellPayload> = {};
      let totalWeight = 0;
      let weightedSum = 0;

      for (const scorer of scorers) {
        const isActive = scorer.enabled && scorer.weight > 0;

        if (!isActive) {
          cells[scorer.id] = {
            value: null,
            status: "idle",
            notes: "Scorer disabled",
          } satisfies ScoreCellPayload;
          continue;
        }

        const evaluation = await evaluateScorer(
          scorer,
          {
            input: row.input,
            expectedOutput: row.expectedOutput,
            candidate: generated,
          },
          scorerOptions,
        );

        const cell: ScoreCellPayload = {
          value: typeof evaluation.value === "number" ? evaluation.value : null,
          status: evaluation.status,
          notes: evaluation.notes,
        };

        if (cell.status === "ready" && typeof cell.value === "number") {
          totalWeight += scorer.weight;
          weightedSum += scorer.weight * cell.value;
        }

        cells[scorer.id] = cell;
      }

      const total = totalWeight > 0 ? weightedSum / totalWeight : null;

      return {
        id: row.id,
        total,
        scorers: cells,
      };
    }),
  );
}
