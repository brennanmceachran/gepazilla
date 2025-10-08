import type { GEPAResult } from "@currentai/dsts";
import type { OptimizeScorerConfig } from "@/lib/schemas";
import type { ScoreCellStatus, ScorerEvaluation } from "@/lib/scorers";

export const DATASET_KEYS = ["training", "validation"] as const;
export type DatasetKey = (typeof DATASET_KEYS)[number];

export type DatasetRow = {
  id: string;
  input: string;
  expectedOutput: string;
};

export type DatasetCollection = Record<DatasetKey, DatasetRow[]>;

export type DatasetLookupEntry = {
  key: DatasetKey;
  row: DatasetRow;
};

export type DatasetLookup = {
  byId: Map<string, DatasetLookupEntry>;
  byInput: Map<string, DatasetLookupEntry[]>;
};

export type ScoreCell = {
  preview: ScorerEvaluation;
  run?: ScorerEvaluation;
};

export type ScoreboardState = Record<string, ScoreCell>;
export type ScoreboardCollection = Record<DatasetKey, Record<string, ScoreboardState>>;

export type ScorerDiagnosticsSummaryEntry = {
  id: string;
  label: string;
  average: number | null;
  failures: number;
  total: number;
  failureRate: number | null;
  topNote?: string;
};

export type RunStatus =
  | "idle"
  | "starting"
  | "running"
  | "resuming"
  | "paused"
  | "completed"
  | "errored"
  | "aborted";

export type LogEntry = {
  level: string;
  channel: LogChannel;
  message: string;
  meta?: unknown;
  ts: number;
};

export type TelemetrySpanStatus = "success" | "error" | "partial";

export type ProviderRoutingAttempt = {
  provider: string;
  success: boolean;
  durationMs?: number;
  modelId?: string;
  credentialType?: string;
  costUSD?: number;
};

export type PromptMessage = {
  role: string;
  content: string;
};

export type PromptDiffLine = {
  type: "add" | "remove" | "context";
  text: string;
};

export type TelemetrySpanDerived = {
  modelId?: string;
  provider?: string;
  aggregator?: string;
  finishReason?: string;
  temperature?: number;
  latencyMs?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUSD?: number;
  finalProvider?: string;
  fallbackProviders?: string[];
  routingAttempts?: ProviderRoutingAttempt[];
  routingReasoning?: string;
  routingPlan?: string;
  promptSummary?: string;
  responseText?: string;
  responseId?: string;
  operationId?: string;
  iteration?: number;
  role?: string;
  promptMessages?: PromptMessage[];
  datasetRowId?: string;
  datasetRowInput?: string;
  datasetRowExpected?: string;
  providerResponseId?: string;
};

export type TelemetrySpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  status: TelemetrySpanStatus;
  attributes: Record<string, unknown>;
  errorMessage?: string;
  derived: TelemetrySpanDerived;
};

export type TelemetryRecord = {
  traceId: string;
  root: TelemetrySpan;
  children: TelemetrySpan[];
  status: TelemetrySpanStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  modelId?: string;
  provider?: string;
  aggregator?: string;
  temperature?: number;
  prompt?: string;
  response?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  fallbackProviders?: string[];
  latencyMs?: number;
  routingAttempts?: ProviderRoutingAttempt[];
  routingReasoning?: string;
  routingPlan?: string;
  responseId?: string;
  operationId?: string;
  iteration?: number;
  role?: string;
  promptMessages?: PromptMessage[];
  promptDiff?: PromptDiffLine[];
  datasetRowId?: string;
  datasetRowLabel?: string;
  datasetRowInput?: string;
  datasetRowExpected?: string;
  providerResponseId?: string;
};

export type RunStats = {
  bestScore?: number;
  iterations?: number;
  totalMetricCalls?: number;
  totalCostUSD?: number;
  hypervolume2D?: number;
  bestLatencyMs?: number;
};

export type CandidateTimelineEntry = {
  iteration: number;
  prompt: string;
  scores: Record<string, number>;
  accepted: boolean;
};

export type RunHistoryEntry = {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  label: string;
  datasetSize: number;
  bestScore?: number;
  error?: string;
  result?: GEPAResult | null;
};

export type ScoreboardRowPayload = {
  id: string;
  total: number | null;
  scorers: Record<
    string,
    {
      value: number | null;
      status: ScoreCellStatus;
      notes?: string;
    }
  >;
};

export type ScoreboardEventPayload = {
  datasets: Record<DatasetKey, ScoreboardRowPayload[]>;
};

export type SelectedRowMap = Record<DatasetKey, string | null>;

export const LOG_CHANNELS = [
  "lifecycle",
  "prompt",
  "scoring",
  "telemetry",
  "alerts",
  "misc",
] as const;

export type LogChannel = (typeof LOG_CHANNELS)[number];

export type OptimizerConfig = {
  taskModel: string;
  reflectionModel: string;
  reflectionHint?: string;
  gatewayApiKey: string;
  maxIterations: number;
  reflectionMinibatchSize: number;
  candidateSelectionStrategy: "current_best" | "pareto";
  skipPerfectScore: boolean;
  maxMetricCalls?: number;
  maxBudgetUSD?: number;
  seedSystemPrompt: string;
};

export type ReflectionExample = {
  Inputs?: {
    userMessage?: string;
    systemPrompt?: string;
    [key: string]: unknown;
  };
  "Generated Outputs"?: unknown;
  Feedback?: string;
  [key: string]: unknown;
};

export type ReflectionFeedback = {
  dataset: Record<string, ReflectionExample[]>;
  iteration: number | null;
  timestamp: number | null;
};

export type OptimizerStateSnapshot = {
  config: OptimizerConfig;
  status: RunStatus;
  logs: LogEntry[];
  selectedChannels: Set<LogChannel>;
  result: GEPAResult | null;
  error: string | null;
  currentStats: RunStats;
  runHistory: RunHistoryEntry[];
  scorers: OptimizeScorerConfig[];
  datasets: DatasetCollection;
  scoreboards: ScoreboardCollection;
  selectedRowIds: SelectedRowMap;
  activeDataset: DatasetKey;
  dockOpen: boolean;
  showDisabledScorers: boolean;
  inspectorOpen: boolean;
  telemetryEvents: TelemetrySpan[];
  telemetryRecords: TelemetryRecord[];
  candidateHistory: CandidateTimelineEntry[];
};

export type DatasetPayloadRow = {
  id?: string;
  input: string;
  expectedOutput?: string;
};

export type DatasetPayload = DatasetPayloadRow[];
