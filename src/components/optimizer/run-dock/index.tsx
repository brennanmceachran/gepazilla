"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GEPAResult } from "@currentai/dsts";

import type {
  CandidateTimelineEntry,
  LogEntry,
  LogChannel,
  RunHistoryEntry,
  RunStats,
  OptimizerConfig,
  RunStatus,
  TelemetryRecord,
  ScorerDiagnosticsSummaryEntry,
} from "../types";
import { RunConfigForm } from "../config-panel";
import { BottomSheet, type SheetState } from "./bottom-sheet";
import { RunDockHeader } from "./header";
import { RunLogsPanel, type ProgressInfo } from "./logs-panel";
import { summarizeTelemetryRecord } from "./logs/telemetry-utils";
import { ResultsPanel, computeResultStats } from "./results-panel";
import { deriveCandidateTimeline } from "../use-optimizer-state";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";
import {
  CORE_PHASES,
  DEFAULT_PHASE_DURATION_MS,
  DEFAULT_FINALIZING_DURATION_MS,
  type OptimizerPhase,
} from "../progress-constants";

const DEBUG_PROGRESS = process.env.NEXT_PUBLIC_DEBUG_PROGRESS === "true";

type RunProgressState = {
  startTime: number | null;
  iterationSamples: Array<{ iteration: number; timestamp: number }>;
  phaseSamples: Array<{ iteration: number; phase: OptimizerPhase; timestamp: number }>;
  finalizing: boolean;
  latestPhaseByIteration: Record<number, { phase: OptimizerPhase; timestamp: number }>;
  phaseStats: Record<OptimizerPhase, { total: number; count: number }>;
  iterationStats: { total: number; count: number };
  finalizingStart: number | null;
  finalizingStats: { total: number; count: number };
};

type RunDockProps = {
  open: boolean;
  onToggle: (open: boolean) => void;
  logs: LogEntry[];
  telemetryRecords: TelemetryRecord[];
  candidateHistory: CandidateTimelineEntry[];
  scorerDiagnostics: ScorerDiagnosticsSummaryEntry[];
  selectedChannels: Set<LogChannel>;
  onToggleChannel: (channel: LogChannel) => void;
  runHistory: RunHistoryEntry[];
  stats: RunStats;
  result: GEPAResult | null;
  runProgress: RunProgressState;
  config: OptimizerConfig;
  status: RunStatus;
  onConfigField: (
    field: keyof OptimizerConfig
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  onConfigNumberField: (
    field: keyof OptimizerConfig
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  onConfigOptionalNumberField: (
    field: keyof OptimizerConfig
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  datasetCounts: Record<"training" | "validation", number>;
  onStart: () => Promise<void>;
  onAbort: () => void;
  disableStart: boolean;
  needsGatewayKey: boolean;
  onApplySystemPrompt: (prompt: string) => void;
  hasGatewayKey: boolean;
  latestCheckpoint: CheckpointState | null;
  onResumeFromCheckpoint: () => Promise<void>;
  iterationOffset: number;
  autoResumeExhausted: boolean;
};

export function RunDock(props: RunDockProps) {
  const {
    open,
    onToggle,
    logs,
    telemetryRecords,
    candidateHistory,
    scorerDiagnostics,
    selectedChannels,
    onToggleChannel,
    runHistory,
    stats,
    result,
    runProgress,
    config,
    status,
    onConfigField,
    onConfigNumberField,
    onConfigOptionalNumberField,
    datasetCounts,
    onStart,
    onAbort,
    disableStart,
    needsGatewayKey,
    onApplySystemPrompt,
    hasGatewayKey,
    latestCheckpoint,
    onResumeFromCheckpoint,
    iterationOffset,
    autoResumeExhausted,
  } = props;

  const [tab, setTab] = useState("run");
  const [sheetState, setSheetState] = useState<SheetState>(
    open ? "short" : "peek"
  );
  const [now, setNow] = useState(() => Date.now());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [focusedIteration, setFocusedIteration] = useState<number | null>(null);
  const isPeek = sheetState === "peek";
  const lastDebugRef = useRef<{
    total: number | null;
    remaining: number | null;
    percent: number | null;
    elapsedBucket: number | null;
  }>({ total: null, remaining: null, percent: null, elapsedBucket: null });

  useEffect(() => {
    if (!open) {
      setSheetState("peek");
    } else {
      setSheetState((prev) => (prev === "peek" ? "short" : prev));
    }
  }, [open]);

  useEffect(() => {
    const shouldBeOpen = sheetState !== "peek";
    if (shouldBeOpen !== open) {
      onToggle(shouldBeOpen);
    }
  }, [open, onToggle, sheetState]);

  useEffect(() => {
    let interval: number | undefined;
    if (status === "running" || status === "starting") {
      interval = window.setInterval(() => {
        setNow(Date.now());
      }, 500);
    } else {
      setNow(Date.now());
    }
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [status]);

  useEffect(() => {
    if (runHistory.length === 0) {
      setSelectedRunId(null);
      return;
    }
    const latestId = runHistory[0]?.id ?? null;
    setSelectedRunId((prev) => prev ?? latestId);
  }, [runHistory]);

  useEffect(() => {
    if (result && runHistory.length > 0) {
      setSelectedRunId(runHistory[0]?.id ?? null);
    }
  }, [result, runHistory]);

  useEffect(() => {
    if (status === "running" || status === "starting") {
      setFocusedIteration(null);
    }
  }, [status]);

  useEffect(() => {
    setFocusedIteration(null);
  }, [selectedRunId]);

  const telemetryLogEntries = useMemo(
    () =>
      telemetryRecords.map(
        (record) =>
          ({
            level: "telemetry",
            channel: "telemetry",
            message: summarizeTelemetryRecord(record),
            meta: { telemetry: record },
            ts: record.endedAt ?? record.startedAt ?? Date.now(),
          } satisfies LogEntry)
      ),
    [telemetryRecords]
  );

  const combinedLogs = useMemo(() => {
    const merged = [...logs, ...telemetryLogEntries];
    merged.sort((a, b) => b.ts - a.ts);
    return merged;
  }, [logs, telemetryLogEntries]);

  const filteredLogs = useMemo(
    () => combinedLogs.filter((entry) => selectedChannels.has(entry.channel)),
    [combinedLogs, selectedChannels]
  );

  const cycleSheetState = useCallback(() => {
    setSheetState((prev) =>
      prev === "peek" ? "short" : prev === "short" ? "full" : "peek"
    );
  }, []);

  const handleStart = useCallback(async () => {
    if (status === "running" || status === "starting" || status === "resuming" || disableStart) {
      return;
    }
    if (needsGatewayKey) {
      setTab("run");
      setSheetState("full");
      return;
    }
    setTab("logs");
    setSheetState("full");
    await onStart();
  }, [disableStart, needsGatewayKey, onStart, status]);

  const handleResume = useCallback(async () => {
    setTab("logs");
    setSheetState("full");
    await onResumeFromCheckpoint();
  }, [onResumeFromCheckpoint]);

  const prevStatusRef = useRef<RunStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if ((status === "starting" || status === "running" || status === "resuming") && prev !== status) {
      setTab("logs");
    } else if (
      (status === "completed" || status === "errored" || status === "paused") &&
      prev !== status
    ) {
      setTab(status === "completed" ? "results" : "logs");
    }
    prevStatusRef.current = status;
  }, [status]);

  const progressInfo: ProgressInfo = useMemo(() => {
    const maxIterations = config.maxIterations ?? 0;
    const startTime = runProgress.startTime;
    const elapsedMs = startTime ? Math.max(0, now - startTime) : 0;

    const iterationOffsetValue = iterationOffset ?? 0;
    const iterationStats = runProgress.iterationStats;
    const completedIterationsRecorded = iterationStats.count;
    const completedIterations = completedIterationsRecorded + iterationOffsetValue;
    const completedIterationsDuration = iterationStats.total;
    const averageIterationMs = completedIterationsRecorded > 0
      ? Math.max(500, iterationStats.total / completedIterationsRecorded)
      : null;

    const plannedIterations = maxIterations > 0
      ? maxIterations
      : Math.max(completedIterations + 1, 1);
    const runIsActive = status === "running" || status === "starting";
    const hasActiveIteration = (runIsActive || status === "idle")
      && completedIterations < plannedIterations;

    let observedIterationMax = Math.max(iterationOffsetValue, completedIterations);
    for (const sample of runProgress.iterationSamples) {
      if (sample.iteration > observedIterationMax) {
        observedIterationMax = sample.iteration;
      }
    }
    for (const sample of runProgress.phaseSamples) {
      if (sample.iteration > observedIterationMax) {
        observedIterationMax = sample.iteration;
      }
    }
    for (const key of Object.keys(runProgress.latestPhaseByIteration)) {
      const iterationNumber = Number(key);
      if (Number.isFinite(iterationNumber) && iterationNumber > observedIterationMax) {
        observedIterationMax = iterationNumber;
      }
    }

    const runEndedWithPartialIteration = observedIterationMax > completedIterations
      && (status === "aborted" || status === "errored");

    const activeIteration = hasActiveIteration
      ? completedIterations + 1
      : runEndedWithPartialIteration
        ? Math.min(observedIterationMax, plannedIterations)
        : plannedIterations;

    const previousSample = runProgress.iterationSamples
      .filter((sample) => sample.iteration < activeIteration)
      .sort((a, b) => b.iteration - a.iteration)[0];

    const activeIterationStart = hasActiveIteration
      ? (previousSample?.timestamp ?? startTime ?? now)
      : startTime ?? now;

    const phaseSamplesForIteration = runProgress.phaseSamples.filter(
      (sample) => sample.iteration === activeIteration,
    );
    const phaseSet = new Set(phaseSamplesForIteration.map((sample) => sample.phase));
    const includeReflection = phaseSet.has("reflection") || (runProgress.phaseStats.reflection?.count ?? 0) > 0;
    const phaseOrderRaw: OptimizerPhase[] = includeReflection
      ? ["reflection", ...CORE_PHASES]
      : [...CORE_PHASES];
    const phaseOrder = Array.from(new Set(phaseOrderRaw));

    const getPhaseAverage = (phase: OptimizerPhase) => {
      const stats = runProgress.phaseStats[phase];
      if (stats && stats.count > 0) {
        return Math.max(500, stats.total / stats.count);
      }
      if (averageIterationMs && phaseOrder.length > 0) {
        return Math.max(500, averageIterationMs / phaseOrder.length);
      }
      return DEFAULT_PHASE_DURATION_MS[phase] ?? 15000;
    };

    const iterationElapsed = hasActiveIteration ? Math.max(0, now - activeIterationStart) : 0;
    let iterationRemainingMs = 0;

    if (hasActiveIteration) {
      const latestPhaseEntry = runProgress.latestPhaseByIteration[activeIteration] ?? null;
      if (latestPhaseEntry && phaseOrder.includes(latestPhaseEntry.phase)) {
        const currentPhaseStart = latestPhaseEntry.timestamp ?? activeIterationStart;
        const avgCurrent = getPhaseAverage(latestPhaseEntry.phase);
        const elapsedCurrent = Math.max(0, now - currentPhaseStart);
        const remainingCurrent = Math.max(avgCurrent * 0.15, avgCurrent - elapsedCurrent);
        iterationRemainingMs += Math.max(0, remainingCurrent);
        const currentIndex = phaseOrder.indexOf(latestPhaseEntry.phase);
        for (let i = currentIndex + 1; i < phaseOrder.length; i += 1) {
          const phase = phaseOrder[i];
          if (phaseSet.has(phase)) continue;
          iterationRemainingMs += getPhaseAverage(phase);
        }
      } else {
        iterationRemainingMs += phaseOrder.reduce((sum, phase) => sum + getPhaseAverage(phase), 0);
      }
    }

    const finalizingElapsed = runProgress.finalizing && runProgress.finalizingStart
      ? Math.max(0, now - runProgress.finalizingStart)
      : 0;
    const averageFinalizingMs = runProgress.finalizingStats.count > 0
      ? Math.max(500, runProgress.finalizingStats.total / runProgress.finalizingStats.count)
      : DEFAULT_FINALIZING_DURATION_MS;
    let finalizingRemaining = 0;
    if (runProgress.finalizing) {
      finalizingRemaining = Math.max(averageFinalizingMs - finalizingElapsed, averageFinalizingMs * 0.15);
      iterationRemainingMs += finalizingRemaining;
    }

    const iterationTotalEstimate = hasActiveIteration
      ? Math.max(iterationElapsed + iterationRemainingMs, iterationElapsed + 1000)
      : 0;

    const fallbackIterationDurationRaw = phaseOrder.reduce((sum, phase) => sum + getPhaseAverage(phase), 0);
    const fallbackIterationDuration = Math.max(fallbackIterationDurationRaw, 15000);
    const hasPhaseAveragesReady = phaseOrder.length > 0
      && phaseOrder.every((phase) => (runProgress.phaseStats[phase]?.count ?? 0) > 0);

    const effectiveIterationMs = averageIterationMs
      ?? (hasPhaseAveragesReady
        ? fallbackIterationDuration
        : hasActiveIteration
          ? Math.max(iterationTotalEstimate, fallbackIterationDuration)
          : fallbackIterationDuration);

    const futureIterations = Math.max(
      0,
      plannedIterations
        - completedIterations
        - (hasActiveIteration ? 1 : 0),
    );

    const futureIterationsMs = futureIterations * effectiveIterationMs;

    const completedPortionMs = completedIterationsDuration;
    const activeIterationMs = hasActiveIteration ? iterationTotalEstimate : 0;

    let estimatedTotalMs = completedPortionMs + activeIterationMs + futureIterationsMs;
    if (status === "completed") {
      estimatedTotalMs = elapsedMs;
    }
    let totalReady = estimatedTotalMs > 0 && (!hasActiveIteration || iterationElapsed > 1500);
    let remainingMs = totalReady ? Math.max(0, estimatedTotalMs - elapsedMs) : null;

    if (iterationOffsetValue > 0 && completedIterationsRecorded === 0) {
      totalReady = false;
      remainingMs = null;
    }

    let percent = 0;
    if (totalReady && estimatedTotalMs > 0) {
      const elapsedForPercent = completedPortionMs + (hasActiveIteration ? iterationElapsed : 0);
      percent = Math.min(1, Math.max(0, elapsedForPercent / estimatedTotalMs));
    }

    const currentIterationDisplay = hasActiveIteration
      ? activeIteration
      : runEndedWithPartialIteration
        ? activeIteration
        : Math.min(plannedIterations, Math.max(observedIterationMax, completedIterations));

    return {
      percent,
      elapsedMs,
      currentIteration: currentIterationDisplay,
      maxIterations,
      averageIterationMs,
      remainingMs,
      estimatedTotalMs: totalReady ? estimatedTotalMs : null,
      finalizing: runProgress.finalizing,
    } satisfies ProgressInfo;
  }, [
    config.maxIterations,
    now,
    runProgress.finalizing,
    runProgress.finalizingStart,
    runProgress.finalizingStats,
    runProgress.iterationSamples,
    runProgress.iterationStats,
    runProgress.latestPhaseByIteration,
    runProgress.phaseSamples,
    runProgress.phaseStats,
    runProgress.startTime,
    status,
    iterationOffset,
  ]);

  useEffect(() => {
    if (!DEBUG_PROGRESS) return;
    const { estimatedTotalMs, remainingMs, percent } = progressInfo;
    const last = lastDebugRef.current;
    const bucket = Math.floor(progressInfo.elapsedMs / 15000);
    const changed =
      last.total !== estimatedTotalMs
      || last.remaining !== remainingMs
      || last.percent !== percent;
    const bucketChanged = last.elapsedBucket !== bucket;
    const totalDelta = Math.abs((estimatedTotalMs ?? 0) - (last.total ?? 0));
    const remainingDelta = Math.abs((remainingMs ?? 0) - (last.remaining ?? 0));
    if ((changed && bucketChanged) || totalDelta >= 10000 || remainingDelta >= 10000) {
      console.debug("[progress]", {
        elapsedMs: progressInfo.elapsedMs,
        estimatedTotalMs,
        remainingMs,
        percent,
        finalizing: progressInfo.finalizing,
      });
      lastDebugRef.current = {
        total: estimatedTotalMs,
        remaining: remainingMs,
        percent,
        elapsedBucket: bucket,
      };
    }
  }, [progressInfo]);

  const datasetSummary = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
      <span>Train {datasetCounts.training}</span>
      <span>
        Validation {datasetCounts.validation}
        {datasetCounts.validation === 0 ? " (add hold-out)" : " (Pareto gate)"}
      </span>
    </div>
  );

  const selectedHistoryEntry = useMemo(() => {
    if (!selectedRunId) return null;
    return runHistory.find((entry) => entry.id === selectedRunId) ?? null;
  }, [runHistory, selectedRunId]);

  const latestRunId = runHistory[0]?.id ?? null;

  const displayResult = selectedHistoryEntry?.result ?? result;
  const displayStats = useMemo(() => {
    if (selectedHistoryEntry?.result) {
      return computeResultStats(selectedHistoryEntry.result);
    }
    return stats;
  }, [selectedHistoryEntry, stats]);

  const displayCandidateHistory = useMemo(() => {
    if (selectedHistoryEntry?.result) {
      return deriveCandidateTimeline(selectedHistoryEntry.result);
    }
    return candidateHistory;
  }, [candidateHistory, selectedHistoryEntry]);

  const displayDiagnostics = useMemo(() => {
    if (selectedHistoryEntry && selectedHistoryEntry.id !== latestRunId) {
      return [];
    }
    return scorerDiagnostics;
  }, [latestRunId, scorerDiagnostics, selectedHistoryEntry]);

  const handleCandidateFocus = useCallback(
    (iteration: number) => {
      setFocusedIteration(iteration);
      setTab("logs");
      setSheetState("full");
    },
    []
  );

  const handleClearFocus = useCallback(() => {
    setFocusedIteration(null);
  }, []);

  return (
    <BottomSheet
      state={sheetState}
      onStateChange={setSheetState}
      header={
        <RunDockHeader
          sheetState={sheetState}
          onCycleState={cycleSheetState}
          datasetSummary={datasetSummary}
          status={status}
          disableStart={disableStart}
          onStart={handleStart}
          onAbort={onAbort}
          progress={progressInfo}
          onResume={latestCheckpoint ? handleResume : undefined}
        />
      }
      className="shadow-[0_-18px_60px_rgba(15,23,42,0.22)]"
    >
      {isPeek ? null : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-3 py-1">
              <TabsList className="bg-transparent text-xs">
                <TabsTrigger value="run">Config</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value="run"
              className="mt-0 flex flex-1 min-h-0 overflow-auto px-3 py-3"
            >
              <div className="flex-1">
                <RunConfigForm
                  config={config}
                  onConfigField={onConfigField}
                  onConfigNumberField={onConfigNumberField}
                  onConfigOptionalNumberField={onConfigOptionalNumberField}
                  hasGatewayKey={hasGatewayKey}
                />
              </div>
            </TabsContent>
            <TabsContent
              value="logs"
              className="mt-0 flex flex-1 min-h-0 overflow-auto px-0 py-0"
            >
            <RunLogsPanel
              logs={filteredLogs}
              selectedChannels={selectedChannels}
              onToggleChannel={onToggleChannel}
              focusedIteration={focusedIteration}
              onClearFocus={handleClearFocus}
            />
            </TabsContent>
            <TabsContent
              value="results"
              className="mt-0 flex-1 min-h-0 overflow-auto px-3 py-3"
            >
              <ResultsPanel
                stats={displayStats}
                runHistory={runHistory}
                result={displayResult}
                candidateHistory={displayCandidateHistory}
                scorerDiagnostics={displayDiagnostics}
                onApplyBestPrompt={onApplySystemPrompt}
                onSelectHistory={(entry) => setSelectedRunId(entry.id)}
                selectedRunId={selectedRunId}
                focusedIteration={focusedIteration}
                onFocusIteration={handleCandidateFocus}
                status={status}
                progress={progressInfo}
                latestCheckpoint={latestCheckpoint}
                onResume={status === "paused" ? handleResume : undefined}
                autoResumeExhausted={autoResumeExhausted}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </BottomSheet>
  );
}
