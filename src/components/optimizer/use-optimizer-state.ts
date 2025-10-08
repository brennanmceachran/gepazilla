"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GEPAResult } from "@currentai/dsts";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";

import {
  defaultRequest,
  defaultScorers,
  defaultTrainset,
} from "@/lib/default-config";
import type { OptimizeRequestInput, OptimizeScorerConfig } from "@/lib/schemas";
import {
  createScorerConfig,
  evaluateScorerSync,
  listPlugins,
} from "@/lib/scorers";
import {
  coerceReflectionDataset,
  deriveCell,
  emptyScoreboards,
  mapToDatasetRows,
  numberOrUndefined,
  sanitizeRows,
  createScoreboardCollection,
  resetScoreboards,
} from "@/lib/optimizer/state-utils";
import { extractLatencyMs } from "@/lib/utils";
import type { TelemetryEvent } from "@/lib/telemetry";
import {
  buildTelemetryRecordFromSpans,
  deriveTelemetryKey,
  hydrateDatasetFromLookup,
} from "./run-dock/logs/telemetry-utils";
import { hypervolume2D } from "@currentai/dsts/dist/pareto-utils";
import type { ScorerEvaluation } from "@/lib/scorers";

import {
  DATASET_KEYS,
  type CandidateTimelineEntry,
  type DatasetCollection,
  type DatasetKey,
  type DatasetPayload,
  type DatasetPayloadRow,
  type DatasetRow,
  type LogEntry,
  LOG_CHANNELS,
  type LogChannel,
  type OptimizerConfig,
  type RunHistoryEntry,
  type RunStats,
  type ScoreCell,
  type ScoreboardCollection,
  type ScoreboardEventPayload,
  type ScoreboardState,
  type SelectedRowMap,
  type RunStatus,
  type DatasetLookup,
  type TelemetrySpan,
  type TelemetryRecord,
  type ReflectionFeedback,
  type ScorerDiagnosticsSummaryEntry,
} from "./types";
import {
  CORE_PHASES,
  OPTIONAL_PHASES,
  type OptimizerPhase,
  normalizePhaseRole,
} from "./progress-constants";

const DEBUG_TELEMETRY = process.env.NEXT_PUBLIC_DEBUG_TELEMETRY === "true";

const TELEMETRY_BUFFER_LIMIT = 200;

type TelemetrySpanInternal = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  errorMessage?: string;
};

const defaultPhaseStats = (): PhaseStats => {
  const stats: PhaseStats = Object.create(null);
  for (const phase of [...CORE_PHASES, ...OPTIONAL_PHASES] as OptimizerPhase[]) {
    stats[phase] = { total: 0, count: 0 };
  }
  return stats;
};

const accumulatePhaseDuration = (stats: PhaseStats, phase: OptimizerPhase, duration: number): PhaseStats => {
  const current = stats[phase] ?? { total: 0, count: 0 };
  return {
    ...stats,
    [phase]: {
      total: current.total + duration,
      count: current.count + 1,
    },
  };
};

const accumulateFinalizingDuration = (
  stats: { total: number; count: number },
  duration: number,
): { total: number; count: number } => ({
  total: stats.total + duration,
  count: stats.count + 1,
});

type PhaseSample = {
  iteration: number;
  phase: OptimizerPhase;
  timestamp: number;
};

type PhaseStats = Record<OptimizerPhase, { total: number; count: number }>;

type RunProgress = {
  startTime: number | null;
  iterationSamples: Array<{ iteration: number; timestamp: number }>;
  phaseSamples: PhaseSample[];
  latestPhaseByIteration: Record<number, { phase: OptimizerPhase; timestamp: number }>;
  phaseStats: PhaseStats;
  iterationStats: { total: number; count: number };
  finalizing: boolean;
  finalizingStart: number | null;
  finalizingStats: { total: number; count: number };
};

type RunOptions = {
  resumeCheckpoint?: CheckpointState;
  auto?: boolean;
};

const AUTO_RESUME_DELAYS_MS = [250, 1_000, 3_000];

const classifyLogChannel = (level: string, message: string, meta?: unknown): LogChannel => {
  const normalized = message.toLowerCase();
  if (level === "warn" || level === "error" || normalized.includes("failed") || normalized.includes("error")) {
    return "alerts";
  }
  if (
    normalized.includes("reflect")
    || normalized.includes("component text updated")
    || normalized.includes("system prompt")
  ) {
    return "prompt";
  }
  if (
    normalized.includes("scoring dataset row")
    || normalized.includes("scoreboard")
    || normalized.includes("dataset")
  ) {
    return "scoring";
  }
  if (
    normalized.includes("starting")
    || normalized.includes("optimizer")
    || normalized.includes("checkpoint")
    || normalized.includes("auto-resuming")
    || normalized.includes("candidate evaluation complete")
  ) {
    return "lifecycle";
  }
  if (meta && typeof meta === "object" && "telemetry" in (meta as Record<string, unknown>)) {
    return "telemetry";
  }
  return "misc";
};

type UseOptimizerStateResult = {
  config: OptimizerConfig;
  status: RunStatus;
  logs: LogEntry[];
  selectedChannels: Set<LogChannel>;
  result: GEPAResult | null;
  error: string | null;
  errorCode: "checkpoint_available" | null;
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
  datasetPayloads: Record<DatasetKey, DatasetPayload>;
  pluginOptions: { type: OptimizeScorerConfig["type"]; label: string }[];
  scorerAverages: Record<string, { training: number | null; validation: number | null }>;
  scorerDiagnostics: ScorerDiagnosticsSummaryEntry[];
  runProgress: RunProgress;
  telemetryEvents: TelemetrySpan[];
  telemetryRecords: TelemetryRecord[];
  candidateHistory: CandidateTimelineEntry[];
  reflectionFeedback: ReflectionFeedback;
  iterationOffset: number;
  autoResumeExhausted: boolean;
  setError: (message: string | null) => void;
  setDockOpen: (value: boolean) => void;
  setInspectorOpen: (value: boolean) => void;
  setShowDisabledScorers: (value: boolean) => void;
  setActiveDataset: (key: DatasetKey) => void;
  setSelectedChannels: (updater: (prev: Set<LogChannel>) => Set<LogChannel>) => void;
  handleConfigField: (
    field: keyof OptimizerConfig,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  handleConfigNumberField: (
    field: keyof OptimizerConfig,
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  handleConfigOptionalNumberField: (
    field: keyof OptimizerConfig,
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  updateSeedPrompt: (value: string) => void;
  updateDatasetRow: (key: DatasetKey, id: string, field: "input" | "expectedOutput", value: string) => void;
  addRow: (key: DatasetKey) => void;
  duplicateRow: (key: DatasetKey, id: string) => void;
  removeRow: (key: DatasetKey, id: string) => void;
  moveRow: (from: DatasetKey, to: DatasetKey, id: string) => void;
  quickSplit: (ratio?: number) => void;
  selectRow: (key: DatasetKey, id: string) => void;
  copyDataset: (key: DatasetKey) => Promise<void>;
  pasteDataset: (key: DatasetKey) => Promise<void>;
  addScorer: (type: OptimizeScorerConfig["type"]) => void;
  updateScorer: (id: string, update: Partial<OptimizeScorerConfig>) => void;
  updateScorerParams: (id: string, params: Record<string, unknown>) => void;
  removeScorer: (id: string) => void;
  duplicateScorer: (id: string) => void;
  latestCheckpoint: CheckpointState | null;
  startRun: (options?: RunOptions) => Promise<void>;
  resumeFromCheckpoint: () => Promise<void>;
  abortRun: () => void;
  applyScoreboardEvent: (payload: ScoreboardEventPayload) => void;
  clearScores: () => void;
  datasetLookup: DatasetLookup;
  handleTelemetryEvent: (event: TelemetryEvent) => void;
};

type UseOptimizerStateOptions = {
  hasServerGatewayKey?: boolean;
};

export const useOptimizerState = (options?: UseOptimizerStateOptions): UseOptimizerStateResult => {
  const hasServerGatewayKeyRef = useRef(Boolean(options?.hasServerGatewayKey));
  useEffect(() => {
    hasServerGatewayKeyRef.current = Boolean(options?.hasServerGatewayKey);
  }, [options?.hasServerGatewayKey]);

  const [config, setConfig] = useState<OptimizerConfig>(() => ({
    taskModel: defaultRequest.taskModel,
    reflectionModel: defaultRequest.reflectionModel,
    reflectionHint: defaultRequest.reflectionHint,
    maxIterations: defaultRequest.maxIterations,
    reflectionMinibatchSize: defaultRequest.reflectionMinibatchSize,
    candidateSelectionStrategy: defaultRequest.candidateSelectionStrategy,
    skipPerfectScore: defaultRequest.skipPerfectScore,
    maxMetricCalls: defaultRequest.maxMetricCalls,
    maxBudgetUSD: defaultRequest.maxBudgetUSD,
    seedSystemPrompt: defaultRequest.seedSystemPrompt,
    gatewayApiKey: "",
  }));
  const [status, setStatus] = useState<RunStatus>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Set<LogChannel>>(
    () => new Set<LogChannel>(["lifecycle", "prompt", "scoring", "telemetry", "alerts", "misc"]),
  );
  const [result, setResult] = useState<GEPAResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<"checkpoint_available" | null>(null);
  const [currentStats, setCurrentStats] = useState<RunStats>({});
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [scorers, setScorers] = useState<OptimizeScorerConfig[]>(() =>
    defaultScorers.map((scorer) => ({
      ...scorer,
      params: scorer.params ? { ...scorer.params } : undefined,
    })),
  );
  const [datasets, setDatasets] = useState<DatasetCollection>(() => ({
    training: mapToDatasetRows(defaultTrainset),
    validation: mapToDatasetRows(defaultRequest.valset ?? []),
  }));
  const [scoreboards, setScoreboards] = useState<ScoreboardCollection>(() => emptyScoreboards());
  const [selectedRowIds, setSelectedRowIds] = useState<SelectedRowMap>({
    training: null,
    validation: null,
  });
  const [activeDataset, setActiveDataset] = useState<DatasetKey>("training");
  const [dockOpen, setDockOpen] = useState(false);
  const [showDisabledScorers, setShowDisabledScorers] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runProgress, setRunProgress] = useState<RunProgress>({
    startTime: null,
    iterationSamples: [],
    phaseSamples: [],
    latestPhaseByIteration: {},
    phaseStats: defaultPhaseStats(),
    iterationStats: { total: 0, count: 0 },
    finalizing: false,
    finalizingStart: null,
    finalizingStats: { total: 0, count: 0 },
  });
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetrySpan[]>([]);
  const [candidateHistory, setCandidateHistory] = useState<CandidateTimelineEntry[]>([]);
  const [reflectionFeedback, setReflectionFeedback] = useState<ReflectionFeedback>({
    dataset: {},
    iteration: null,
    timestamp: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const rowSnapshotsRef = useRef<Record<DatasetKey, Map<string, { input: string; expectedOutput: string }>>>(
    {
      training: new Map(),
      validation: new Map(),
    },
  );
  const scorerSnapshotRef = useRef<Map<string, string>>(new Map());
  const telemetrySpanMapRef = useRef<Map<string, TelemetrySpanInternal>>(new Map());
  const telemetryBucketsRef = useRef<Map<string, TelemetrySpan[]>>(new Map());
  const bucketKeyBySpanIdRef = useRef<Map<string, string>>(new Map());
  const telemetryRecordMapRef = useRef<Map<string, TelemetryRecord>>(new Map());
  const datasetLookupRef = useRef<DatasetLookup>({
    byId: new Map(),
    byInput: new Map(),
  });
  const [telemetryRecords, setTelemetryRecords] = useState<TelemetryRecord[]>([]);
  const [latestCheckpoint, setLatestCheckpoint] = useState<CheckpointState | null>(null);
  const iterationOffsetRef = useRef(0);

  const latestCheckpointRef = useRef<CheckpointState | null>(null);
  const autoResumeAttemptsRef = useRef(0);

  const datasetPayloads = useMemo(
    () => ({
      training: sanitizeRows(datasets.training),
      validation: sanitizeRows(datasets.validation),
    }),
    [datasets],
  );

  const datasetLookup = useMemo<DatasetLookup>(() => {
    const byId = new Map<string, { key: DatasetKey; row: DatasetRow }>();
    const byInput = new Map<string, { key: DatasetKey; row: DatasetRow }[]>();
    for (const key of DATASET_KEYS) {
      for (const row of datasets[key]) {
        byId.set(row.id, { key, row });
        const normalized = normalizeText(row.input);
        if (normalized.length > 0) {
          const existing = byInput.get(normalized);
          if (existing) {
            existing.push({ key, row });
          } else {
            byInput.set(normalized, [{ key, row }]);
          }
        }
      }
    }
    return { byId, byInput };
  }, [datasets]);

  useEffect(() => {
    datasetLookupRef.current = datasetLookup;
    if (telemetryRecordMapRef.current.size === 0) return;
    for (const record of telemetryRecordMapRef.current.values()) {
      hydrateDatasetFromLookup(record, datasetLookup);
    }
    const sorted = Array.from(telemetryRecordMapRef.current.values())
      .sort((a, b) => {
        const aTs = a.endedAt ?? a.startedAt ?? 0;
        const bTs = b.endedAt ?? b.startedAt ?? 0;
        return bTs - aTs;
      });
    setTelemetryRecords(sorted);
  }, [datasetLookup]);

  const scorerSignatures = useMemo(() => {
    const map = new Map<string, string>();
    for (const scorer of scorers) {
      const signature = JSON.stringify({
        type: scorer.type,
        params: scorer.params ?? null,
        weight: scorer.weight,
        enabled: scorer.enabled,
      });
      map.set(scorer.id, signature);
    }
    return map;
  }, [scorers]);

  const plugins = useMemo(() => listPlugins(), []);

  const pluginOptions = useMemo(
    () => plugins.map((plugin) => ({ type: plugin.type, label: plugin.defaultLabel })),
    [plugins],
  );

  const pluginLabelMap = useMemo(() => {
    const map = new Map<OptimizeScorerConfig["type"], string>();
    for (const plugin of plugins) {
      map.set(plugin.type, plugin.defaultLabel);
    }
    return map;
  }, [plugins]);

  useEffect(() => {
    setSelectedRowIds((prev) => {
      const next: SelectedRowMap = { ...prev };
      let changed = false;
      for (const key of DATASET_KEYS) {
        const rows = datasets[key];
        const current = prev[key];
        if (rows.length === 0) {
          if (current !== null) {
            next[key] = null;
            changed = true;
          }
          continue;
        }
        if (!current || !rows.some((row) => row.id === current)) {
          next[key] = rows[0].id;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [datasets]);

  useEffect(() => {
    const currentRowId = selectedRowIds[activeDataset];
    if (!currentRowId) {
      setInspectorOpen(false);
    }
  }, [activeDataset, selectedRowIds]);

  const computePreviewEvaluation = useCallback(
    (row: DatasetRow, scorer: OptimizeScorerConfig): ScorerEvaluation => {
      const evaluation = evaluateScorerSync(scorer, {
        input: row.input,
        expectedOutput: row.expectedOutput,
        candidate: row.expectedOutput ?? "",
      });
      const active = scorer.enabled && scorer.weight > 0;
      return deriveCell(evaluation, active);
    },
    [],
  );

  useEffect(() => {
    setScoreboards((prev) => {
      const previousRowSnapshots = rowSnapshotsRef.current;
      const previousScorerSnapshots = scorerSnapshotRef.current;
      const nextRowSnapshots: Record<DatasetKey, Map<string, { input: string; expectedOutput: string }>> = {
        training: new Map(),
        validation: new Map(),
      };
      const nextScorerSnapshots = new Map(scorerSignatures);

      const next: ScoreboardCollection = emptyScoreboards();
      for (const key of DATASET_KEYS) {
        const rows = datasets[key];
        const prevMap = prev[key] ?? {};
        const map: Record<string, ScoreboardState> = {};
        for (const row of rows) {
          const prevRow = prevMap[row.id];
          const previousRowSignature = previousRowSnapshots[key]?.get(row.id);
          const rowUnchanged =
            Boolean(previousRowSignature)
            && previousRowSignature?.input === row.input
            && (previousRowSignature?.expectedOutput ?? "") === row.expectedOutput;

          nextRowSnapshots[key].set(row.id, {
            input: row.input,
            expectedOutput: row.expectedOutput,
          });

          const rowScores: ScoreboardState = {};
          for (const scorer of scorers) {
            const preview = computePreviewEvaluation(row, scorer);
            const prevCell = prevRow?.[scorer.id];
            const scorerSignature = scorerSignatures.get(scorer.id);
            const prevScorerSignature = previousScorerSnapshots.get(scorer.id);
            const scorerUnchanged = scorerSignature === prevScorerSignature;
            const keepRun = rowUnchanged && scorerUnchanged;
            const run = keepRun ? prevCell?.run : undefined;
            rowScores[scorer.id] = { preview, run } satisfies ScoreCell;
          }
          map[row.id] = rowScores;
        }
        next[key] = map;
      }

      rowSnapshotsRef.current = nextRowSnapshots;
      scorerSnapshotRef.current = nextScorerSnapshots;

      return next;
    });
  }, [computePreviewEvaluation, datasets, scorerSignatures, scorers]);

  const scorerAverages = useMemo(() => {
    const result: Record<string, { training: number | null; validation: number | null }> = {};
    for (const scorer of scorers) {
      result[scorer.id] = { training: null, validation: null };
      for (const key of DATASET_KEYS) {
        const rows = datasets[key];
        const map = scoreboards[key];
        let sum = 0;
        let count = 0;
        for (const row of rows) {
          const cell = map[row.id]?.[scorer.id];
          const evaluation = cell?.run ?? cell?.preview;
          if (evaluation?.status === "ready" && typeof evaluation.value === "number") {
            sum += evaluation.value;
            count += 1;
          }
        }
        result[scorer.id][key] = count > 0 ? sum / count : null;
      }
    }
    return result;
  }, [datasets, scoreboards, scorers]);

  const scorerDiagnostics = useMemo<ScorerDiagnosticsSummaryEntry[]>(() => {
    const summaries: ScorerDiagnosticsSummaryEntry[] = [];
    const failureThreshold = 0.5;
    for (const scorer of scorers) {
      let counted = 0;
      let failures = 0;
      let readySum = 0;
      let readyCount = 0;
      const noteCounts = new Map<string, number>();

      for (const key of DATASET_KEYS) {
        const rows = datasets[key];
        const scoreboardRows = scoreboards[key];
        for (const row of rows) {
          const cell = scoreboardRows[row.id]?.[scorer.id];
          const evaluation = cell?.run;
          if (!evaluation) continue;
          if (evaluation.status === "idle" || evaluation.status === "pending") continue;

          counted += 1;

          if (evaluation.status === "ready" && typeof evaluation.value === "number") {
            readySum += evaluation.value;
            readyCount += 1;
            if (evaluation.value < failureThreshold) {
              failures += 1;
              if (evaluation.notes) {
                noteCounts.set(evaluation.notes, (noteCounts.get(evaluation.notes) ?? 0) + 1);
              }
            }
          } else {
            failures += 1;
            if (evaluation.notes) {
              noteCounts.set(evaluation.notes, (noteCounts.get(evaluation.notes) ?? 0) + 1);
            }
          }
        }
      }

      if (counted === 0 && readyCount === 0) continue;

      let topNote: string | undefined;
      let topCount = 0;
      for (const [note, count] of noteCounts.entries()) {
        if (!note) continue;
        if (count > topCount) {
          topNote = note;
          topCount = count;
        }
      }

      summaries.push({
        id: scorer.id,
        label: scorer.label?.trim() || pluginLabelMap.get(scorer.type) || scorer.type,
        average: readyCount > 0 ? readySum / readyCount : null,
        failures,
        total: counted,
        failureRate: counted > 0 ? failures / counted : null,
        topNote,
      });
    }

    return summaries
      .filter((entry) => entry.total > 0)
      .sort((a, b) => {
        const aRate = a.failureRate ?? 0;
        const bRate = b.failureRate ?? 0;
        if (bRate !== aRate) return bRate - aRate;
        const aAverage = a.average ?? 0;
        const bAverage = b.average ?? 0;
        return aAverage - bAverage;
      });
  }, [datasets, pluginLabelMap, scoreboards, scorers]);

  const updateDataset = useCallback(
    (key: DatasetKey, updater: (rows: DatasetRow[]) => DatasetRow[]) => {
      setDatasets((prev) => ({
        ...prev,
        [key]: updater(prev[key]),
      }));
    },
    [],
  );

  const updateDatasetRow = useCallback(
    (key: DatasetKey, id: string, field: "input" | "expectedOutput", value: string) => {
      updateDataset(key, (rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    },
    [updateDataset],
  );

  const addRow = useCallback(
    (key: DatasetKey) => {
      updateDataset(key, (rows) => [
        ...rows,
        {
          id: crypto.randomUUID(),
          input: "",
          expectedOutput: "",
        },
      ]);
    },
    [updateDataset],
  );

  const duplicateRow = useCallback(
    (key: DatasetKey, id: string) => {
      updateDataset(key, (rows) => {
        const idx = rows.findIndex((row) => row.id === id);
        if (idx === -1) return rows;
        const copy = { ...rows[idx], id: crypto.randomUUID() };
        const next = [...rows];
        next.splice(idx + 1, 0, copy);
        return next;
      });
    },
    [updateDataset],
  );

  const removeRow = useCallback(
    (key: DatasetKey, id: string) => {
      updateDataset(key, (rows) => rows.filter((row) => row.id !== id));
    },
    [updateDataset],
  );

  const moveRow = useCallback(
    (from: DatasetKey, to: DatasetKey, id: string) => {
      if (from === to) return;
      let moved: DatasetRow | undefined;
      updateDataset(from, (rows) => {
        const next = rows.filter((row) => {
          if (row.id === id) {
            moved = row;
            return false;
          }
          return true;
        });
        return next;
      });
      if (moved) {
        updateDataset(to, (rows) => [...rows, moved!]);
        setActiveDataset(to);
      }
    },
    [updateDataset],
  );

  const quickSplit = useCallback(
    (ratio = 0.8) => {
      setDatasets((prev) => {
        const rows = [...prev.training];
        if (rows.length < 2) return prev;
        const shuffled = [...rows].sort(() => Math.random() - 0.5);
        const cut = Math.max(1, Math.floor(shuffled.length * ratio));
        return {
          training: shuffled.slice(0, cut),
          validation: [...prev.validation, ...shuffled.slice(cut)],
        } satisfies DatasetCollection;
      });
      setActiveDataset("training");
    },
    []);

  const selectRow = useCallback(
    (key: DatasetKey, id: string) => {
      setSelectedRowIds((prev) => ({ ...prev, [key]: id }));
      setActiveDataset(key);
      setInspectorOpen(true);
    },
    []);

  const copyDataset = useCallback(async (key: DatasetKey) => {
    const payload = datasetPayloads[key];
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [datasetPayloads]);

  const pasteDataset = useCallback(async (key: DatasetKey) => {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Clipboard data must be an array");
    }
    const mapped = parsed.map((item: DatasetPayloadRow) => ({
      id: crypto.randomUUID(),
      input: typeof item.input === "string" ? item.input : String(item.input ?? ""),
      expectedOutput: typeof item.expectedOutput === "string"
        ? item.expectedOutput
        : item.expectedOutput
          ? String(item.expectedOutput)
          : "",
    }));
    if (mapped.length === 0) {
      throw new Error("Clipboard array is empty");
    }
    setDatasets((prev) => ({ ...prev, [key]: mapped }));
  }, []);

  const createOptimizePayload = useCallback((): OptimizeRequestInput => {
    const { gatewayApiKey: _gatewayApiKey, ...configWithoutKey } = config;
    void _gatewayApiKey;
    return {
      ...(configWithoutKey as Omit<OptimizerConfig, "gatewayApiKey">),
      maxBudgetUSD: config.maxBudgetUSD,
      trainset: datasetPayloads.training,
      valset: datasetPayloads.validation.length > 0 ? datasetPayloads.validation : undefined,
      scorers,
    } satisfies OptimizeRequestInput;
  }, [config, datasetPayloads, scorers]);

  const handleConfigField = useCallback(
    (field: keyof OptimizerConfig) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const value = target.type === "checkbox"
          ? (target as HTMLInputElement).checked
          : target.value;
        setConfig((prev) => ({
          ...prev,
          [field]: value,
        }));
      },
    [],
  );

  const handleConfigNumberField = useCallback(
    (field: keyof OptimizerConfig) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const parsed = Number.parseInt(event.target.value, 10);
        if (Number.isNaN(parsed)) return;
        setConfig((prev) => ({
          ...prev,
          [field]: parsed,
        }));
      },
    [],
  );

  const handleConfigOptionalNumberField = useCallback(
    (field: keyof OptimizerConfig) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const parsed = numberOrUndefined(event.target.value);
        setConfig((prev) => ({
          ...prev,
          [field]: parsed,
        }));
      },
    [],
  );

  const updateSeedPrompt = useCallback((value: string) => {
    setConfig((prev) => ({ ...prev, seedSystemPrompt: value }));
  }, []);

  const addScorer = useCallback(
    (type: OptimizeScorerConfig["type"]) => {
      setScorers((prev) => [...prev, createScorerConfig(type)]);
    },
    [],
  );

  const updateScorer = useCallback(
    (id: string, update: Partial<OptimizeScorerConfig>) => {
      setScorers((prev) => prev.map((scorer) => (scorer.id === id ? { ...scorer, ...update } : scorer)));
    },
    [],
  );

  const updateScorerParams = useCallback(
    (id: string, params: Record<string, unknown>) => {
      setScorers((prev) =>
        prev.map((scorer) => (scorer.id === id ? { ...scorer, params: { ...scorer.params, ...params } } : scorer)),
      );
    },
    [],
  );

  const removeScorer = useCallback(
    (id: string) => {
      setScorers((prev) => prev.filter((scorer) => scorer.id !== id));
    },
    [],
  );

  const duplicateScorer = useCallback(
    (id: string) => {
      setScorers((prev) => {
        const target = prev.find((scorer) => scorer.id === id);
        if (!target) return prev;
        const copy = createScorerConfig(target.type, {
          enabled: target.enabled,
          weight: target.weight,
          params: target.params,
          label: `${target.label} copy`,
        });
        return [...prev, copy];
      });
    },
    [],
  );

  const upsertTelemetryRecord = useCallback((span: TelemetrySpan) => {
    const buckets = telemetryBucketsRef.current;
    const spanKeyMap = bucketKeyBySpanIdRef.current;
    const primaryKey = deriveTelemetryKey(span);
    const existingKey = spanKeyMap.get(span.spanId);
    let key = existingKey ?? primaryKey;
    if (!key) {
      key = span.traceId ? `trace:${span.traceId}` : `span:${span.spanId}`;
    }

    if (existingKey && primaryKey && existingKey !== primaryKey) {
      const oldBucket = buckets.get(existingKey) ?? [];
      buckets.delete(existingKey);
      const migrated = [...oldBucket];
      buckets.set(primaryKey, migrated);
      telemetryBucketsRef.current = buckets;
      const existingRecord = telemetryRecordMapRef.current.get(existingKey);
      if (existingRecord) {
        telemetryRecordMapRef.current.delete(existingKey);
        telemetryRecordMapRef.current.set(primaryKey, existingRecord);
      }
      for (const migratedSpan of migrated) {
        spanKeyMap.set(migratedSpan.spanId, primaryKey);
      }
      key = primaryKey;
    } else {
      spanKeyMap.set(span.spanId, key);
    }

    const bucket = buckets.get(key) ?? [];
    const existingIndex = bucket.findIndex((item) => item.spanId === span.spanId && item.traceId === span.traceId);
    if (existingIndex !== -1) {
      bucket[existingIndex] = span;
    } else {
      bucket.push(span);
    }
    buckets.set(key, bucket);

    const previous = telemetryRecordMapRef.current.get(key);
    const record = buildTelemetryRecordFromSpans(bucket, previous);
    hydrateDatasetFromLookup(record, datasetLookupRef.current);
    telemetryRecordMapRef.current.set(key, record);

    if (DEBUG_TELEMETRY) {
      console.debug("[telemetry-state:upsert]", {
        key,
        spanId: span.spanId,
        traceId: span.traceId,
        response: record.response,
        bucketSize: bucket.length,
      });
    }

    let entries = Array.from(telemetryRecordMapRef.current.entries())
      .sort(([, a], [, b]) => {
        const aTs = a.endedAt ?? a.startedAt ?? 0;
        const bTs = b.endedAt ?? b.startedAt ?? 0;
        return bTs - aTs;
      });

    if (entries.length > TELEMETRY_BUFFER_LIMIT) {
      const keep = entries.slice(0, TELEMETRY_BUFFER_LIMIT);
      const keepKeys = new Set(keep.map(([entryKey]) => entryKey));
      telemetryRecordMapRef.current = new Map(keep);
      const nextBuckets = new Map<string, TelemetrySpan[]>();
      const nextSpanKeyMap = new Map<string, string>();
      for (const keepKey of keepKeys) {
        const spansForKey = buckets.get(keepKey);
        if (spansForKey) {
          nextBuckets.set(keepKey, spansForKey);
          for (const mappedSpan of spansForKey) {
            nextSpanKeyMap.set(mappedSpan.spanId, keepKey);
          }
        }
      }
      telemetryBucketsRef.current = nextBuckets;
      bucketKeyBySpanIdRef.current = nextSpanKeyMap;
      entries = keep;
    }

    setTelemetryRecords(entries.map(([, value]) => value));
  }, []);

  const pushTelemetrySpan = useCallback((span: TelemetrySpanInternal) => {
    const finalized = buildTelemetrySpan(span);
    setTelemetryEvents((prev) => {
      const index = prev.findIndex((item) => item.spanId === finalized.spanId && item.traceId === finalized.traceId);
      if (index !== -1) {
        const next = [...prev];
        next[index] = finalized;
        return next;
      }
      const next = [...prev, finalized];
      if (next.length > TELEMETRY_BUFFER_LIMIT) {
        return next.slice(next.length - TELEMETRY_BUFFER_LIMIT);
      }
      return next;
    });

    const derived = finalized.derived ?? {};
    const phase = normalizePhaseRole((derived as { role?: string }).role);
    const rawIteration = (derived as { iteration?: number }).iteration;
    if (phase && typeof rawIteration === "number" && Number.isFinite(rawIteration)) {
      const iteration = Math.max(0, Math.round(rawIteration));
      const timestamp = finalized.endTime ?? finalized.startTime ?? Date.now();
      setRunProgress((prev) => {
        if (!prev.startTime) return prev;
        if (prev.phaseSamples.some((sample) => sample.iteration === iteration && sample.phase === phase)) {
          return prev;
        }
        const nextSamples = [...prev.phaseSamples, { iteration, phase, timestamp } satisfies PhaseSample].sort(
          (a, b) => (a.iteration === b.iteration ? a.timestamp - b.timestamp : a.iteration - b.iteration),
        );
        const previousPhaseEntry = prev.latestPhaseByIteration[iteration];
        let phaseStats = prev.phaseStats;
        if (previousPhaseEntry) {
          const duration = Math.max(0, timestamp - previousPhaseEntry.timestamp);
          if (duration > 0) {
            phaseStats = accumulatePhaseDuration(phaseStats, previousPhaseEntry.phase, duration);
          }
        }
        const latestPhaseByIteration = {
          ...prev.latestPhaseByIteration,
          [iteration]: { phase, timestamp },
        };
        return {
          ...prev,
          phaseSamples: nextSamples,
          latestPhaseByIteration,
          phaseStats,
        } satisfies RunProgress;
      });
    }
    upsertTelemetryRecord(finalized);
  }, [upsertTelemetryRecord]);

  const handleTelemetryEvent = useCallback(
    (event: TelemetryEvent) => {
      if (!event || typeof event !== "object") return;

      const map = telemetrySpanMapRef.current;
      const existing = map.get(event.spanId) ?? {
        traceId: event.traceId,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId,
        name: event.name,
        attributes: {} as Record<string, unknown>,
      } satisfies TelemetrySpanInternal;

      const mergedAttributes = { ...existing.attributes };
      if (event.attributes && typeof event.attributes === "object") {
        Object.assign(mergedAttributes, event.attributes);
      }

      const timestamp = typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
        ? event.timestamp
        : undefined;

      let startTime = existing.startTime;
      if (event.status === "start" && timestamp !== undefined) {
        startTime = timestamp;
      } else if (startTime === undefined && timestamp !== undefined && event.status !== "end") {
        startTime = timestamp;
      }

      let endTime = existing.endTime;
      let durationMs = existing.durationMs;
      if (event.status === "end") {
        if (timestamp !== undefined) endTime = timestamp;
        if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
          durationMs = event.durationMs;
        } else if (startTime !== undefined && endTime !== undefined) {
          durationMs = Math.max(0, endTime - startTime);
        }
      }

      let errorMessage = existing.errorMessage;
      if (event.status === "error") {
        errorMessage = event.errorMessage ?? existing.errorMessage ?? "Telemetry span error";
      }

      const updated: TelemetrySpanInternal = {
        traceId: event.traceId ?? existing.traceId,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId ?? existing.parentSpanId,
        name: event.name ?? existing.name,
        startTime,
        endTime,
        durationMs,
        attributes: mergedAttributes,
        errorMessage,
      };

      if (event.status === "end") {
        map.delete(event.spanId);
        pushTelemetrySpan(updated);
        return;
      }

      map.set(event.spanId, updated);

      if (event.status === "error") {
        pushTelemetrySpan(updated);
        setLogs((prev) => [
          ...prev,
          {
            level: "error",
            channel: "alerts",
            message: `Telemetry span ${updated.name} failed`,
            meta: {
              spanId: updated.spanId,
              traceId: updated.traceId,
              error: updated.errorMessage,
            },
            ts: Date.now(),
          },
        ]);
      }
    },
    [pushTelemetrySpan, setLogs],
  );

  const applyScoreboardEvent = useCallback((payload: ScoreboardEventPayload) => {
    setScoreboards((prev) => {
      const next: ScoreboardCollection = emptyScoreboards();
      for (const key of DATASET_KEYS) {
        const datasetRows = datasets[key];
        const prevMap = prev[key] ?? {};
        const nextMap: Record<string, ScoreboardState> = {};
        const rows = payload.datasets[key] ?? [];
        const rowMap = new Map(rows.map((row) => [row.id, row]));
        for (const row of datasetRows) {
          const prevRow = prevMap[row.id];
          const existing = prevRow ?? {};
          const eventRow = rowMap.get(row.id);
          const rowState: ScoreboardState = {};
          for (const scorer of scorers) {
            const preview = existing[scorer.id]?.preview ?? computePreviewEvaluation(row, scorer);
            const eventCell = eventRow?.scorers[scorer.id];
            const run: ScorerEvaluation | undefined = eventCell
              ? {
                  status: eventCell.status,
                  value: eventCell.value,
                  notes: eventCell.notes,
                }
              : existing[scorer.id]?.run;
            rowState[scorer.id] = { preview, run } satisfies ScoreCell;
          }
          nextMap[row.id] = rowState;
        }
        next[key] = nextMap;
      }
      return next;
    });
  }, [computePreviewEvaluation, datasets, scorers]);

  const clearScores = useCallback(() => {
    setScoreboards(() => resetScoreboards(datasets, scorers, computePreviewEvaluation));
  }, [computePreviewEvaluation, datasets, scorers]);

  const updateRunHistory = useCallback(
    (runId: string, updater: (entry: RunHistoryEntry) => RunHistoryEntry) => {
      setRunHistory((prev) => prev.map((entry) => (entry.id === runId ? updater(entry) : entry)));
    },
    [],
  );

  const startRun = useCallback(async (options?: RunOptions) => {
    if (!options?.resumeCheckpoint && status === "running") return;
    if (datasetPayloads.training.length === 0) return;
    const resumeCheckpoint = options?.resumeCheckpoint ?? null;
    const isResume = Boolean(resumeCheckpoint);
    const autoResume = options?.auto ?? false;
    const runId = isResume && currentRunIdRef.current ? currentRunIdRef.current : crypto.randomUUID();
    const startedAt = Date.now();

    const providedGatewayKey = config.gatewayApiKey?.trim() ?? "";
    const hasAnyGatewayKey = providedGatewayKey.length > 0 || hasServerGatewayKeyRef.current;
    if (!hasAnyGatewayKey) {
      setError("Add an AI Gateway API key in the Run dock or set AI_GATEWAY_API_KEY before starting GEPA.");
      setErrorCode(null);
      setDockOpen(true);
      return;
    }
    if (!isResume) {
      iterationOffsetRef.current = 0;
      setStatus("starting");
      setError(null);
      setErrorCode(null);
      setResult(null);
      setLogs([]);
      setCurrentStats({});
      setRunProgress({
        startTime: startedAt,
        iterationSamples: [{ iteration: 0, timestamp: startedAt }],
        phaseSamples: [],
        latestPhaseByIteration: {},
        phaseStats: defaultPhaseStats(),
        iterationStats: { total: 0, count: 0 },
        finalizing: false,
        finalizingStart: null,
        finalizingStats: { total: 0, count: 0 },
      });
      setTelemetryEvents([]);
      setCandidateHistory([]);
      setReflectionFeedback({ dataset: {}, iteration: null, timestamp: null });
      telemetrySpanMapRef.current.clear();
      telemetryBucketsRef.current.clear();
      bucketKeyBySpanIdRef.current.clear();
      telemetryRecordMapRef.current.clear();
      setTelemetryRecords([]);
      latestCheckpointRef.current = null;
      setLatestCheckpoint(null);
      autoResumeAttemptsRef.current = 0;
    } else {
      setStatus(autoResume ? "resuming" : "starting");
      setError(null);
      setErrorCode(null);
      if (resumeCheckpoint) {
        const resumeIteration = typeof resumeCheckpoint.iteration === "number"
          ? resumeCheckpoint.iteration
          : Number(resumeCheckpoint.iteration);
        if (Number.isFinite(resumeIteration)) {
          iterationOffsetRef.current = Math.max(iterationOffsetRef.current, Math.floor(resumeIteration));
        }
      }
      if (!autoResume && resumeCheckpoint) {
        setLogs((prev) => [
          ...prev,
          {
            level: "info",
            channel: "lifecycle",
            message: `Resuming from checkpoint at iteration ${resumeCheckpoint.iteration}`,
            ts: Date.now(),
          },
        ]);
      }
    }

    currentRunIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;

    if (!isResume) {
      setRunHistory((prev) => [
        {
          id: runId,
          startedAt,
          status: "starting",
          datasetSize: datasetPayloads.training.length,
          label: `Run ${prev.length + 1}`,
        },
        ...prev,
      ]);
    } else {
      updateRunHistory(runId, (entry) => ({
        ...entry,
        status: "starting",
        error: undefined,
      }));
    }

    if (!isResume) {
      setScoreboards(() => createScoreboardCollection(datasets, scorers, computePreviewEvaluation));
    }

    const basePayload = createOptimizePayload();
    const payload: OptimizeRequestInput = resumeCheckpoint
      ? {
          ...basePayload,
          resumeCheckpoint: JSON.stringify(resumeCheckpoint),
          resumeMetadata: {
            previousIterations: resumeCheckpoint.iteration,
          },
        }
      : basePayload;

    let endedWithError = false;
    let aborted = false;
    let latestResult: GEPAResult | null = null;
    let finalize = true;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (providedGatewayKey) {
        headers["X-GEPA-Gateway-Key"] = providedGatewayKey;
      }

      const response = await fetch("/api/run", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Run failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Response body missing");
      }

      setStatus("running");
      setDockOpen(true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processEvent = (raw: string) => {
        if (!raw.trim()) return;

        let eventLabel = "";
        const dataLines: string[] = [];

        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("event:")) {
            eventLabel = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            dataLines.push(trimmed.slice(5).trim());
          } else if (!trimmed.startsWith(":")) {
            dataLines.push(trimmed);
          }
        }

        const payloadString = dataLines.length > 0 ? dataLines.join("\n") : raw.trim();
        if (!payloadString) return;

        try {
          const event = JSON.parse(payloadString) as Record<string, unknown>;
          const type = String(event.type ?? eventLabel ?? "");
          switch (type) {
            case "checkpoint": {
              const checkpoint = event.checkpoint as CheckpointState | undefined;
              if (checkpoint && typeof checkpoint.iteration === "number") {
                latestCheckpointRef.current = checkpoint;
                setLatestCheckpoint(checkpoint);
                iterationOffsetRef.current = Math.max(iterationOffsetRef.current, Math.floor(checkpoint.iteration));
                setCurrentStats((prev) => ({
                  ...prev,
                  iterations: Math.max(prev.iterations ?? 0, checkpoint.iteration),
                  totalMetricCalls: typeof checkpoint.totalMetricCalls === "number"
                    ? Math.max(prev.totalMetricCalls ?? 0, checkpoint.totalMetricCalls)
                    : prev.totalMetricCalls,
                  totalCostUSD: typeof checkpoint.totalCostUSD === "number"
                    ? Math.max(prev.totalCostUSD ?? 0, checkpoint.totalCostUSD)
                    : prev.totalCostUSD,
                }));
                setRunProgress((prev) => {
                  const ts = typeof event.ts === "number" ? event.ts : Date.now();
                  const hasSample = prev.iterationSamples.some((sample) => sample.iteration === checkpoint.iteration);
                  const iterationSamples = hasSample
                    ? prev.iterationSamples
                    : [...prev.iterationSamples, { iteration: checkpoint.iteration, timestamp: ts }]
                        .sort((a, b) => a.iteration - b.iteration);
                  return {
                    ...prev,
                    iterationSamples,
                  } satisfies RunProgress;
                });
                const iteration = checkpoint.iteration;
                setLogs((prev) => [
                  ...prev,
                  {
                    level: "info",
                    channel: "lifecycle",
                    message: `Checkpoint saved at iteration ${iteration}`,
                    ts: typeof event.ts === "number" ? event.ts : Date.now(),
                  },
                ]);
              }
              break;
            }
            case "archive": {
              // Archive records describe optimizer history; surface them as logs for now.
              const archiveRecord = event.record as { iteration?: number; event?: string } | undefined;
              if (archiveRecord) {
                const iteration = typeof archiveRecord.iteration === "number" ? archiveRecord.iteration : "?";
                const label = typeof archiveRecord.event === "string" ? archiveRecord.event : "event";
                setLogs((prev) => [
                  ...prev,
                  {
                    level: "debug",
                    channel: "prompt",
                    message: `Archive ${label} • iteration ${iteration}`,
                    ts: typeof event.ts === "number" ? event.ts : Date.now(),
                  },
                ]);
              }
              break;
            }
            case "log": {
              const rawChannel = typeof event.channel === "string" ? event.channel : undefined;
              const level = String(event.level ?? "info");
              const entry: LogEntry = {
                level,
                channel: rawChannel && LOG_CHANNELS.includes(rawChannel as LogChannel)
                  ? (rawChannel as LogChannel)
                  : classifyLogChannel(level, String(event.message ?? ""), event.meta),
                message: String(event.message ?? ""),
                meta: event.meta,
                ts: typeof event.ts === "number" ? event.ts : Date.now(),
              };
              setLogs((prev) => [...prev, entry]);
              if (entry.message === "Reflection feedback dataset" && entry.meta && typeof entry.meta === "object") {
                const dataset = coerceReflectionDataset((entry.meta as Record<string, unknown>).dataset);
                if (dataset) {
                  const iteration = extractIteration(entry.meta);
                  setReflectionFeedback({
                    dataset,
                    iteration,
                    timestamp: entry.ts,
                  });
                }
              }
              const metaIteration = extractIteration(event.meta);
              const shouldRecordIteration =
                typeof entry.message === "string" && entry.message === "Candidate evaluation complete";
              if (metaIteration !== null && shouldRecordIteration) {
                setRunProgress((prev) => recordIterationSample(prev, metaIteration, entry.ts));
              }
              break;
            }
            case "status": {
              const nextStatus = String(event.status ?? "");
              if (nextStatus === "completed") {
                setStatus("completed");
                updateRunHistory(runId, (entry) => ({
                  ...entry,
                  status: "completed",
                  finishedAt: typeof event.ts === "number" ? event.ts : Date.now(),
                }));
                const completedTs = typeof event.ts === "number" ? event.ts : Date.now();
                setRunProgress((prev) => {
                  if (!prev.startTime) return prev;
                  let finalizingStats = prev.finalizingStats;
                  if (prev.finalizing && prev.finalizingStart) {
                    const duration = Math.max(0, completedTs - prev.finalizingStart);
                    if (duration > 0) {
                      finalizingStats = accumulateFinalizingDuration(finalizingStats, duration);
                    }
                  }
                  return {
                    ...prev,
                    finalizing: false,
                    finalizingStart: null,
                    finalizingStats,
                  } satisfies RunProgress;
                });
              } else if (nextStatus === "started") {
                setStatus("running");
                updateRunHistory(runId, (entry) => ({ ...entry, status: "running" }));
              } else if (nextStatus === "errored" || nextStatus === "aborted") {
                setRunProgress((prev) => ({
                  ...prev,
                  finalizing: false,
                  finalizingStart: null,
                } satisfies RunProgress));
              }
              break;
            }
            case "result": {
              const gepaResult = event.result as GEPAResult;
              latestResult = gepaResult;
              setResult(gepaResult);
              setCandidateHistory(deriveCandidateTimeline(gepaResult));
              const resultTs = typeof event.ts === "number" ? event.ts : Date.now();
              setRunProgress((prev) => {
                if (!prev.startTime) return prev;
                return {
                  ...prev,
                  finalizing: true,
                  finalizingStart: resultTs,
                } satisfies RunProgress;
              });

              const statsCandidate: RunStats = {
                bestScore: typeof gepaResult?.bestScore === "number" ? gepaResult.bestScore : undefined,
                iterations: typeof gepaResult?.iterations === "number" ? gepaResult.iterations : undefined,
                totalMetricCalls:
                  typeof gepaResult?.totalMetricCalls === "number" ? gepaResult.totalMetricCalls : undefined,
                totalCostUSD:
                  typeof gepaResult?.totalCostUSD === "number" ? gepaResult.totalCostUSD : undefined,
              };

              if (Array.isArray(gepaResult?.paretoFront) && gepaResult.paretoFront.length > 0) {
                const hv = hypervolume2D(
                  gepaResult.paretoFront
                    .map((entry) => entry.scores)
                    .filter((scores) => scores && typeof scores === "object"),
                );
                if (typeof hv === "number" && Number.isFinite(hv)) {
                  statsCandidate.hypervolume2D = hv;
                }
              }

              const latencyMs = extractLatencyMs(gepaResult);
              if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
                statsCandidate.bestLatencyMs = latencyMs;
              }

              setCurrentStats(statsCandidate);
              const rawBestScore = gepaResult?.bestCandidate?.score;
              const maybeScore =
                typeof rawBestScore === "number"
                  ? rawBestScore
                  : typeof rawBestScore === "string"
                    ? Number.parseFloat(rawBestScore)
                    : undefined;
              updateRunHistory(runId, (entry) => ({
                ...entry,
                bestScore:
                  typeof maybeScore === "number" && Number.isFinite(maybeScore)
                    ? maybeScore
                    : entry.bestScore,
                result: gepaResult,
              }));
              break;
            }
            case "scoreboard": {
              applyScoreboardEvent(event as ScoreboardEventPayload);
              const scoreboardTs = typeof event.ts === "number" ? event.ts : Date.now();
              setRunProgress((prev) => {
                if (!prev.startTime) return prev;
                const iterationCount =
                  typeof latestResult?.iterations === "number" && Number.isFinite(latestResult.iterations)
                    ? latestResult.iterations
                    : null;
                let updated = prev;
                if (iterationCount !== null) {
                  updated = recordIterationSample(prev, iterationCount, scoreboardTs);
                }
                let finalizingStats = prev.finalizingStats;
                if (prev.finalizing && prev.finalizingStart) {
                  const duration = Math.max(0, scoreboardTs - prev.finalizingStart);
                  if (duration > 0) {
                    finalizingStats = accumulateFinalizingDuration(finalizingStats, duration);
                  }
                }
                return {
                  ...updated,
                  finalizing: false,
                  finalizingStart: null,
                  finalizingStats,
                } satisfies RunProgress;
              });
              break;
            }
            case "data": {
              const payload = event.data as { kind?: string; event?: TelemetryEvent } | undefined;
              if (payload && typeof payload === "object" && payload.kind === "telemetry" && payload.event) {
                handleTelemetryEvent(payload.event);
              }
              break;
            }
            case "error": {
              const message = String(event.message ?? "Unknown error");
              setError(message);
              setErrorCode(null);
              setStatus("errored");
              endedWithError = true;
              updateRunHistory(runId, (entry) => ({
                ...entry,
                status: "errored",
                finishedAt: typeof event.ts === "number" ? event.ts : Date.now(),
                error: message,
              }));
              break;
            }
            default:
              break;
          }
        } catch (error) {
          setLogs((prev) => [
            ...prev,
            {
              level: "error",
              channel: "alerts",
              message: `Failed to parse event: ${error instanceof Error ? error.message : String(error)}`,
              ts: Date.now(),
            },
          ]);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processEvent(chunk);
          boundary = buffer.indexOf("\n\n");
        }
      }

      const trailing = buffer.trim();
      if (trailing.length > 0) {
        processEvent(trailing);
      }

      if (telemetrySpanMapRef.current.size > 0) {
        const pendingSpans = Array.from(telemetrySpanMapRef.current.values());
        telemetrySpanMapRef.current.clear();
        for (const span of pendingSpans) {
          pushTelemetrySpan(span);
        }
      }

      if (status !== "errored" && status !== "aborted") {
        setStatus("completed");
        setErrorCode(null);
        updateRunHistory(runId, (entry) => ({
          ...entry,
          status: "completed",
          finishedAt: Date.now(),
          result: latestResult ?? entry.result,
        }));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus("aborted");
        aborted = true;
        updateRunHistory(runId, (entry) => ({
          ...entry,
          status: "aborted",
          finishedAt: Date.now(),
          result: entry.result,
        }));
      } else {
        const checkpoint = latestCheckpointRef.current;
        const message = err instanceof Error ? err.message : String(err);
        const canAutoResume =
          Boolean(checkpoint)
          && autoResumeAttemptsRef.current < AUTO_RESUME_DELAYS_MS.length
          && !message.includes("Invalid configuration");
        if (canAutoResume && checkpoint) {
          const attempt = autoResumeAttemptsRef.current;
          const delay = AUTO_RESUME_DELAYS_MS[Math.min(attempt, AUTO_RESUME_DELAYS_MS.length - 1)];
          autoResumeAttemptsRef.current += 1;
          finalize = false;
          setLogs((prev) => [
            ...prev,
            {
              level: "warn",
              channel: "lifecycle",
              message: `Connection lost. Auto-resuming from checkpoint (iteration ${checkpoint.iteration}) in ${delay}ms`,
              ts: Date.now(),
            },
          ]);
          await new Promise((resolve) => setTimeout(resolve, delay));
          await startRun({
            resumeCheckpoint: checkpoint,
            auto: true,
          });
          return;
        }
        const finalMessage = checkpoint
          ? `Run paused after checkpoint iteration ${checkpoint.iteration}.`
          : message;
        if (checkpoint) {
          setStatus("paused");
          setError(null);
          setErrorCode("checkpoint_available");
          setLogs((prev) => [
            ...prev,
            {
              level: "warn",
              channel: "lifecycle",
              message: `${finalMessage} Resume when ready.`,
              ts: Date.now(),
            },
            ...(autoResumeAttemptsRef.current >= AUTO_RESUME_DELAYS_MS.length
              ? [
                  {
                    level: "info",
                    channel: "lifecycle",
                    message: "Auto-resume attempts exhausted. Click Resume Run to continue.",
                    ts: Date.now(),
                  } satisfies LogEntry,
                ]
              : []),
          ]);
          finalize = false;
        } else {
          setError(finalMessage);
          setStatus("errored");
          setErrorCode(null);
        }
        endedWithError = !checkpoint;
        updateRunHistory(runId, (entry) => ({
          ...entry,
          status: checkpoint ? "paused" : "errored",
          finishedAt: Date.now(),
          error: finalMessage,
        }));
      }
    } finally {
      if (telemetrySpanMapRef.current.size > 0) {
        const pendingSpans = Array.from(telemetrySpanMapRef.current.values());
        telemetrySpanMapRef.current.clear();
        for (const span of pendingSpans) {
          pushTelemetrySpan(span);
        }
      }
      if (finalize && !endedWithError && !aborted) {
        setStatus("completed");
        setErrorCode(null);
        updateRunHistory(runId, (entry) => ({
          ...entry,
          status: "completed",
          finishedAt: entry.finishedAt ?? Date.now(),
          result: latestResult ?? entry.result,
        }));
      }
      if (finalize) {
        if (currentRunIdRef.current === runId) {
          currentRunIdRef.current = null;
          abortRef.current = null;
          latestCheckpointRef.current = null;
          setLatestCheckpoint(null);
          autoResumeAttemptsRef.current = 0;
          setErrorCode(null);
        }
      } else if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    applyScoreboardEvent,
    computePreviewEvaluation,
    createOptimizePayload,
    config,
    datasetPayloads,
    datasets,
    handleTelemetryEvent,
    pushTelemetrySpan,
    scorers,
    status,
    updateRunHistory,
    hasServerGatewayKeyRef,
  ]);

  const abortRun = useCallback(() => {
    const controller = abortRef.current;
    if (controller) {
      controller.abort();
    }
  }, []);

  const resumeFromCheckpoint = useCallback(async () => {
    const checkpoint = latestCheckpointRef.current;
    if (!checkpoint) return;
    await startRun({ resumeCheckpoint: checkpoint });
  }, [startRun]);

  return {
    config,
    status,
    logs,
    selectedChannels,
    result,
    error,
    errorCode,
    currentStats,
    runHistory,
    scorers,
    datasets,
    scoreboards,
    selectedRowIds,
    activeDataset,
    dockOpen,
    showDisabledScorers,
    inspectorOpen,
    datasetPayloads,
    pluginOptions,
    scorerAverages,
    scorerDiagnostics,
    setError,
    setDockOpen,
    setInspectorOpen,
    setShowDisabledScorers,
    setActiveDataset,
    setSelectedChannels,
    handleConfigField,
    handleConfigNumberField,
    handleConfigOptionalNumberField,
    updateSeedPrompt,
    updateDatasetRow,
    addRow,
    duplicateRow,
    removeRow,
    moveRow,
    quickSplit,
    selectRow,
    copyDataset,
    pasteDataset,
    addScorer,
    updateScorer,
    updateScorerParams,
    removeScorer,
    duplicateScorer,
    latestCheckpoint,
    startRun,
    resumeFromCheckpoint,
    abortRun,
    applyScoreboardEvent,
    clearScores,
    runProgress,
    telemetryEvents,
    telemetryRecords,
    candidateHistory,
    reflectionFeedback,
    datasetLookup,
    handleTelemetryEvent,
    iterationOffset: iterationOffsetRef.current,
    autoResumeExhausted: autoResumeAttemptsRef.current >= AUTO_RESUME_DELAYS_MS.length,
  } satisfies UseOptimizerStateResult;
};

export { LOG_CHANNELS };

export function deriveCandidateTimeline(result: GEPAResult | null): CandidateTimelineEntry[] {
  if (!result || !Array.isArray(result.history)) {
    return buildFallbackTimeline(result);
  }

  const timeline: CandidateTimelineEntry[] = [];
  for (const entry of result.history) {
    if (!entry || typeof entry !== "object") continue;

    const raw = entry as Record<string, unknown>;
    const iterationValue = raw.iteration;
    const iteration = typeof iterationValue === "number"
      ? iterationValue
      : typeof iterationValue === "string"
        ? Number.parseFloat(iterationValue)
        : null;

    if (iteration === null || !Number.isFinite(iteration)) {
      continue;
    }

    const candidate = raw.candidate as { system?: unknown } | undefined;
    const prompt = typeof candidate?.system === "string" ? candidate.system : "";

    const rawScores = raw.scores;
    const scores: Record<string, number> = {};
    if (rawScores && typeof rawScores === "object") {
      for (const [key, value] of Object.entries(rawScores as Record<string, unknown>)) {
        const numeric = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(numeric)) {
          scores[key] = numeric;
        }
      }
    }

    const accepted = Boolean(raw.accepted);

    timeline.push({ iteration, prompt, scores, accepted });
  }

  const sorted = timeline.sort((a, b) => a.iteration - b.iteration);
  if (sorted.length === 0) {
    return buildFallbackTimeline(result);
  }
  return sorted;
}

function buildFallbackTimeline(result: GEPAResult | null): CandidateTimelineEntry[] {
  if (!result) return [];
  const system = typeof result.bestCandidate?.system === "string" ? result.bestCandidate.system : "";
  if (!system.trim()) return [];

  let scores: Record<string, number> = {};
  if (Array.isArray(result.paretoFront) && result.paretoFront.length > 0) {
    const match = result.paretoFront.find((entry) => entry?.candidate?.system === system);
    if (match && match.scores && typeof match.scores === "object") {
      scores = Object.fromEntries(
        Object.entries(match.scores)
          .map(([key, value]) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return [key, Number.isFinite(numeric) ? numeric : undefined];
          })
          .filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
      );
    }
  }

  const iteration = typeof result.iterations === "number" && Number.isFinite(result.iterations)
    ? result.iterations
    : 0;

  return [
    {
      iteration,
      prompt: system,
      scores,
      accepted: true,
    },
  ];
}

function recordIterationSample(progress: RunProgress, iteration: number, timestamp: number): RunProgress {
  if (!progress.startTime) return progress;
  if (progress.iterationSamples.some((sample) => sample.iteration === iteration)) {
    return progress;
  }

  const nextSamples = [...progress.iterationSamples, { iteration, timestamp }].sort(
    (a, b) => a.iteration - b.iteration,
  );

  let iterationStats = progress.iterationStats;
  const previousSample = progress.iterationSamples.reduce<{
    iteration: number;
    timestamp: number;
  } | null>((acc, sample) => {
    if (sample.iteration < iteration && (!acc || sample.iteration > acc.iteration)) {
      return sample;
    }
    return acc;
  }, null);

  const referenceTimestamp = previousSample
    ? previousSample.timestamp
    : progress.startTime ?? timestamp;

  const duration = Math.max(0, timestamp - referenceTimestamp);
  if (duration > 0) {
    iterationStats = {
      total: iterationStats.total + duration,
      count: iterationStats.count + 1,
    };
  }

  return {
    ...progress,
    iterationSamples: nextSamples,
    iterationStats,
  } satisfies RunProgress;
}

function extractIteration(meta: unknown): number | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).iteration;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildTelemetrySpan(span: TelemetrySpanInternal): TelemetrySpan {
  const startTime = typeof span.startTime === "number" ? span.startTime : undefined;
  const endTime = typeof span.endTime === "number" ? span.endTime : undefined;
  const durationMs = typeof span.durationMs === "number"
    ? span.durationMs
    : startTime !== undefined && endTime !== undefined
      ? Math.max(0, endTime - startTime)
      : undefined;

  const status: TelemetrySpan["status"] = span.errorMessage
    ? "error"
    : startTime !== undefined && endTime !== undefined
      ? "success"
      : "partial";

  const attributes = span.attributes ?? {};

  const derived = deriveTelemetryDerived(attributes, durationMs);

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTime,
    endTime,
    durationMs,
    status,
    attributes,
    errorMessage: span.errorMessage,
    derived,
  } satisfies TelemetrySpan;
}

function deriveTelemetryDerived(attributes: Record<string, unknown>, fallbackLatency?: number): TelemetrySpan["derived"] {
  const modelId = pickStringAttr(attributes, ["ai.model", "model", "modelId", "model_id"]);
  const initialProvider = pickStringAttr(attributes, ["ai.model.provider", "ai.provider", "provider", "providerId", "provider_id"]);
  const finishReason = pickStringAttr(
    attributes,
    [
      "finishReason",
      "finish_reason",
      "choices.0.finishReason",
      "choices.0.finish_reason",
    ],
  );
  const temperature = pickNumberAttr(attributes, ["temperature", "config.temperature"]);
  const latencyMs = pickNumberAttr(attributes, ["latencyMs", "latency_ms", "latency"], fallbackLatency);
  const totalTokens = pickNumberAttr(
    attributes,
    ["usage.totalTokens", "usage.total_tokens", "tokens.total", "totalTokens"],
  );
  const promptTokens = pickNumberAttr(
    attributes,
    ["usage.promptTokens", "usage.prompt_tokens", "tokens.input", "promptTokens"],
  );
  const completionTokens = pickNumberAttr(
    attributes,
    ["usage.completionTokens", "usage.completion_tokens", "tokens.output", "completionTokens"],
  );
  const costUSD = pickNumberAttr(attributes, ["usage.costUSD", "usage.cost_usd", "cost.usd", "costUSD"]);
  const metadata = extractProviderMetadata(attributes);
  const finalProvider = metadata?.finalProvider
    ?? (initialProvider && initialProvider.toLowerCase() !== "gateway" ? initialProvider : undefined);
  const provider = finalProvider ?? initialProvider;
  const aggregator = metadata?.aggregator
    ?? (initialProvider && finalProvider && initialProvider !== finalProvider ? initialProvider : undefined);
  const metadataCost = typeof metadata?.costUSD === "number" ? metadata.costUSD : undefined;
  const resolvedCost = typeof costUSD === "number" ? costUSD : metadataCost;
  const promptDetails = extractPromptDetails(attributes);
  const promptSummary = promptDetails.summary ?? metadata?.promptSummary;
  const responseText = pickStringAttr(attributes, [
    "ai.response.text",
    "response.text",
    "gen_ai.response.text",
  ]) ?? metadata?.responseText;
  const responseId = pickStringAttr(attributes, [
    "ai.response.id",
    "response.id",
    "gen_ai.response.id",
  ]) ?? metadata?.responseId;
  const operationId = pickStringAttr(attributes, [
    "ai.operationId",
    "operation.id",
    "operation.name",
  ]);
  const iteration = pickNumberAttr(attributes, ["gepa.iteration"]);
  const role = pickStringAttr(attributes, ["gepa.role"]);
  const datasetRowId = pickStringAttr(attributes, ["gepa.rowId"]);
  const datasetRowInput = pickStringAttr(attributes, ["gepa.rowInput"]);
  const datasetRowExpected = pickStringAttr(attributes, ["gepa.rowExpected"]);

  return {
    modelId,
    provider,
    aggregator,
    finishReason,
    temperature,
    latencyMs,
    totalTokens,
    promptTokens,
    completionTokens,
    costUSD: resolvedCost,
    finalProvider,
    fallbackProviders: metadata?.fallbacks,
    routingAttempts: metadata?.attempts,
    routingReasoning: metadata?.routingReasoning,
    routingPlan: metadata?.routingPlan,
    promptSummary,
    responseText,
    responseId,
    operationId,
    iteration,
    role,
    promptMessages: promptDetails.messages,
    datasetRowId,
    datasetRowInput,
    datasetRowExpected,
    providerResponseId: metadata?.responseId,
  } satisfies TelemetrySpan["derived"];
}

function pickStringAttr(attributes: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readAttribute(attributes, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function pickNumberAttr(
  attributes: Record<string, unknown>,
  paths: string[],
  fallback?: number,
): number | undefined {
  for (const path of paths) {
    const value = readAttribute(attributes, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function readAttribute(attributes: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(attributes, path)) {
    return attributes[path];
  }
  const segments = path.split(".");
  let current: unknown = attributes;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (Number.isNaN(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

type ProviderMetadata = {
  finalProvider?: string;
  aggregator?: string;
  costUSD?: number;
  responseText?: string;
  promptSummary?: string;
  fallbacks?: string[];
  attempts?: TelemetrySpan["derived"]["routingAttempts"];
  routingReasoning?: string;
  routingPlan?: string;
  responseId?: string;
};

function extractProviderMetadata(attributes: Record<string, unknown>): ProviderMetadata | undefined {
  const raw = readAttribute(attributes, "ai.response.providerMetadata");
  return parseProviderMetadata(raw);
}

function parseProviderMetadata(raw?: unknown): ProviderMetadata | undefined {
  if (raw == null) return undefined;

  let parsed: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  } else if (typeof raw === "object") {
    parsed = raw as Record<string, unknown>;
  } else {
    return undefined;
  }

  const gateway = (parsed.gateway as Record<string, unknown> | undefined) ?? parsed;
  const routing = gateway?.routing as Record<string, unknown> | undefined;
  const finalProvider = typeof routing?.finalProvider === "string"
    ? routing.finalProvider
    : typeof parsed.finalProvider === "string"
      ? parsed.finalProvider
      : undefined;
  const aggregator = typeof gateway?.provider === "string"
    ? gateway.provider
    : typeof parsed.aggregator === "string"
      ? parsed.aggregator
      : undefined;
  const costValue = (gateway?.cost ?? routing?.cost) as unknown;
  const costUSD = toNumber(costValue);
  const responseText = typeof parsed.responseText === "string" ? parsed.responseText : undefined;
  const openai = parsed.openai as Record<string, unknown> | undefined;
  const responseId = typeof openai?.responseId === "string"
    ? openai.responseId
    : typeof parsed.responseId === "string"
      ? parsed.responseId
      : undefined;
  const fallbackArray = Array.isArray(routing?.fallbacksAvailable)
    ? (routing?.fallbacksAvailable as unknown[])
        .map((entry) => (typeof entry === "string" ? entry : undefined))
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : undefined;
  const attempts = Array.isArray(routing?.attempts)
    ? (routing?.attempts as Record<string, unknown>[])
        .map((attempt) => {
          const provider = typeof attempt.provider === "string" ? attempt.provider : "unknown";
          const success = typeof attempt.success === "boolean" ? attempt.success : attempt.success !== false;
          const start = toNumber(attempt.startTime);
          const end = toNumber(attempt.endTime);
          const durationMs = start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined;
          const modelId = typeof attempt.internalModelId === "string"
            ? attempt.internalModelId
            : typeof attempt.providerApiModelId === "string"
              ? attempt.providerApiModelId
              : undefined;
          const credentialType = typeof attempt.credentialType === "string" ? attempt.credentialType : undefined;
          const attemptCost = toNumber(attempt.cost ?? attempt.costUSD);
          return {
            provider,
            success,
            durationMs,
            modelId,
            credentialType,
            costUSD: attemptCost,
          };
        })
    : undefined;
  const routingReasoning = typeof routing?.internalReasoning === "string" ? routing.internalReasoning : undefined;
  const routingPlan = typeof routing?.planningReasoning === "string" ? routing.planningReasoning : undefined;
  return {
    finalProvider,
    aggregator,
    costUSD,
    responseText,
    fallbacks: fallbackArray && fallbackArray.length > 0 ? fallbackArray : undefined,
    attempts: attempts && attempts.length > 0 ? attempts : undefined,
    routingReasoning,
    routingPlan,
    responseId,
  } satisfies ProviderMetadata;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function extractPromptDetails(attributes: Record<string, unknown>): {
  summary?: string;
  messages?: { role: string; content: string }[];
} {
  const rawMessages = pickStringAttr(attributes, ["ai.prompt.messages", "prompt.messages"]);
  const rawPrompt = pickStringAttr(attributes, ["ai.prompt", "prompt", "input.prompt"]);

  if (rawMessages) {
    const parsed = parsePromptMessages(rawMessages);
    if (parsed && parsed.length > 0) {
      return {
        messages: parsed,
        summary: clampText(formatPromptMessages(parsed), 1200),
      };
    }
  }

  if (rawPrompt) {
    const parsed = parsePromptMessages(rawPrompt);
    if (parsed && parsed.length > 0) {
      return {
        messages: parsed,
        summary: clampText(formatPromptMessages(parsed), 1200),
      };
    }
    return { summary: clampText(rawPrompt, 1200) };
  }

  return {};
}

function parsePromptMessages(raw: string): { role: string; content: string }[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return toPromptMessageArray(parsed);
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).messages)) {
      return toPromptMessageArray((parsed as Record<string, unknown>).messages as unknown[]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toPromptMessageArray(messages: unknown[]): { role: string; content: string }[] | undefined {
  const result: { role: string; content: string }[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : "unknown";
    const content = extractMessageContent(record.content);
    if (content) {
      result.push({ role, content });
    }
  }
  return result.length > 0 ? result : undefined;
}

function formatPromptMessages(messages: { role: string; content: string }[]): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function extractMessageContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return undefined;
        const record = entry as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return undefined;
      })
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).text === "string") {
    return (value as Record<string, unknown>).text as string;
  }
  return undefined;
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeText(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
