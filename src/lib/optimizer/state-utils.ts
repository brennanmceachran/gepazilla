import { DATASET_KEYS } from "@/components/optimizer/types";
import type {
  DatasetCollection,
  DatasetPayloadRow,
  DatasetRow,
  ReflectionFeedback,
  ScoreboardCollection,
  ScoreboardState,
  ScoreCell,
} from "@/components/optimizer/types";
import type { OptimizeScorerConfig } from "@/lib/schemas";
import type { ScorerEvaluation } from "@/lib/scorers";

export const mapToDatasetRows = (rows: DatasetPayloadRow[]): DatasetRow[] =>
  rows.map((row) => ({
    id: row.id && row.id.length > 0 ? row.id : crypto.randomUUID(),
    input: row.input ?? "",
    expectedOutput: row.expectedOutput ?? "",
  }));

export const sanitizeRows = (rows: DatasetRow[]): DatasetPayloadRow[] =>
  rows
    .map((row) => ({
      id: row.id,
      input: row.input.trim(),
      expectedOutput: row.expectedOutput.trim() || undefined,
    }))
    .filter((row) => row.input.length > 0);

export const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const coerceReflectionDataset = (
  value: unknown,
): ReflectionFeedback["dataset"] | null => {
  if (!value || typeof value !== "object") return null;
  const entries: Array<[string, ReflectionFeedback["dataset"][string]]> = [];
  for (const [key, rawExamples] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawExamples)) continue;
    const examples = rawExamples
      .filter((item): item is ReflectionFeedback["dataset"][string][number] =>
        Boolean(item) && typeof item === "object",
      )
      .map((item) => ({ ...(item as Record<string, unknown>) }));
    entries.push([key, examples]);
  }
  return Object.fromEntries(entries);
};

export const deriveCell = (evaluation: ScorerEvaluation, active: boolean): ScorerEvaluation => {
  if (active) return evaluation;
  if (evaluation.status === "pending") {
    return { ...evaluation, status: "idle", notes: evaluation.notes ?? "Scorer disabled" };
  }
  return { ...evaluation, notes: evaluation.notes ?? "Scorer disabled" };
};

export const emptyScoreboards = (): ScoreboardCollection => ({
  training: {},
  validation: {},
});

export const createScoreboardCollection = (
  datasets: DatasetCollection,
  scorers: OptimizeScorerConfig[],
  computePreview: (row: DatasetRow, scorer: OptimizeScorerConfig) => ScorerEvaluation,
): ScoreboardCollection => {
  const boards: ScoreboardCollection = {
    training: {},
    validation: {},
  };
  for (const key of DATASET_KEYS) {
    const rows = datasets[key];
    const map: Record<string, ScoreboardState> = {};
    for (const row of rows) {
      const rowState: ScoreboardState = {};
      for (const scorer of scorers) {
        const preview = computePreview(row, scorer);
        const active = scorer.enabled && scorer.weight > 0;
        const cell: ScoreCell = {
          preview,
          run: active ? { status: "pending", value: null, notes: "Running" } : undefined,
        };
        rowState[scorer.id] = cell;
      }
      map[row.id] = rowState;
    }
    boards[key] = map;
  }
  return boards;
};

export const resetScoreboards = (
  datasets: DatasetCollection,
  scorers: OptimizeScorerConfig[],
  computePreview: (row: DatasetRow, scorer: OptimizeScorerConfig) => ScorerEvaluation,
): ScoreboardCollection => {
  const boards: ScoreboardCollection = {
    training: {},
    validation: {},
  };
  for (const key of DATASET_KEYS) {
    const rows = datasets[key];
    const map: Record<string, ScoreboardState> = {};
    for (const row of rows) {
      const rowState: ScoreboardState = {};
      for (const scorer of scorers) {
        const cell: ScoreCell = {
          preview: computePreview(row, scorer),
          run: undefined,
        };
        rowState[scorer.id] = cell;
      }
      map[row.id] = rowState;
    }
    boards[key] = map;
  }
  return boards;
};
