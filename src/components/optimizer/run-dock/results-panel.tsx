"use client";

import { useMemo, useState } from "react";

import { AlertTriangle, Clock, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, extractLatencyMs } from "@/lib/utils";
import type { GEPAResult } from "@currentai/dsts";
import { hypervolume2D } from "@currentai/dsts/dist/pareto-utils";
import type {
  CandidateTimelineEntry,
  RunHistoryEntry,
  RunStats,
  ScorerDiagnosticsSummaryEntry,
  RunStatus,
} from "../types";
import type { ProgressInfo } from "./logs-panel";
import { statusSummary, useProgressSnapshot } from "./logs/progress-summary";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";

export type ResultsPanelProps = {
  stats: RunStats;
  runHistory: RunHistoryEntry[];
  result: GEPAResult | null;
  candidateHistory: CandidateTimelineEntry[];
  scorerDiagnostics: ScorerDiagnosticsSummaryEntry[];
  onApplyBestPrompt: (prompt: string) => void;
  onSelectHistory: (entry: RunHistoryEntry) => void;
  selectedRunId: string | null;
  focusedIteration: number | null;
  onFocusIteration?: (iteration: number) => void;
  status: RunStatus;
  progress: ProgressInfo;
  latestCheckpoint: CheckpointState | null;
  onResume?: () => void;
  autoResumeExhausted: boolean;
};

const STATUS_BADGE_STYLES: Record<RunStatus, string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  starting: "border-blue-200 bg-blue-50 text-blue-700",
  resuming: "border-orange-200 bg-orange-50 text-orange-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-neutral-200 bg-neutral-100 text-neutral-600",
  errored: "border-red-200 bg-red-50 text-red-700",
  aborted: "border-amber-200 bg-amber-50 text-amber-700",
  idle: "border-neutral-200 bg-neutral-50 text-neutral-500",
};

export function ResultsPanel({
  stats,
  runHistory,
  result,
  candidateHistory,
  scorerDiagnostics,
  onApplyBestPrompt,
  onSelectHistory,
  selectedRunId,
  focusedIteration,
  onFocusIteration,
  status,
  progress,
  latestCheckpoint,
  onResume,
  autoResumeExhausted,
}: ResultsPanelProps) {
  const progressSnapshot = useProgressSnapshot(progress);
  const bestCandidate = useBestCandidate(result, candidateHistory, latestCheckpoint);
  const hasBestPrompt = Boolean(bestCandidate?.prompt?.trim());
  const isPaused = status === "paused";
  const acceptedTimeline = useMemo(
    () => candidateHistory.filter((entry) => entry.accepted),
    [candidateHistory]
  );
  const lastAcceptedIteration = acceptedTimeline.length
    ? acceptedTimeline[acceptedTimeline.length - 1]?.iteration ?? null
    : null;

  const correctnessSeries = useMemo(() => {
    const points = candidateHistory
      .map((entry) => {
        const value = entry.scores?.correctness;
        return typeof value === "number" && Number.isFinite(value)
          ? { iteration: entry.iteration, value }
          : null;
      })
      .filter((point): point is { iteration: number; value: number } => Boolean(point));
    return points;
  }, [candidateHistory]);

  return (
    <div className="space-y-4">
      {isPaused ? (
        <PausedBanner
          latestCheckpoint={latestCheckpoint}
          autoResumeExhausted={autoResumeExhausted}
          onResume={onResume}
        />
      ) : null}

      {hasBestPrompt ? (
        <BestCandidateCard
          candidate={bestCandidate!}
          onApply={onApplyBestPrompt}
          onResume={isPaused ? onResume : undefined}
        />
      ) : null}

      {status !== "completed" ? (
        <RunProgressCard snapshot={progressSnapshot} status={status} />
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-neutral-500">Run metrics</h3>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            <StatTile
              label="Cost (USD)"
              value={stats.totalCostUSD}
              format={(v) => `$${v.toFixed(2)}`}
              tooltip="Estimated spend accumulated from evaluator/model calls during the run."
            />
            <StatTile
              label="Iterations"
              value={stats.iterations}
              tooltip="Number of GEPA update cycles completed this run."
            />
            <StatTile
              label="Best score"
              value={stats.bestScore}
              format={(v) => v.toFixed(3)}
              tooltip="Highest correctness score GEPA reached on the validation Pareto set."
            />
            <StatTile
              label="Latency (ms)"
              value={stats.bestLatencyMs}
              format={(v) => `${Math.round(v)}`}
              tooltip="Fastest average latency seen among the Pareto candidates (lower is better)."
            />
            <StatTile
              label="Metric calls"
              value={stats.totalMetricCalls}
              tooltip="Count of scorer evaluations so far—each synchronous or async metric invocation increments this."
            />
            <StatTile
              label="Hypervolume"
              value={stats.hypervolume2D}
              format={(v) => v.toFixed(3)}
              tooltip="Area under the Pareto-front scores; higher means better trade-offs across active scorers."
            />
          </div>

          <ScorerDiagnosticsCard diagnostics={scorerDiagnostics} />

          <CandidateTimeline
            entries={acceptedTimeline}
            focusedIteration={focusedIteration}
            bestIteration={lastAcceptedIteration}
            onFocusIteration={onFocusIteration}
          />
        </div>

        <div className="space-y-4">
          <OptimizationTrendCard points={correctnessSeries} />
          <div>
            <h3 className="text-xs font-semibold uppercase text-neutral-500">Recent runs</h3>
          <div className="h-52 overflow-auto rounded border border-neutral-200 bg-neutral-50">
            <ul className="divide-y divide-neutral-200 text-xs">
              {runHistory.length === 0 ? (
              <li className="px-3 py-2 text-neutral-500">No runs yet.</li>
              ) : (
                runHistory.map((run) => {
                  const summary = statusSummary(run.status);
                  const badgeTone = STATUS_BADGE_STYLES[run.status] ?? STATUS_BADGE_STYLES.idle;
                  return (
                    <li
                      key={run.id}
                      className={cn(
                        "cursor-pointer px-3 py-2 transition hover:bg-neutral-100",
                        selectedRunId === run.id && "bg-neutral-100 border-l-2 border-neutral-700",
                      )}
                      onClick={() => onSelectHistory(run)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{run.label}</span>
                        <span className="text-[10px] text-neutral-500">
                          {new Date(run.startedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-neutral-600">
                        <Badge variant="outline" className={cn("uppercase", badgeTone)}>
                          {summary.label}
                        </Badge>
                        <span>{run.datasetSize} rows</span>
                        {typeof run.bestScore === "number" ? <span>Best {run.bestScore.toFixed(2)}</span> : null}
                        {run.error ? <span className="text-red-600">{run.error}</span> : null}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type BestCandidateSource = "final" | "history" | "checkpoint";

type BestCandidateInfo = {
  prompt: string;
  iteration: number | null;
  score?: number;
  source: BestCandidateSource;
};

export function useBestCandidate(
  result: GEPAResult | null,
  history: CandidateTimelineEntry[],
  checkpoint: CheckpointState | null,
): BestCandidateInfo | null {
  return useMemo(() => {
    if (result?.bestCandidate?.system && result.bestCandidate.system.trim()) {
      return {
        prompt: result.bestCandidate.system,
        iteration: typeof result.iterations === "number" ? result.iterations : null,
        score: typeof result.bestScore === "number" ? result.bestScore : undefined,
        source: "final",
      } satisfies BestCandidateInfo;
    }

    const accepted = history.filter((entry) => entry.accepted);
    if (accepted.length > 0) {
      const latest = accepted[accepted.length - 1];
      if (latest.prompt && latest.prompt.trim()) {
        return {
          prompt: latest.prompt,
          iteration: latest.iteration,
          score: typeof latest.scores?.correctness === "number" ? latest.scores.correctness : undefined,
          source: "history",
        } satisfies BestCandidateInfo;
      }
    }

    const checkpointCandidates = checkpoint?.candidates ?? [];
    if (checkpointCandidates.length > 0) {
      const best = [...checkpointCandidates].reduce<CheckpointState["candidates"][number] | null>((acc, candidate) => {
        if (!acc) return candidate;
        return (candidate.scalarScore ?? 0) > (acc.scalarScore ?? 0) ? candidate : acc;
      }, null);
      const prompt = best?.candidate?.system ?? "";
      if (prompt.trim()) {
        return {
          prompt,
          iteration: checkpoint?.iteration ?? null,
          score: best?.scalarScore ?? undefined,
          source: "checkpoint",
        } satisfies BestCandidateInfo;
      }
    }

    return null;
  }, [checkpoint, history, result]);
}

function PausedBanner({
  latestCheckpoint,
  autoResumeExhausted,
  onResume,
}: {
  latestCheckpoint: CheckpointState | null;
  autoResumeExhausted: boolean;
  onResume?: () => void;
}) {
  if (!latestCheckpoint) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <div>
          <p className="font-semibold">Run paused</p>
          <p className="text-[11px] text-amber-800">
            Last checkpoint at iteration {latestCheckpoint.iteration}. Resume to continue optimization.
          </p>
          {autoResumeExhausted ? (
            <p className="mt-1 text-[11px] text-amber-800">
              Auto-resume retries have stopped. Click Resume run when your server is ready again.
            </p>
          ) : null}
        </div>
      </div>
      {onResume ? (
        <Button size="sm" onClick={() => void onResume()}>
          <Play className="mr-2 h-3.5 w-3.5" /> Resume run
        </Button>
      ) : null}
    </div>
  );
}

function BestCandidateCard({
  candidate,
  onApply,
  onResume,
}: {
  candidate: BestCandidateInfo;
  onApply: (prompt: string) => void;
  onResume?: () => void;
}) {
  const { prompt, iteration, score, source } = candidate;
  const sourceLabel = source === "final"
    ? "Best candidate"
    : source === "history"
      ? "Best so far"
      : "Checkpoint candidate";

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{sourceLabel}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
            {typeof iteration === "number" ? <span>Iteration {iteration}</span> : null}
            {typeof score === "number" ? <span>Score {score.toFixed(3)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => void navigator.clipboard?.writeText(prompt)}
          >
            Copy
          </Button>
          <Button size="sm" className="h-8" onClick={() => onApply(prompt.trim())}>
            Apply to system prompt
          </Button>
          {onResume ? (
            <Button size="sm" className="h-8" variant="outline" onClick={() => void onResume()}>
              <RefreshCw className="mr-2 h-3 w-3" /> Resume run
            </Button>
          ) : null}
        </div>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-neutral-50 px-4 py-3 font-mono text-[12px] leading-relaxed text-neutral-800">
        {prompt}
      </pre>
    </div>
  );
}

function RunProgressCard({ snapshot, status }: { snapshot: ReturnType<typeof useProgressSnapshot>; status: RunStatus }) {
  const { label } = statusSummary(status);
  const badgeClass = STATUS_BADGE_STYLES[status] ?? STATUS_BADGE_STYLES.idle;
  const rows: Array<{ label: string; value: string }> = [
    { label: "Iterations", value: snapshot.iterations },
    { label: "Elapsed", value: snapshot.elapsedLabel },
    { label: "Remaining", value: snapshot.remainingLabel ?? "Estimating…" },
    { label: "Est. total", value: snapshot.totalLabel ?? "Estimating…" },
  ];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-600">
          <Clock className="h-4 w-4" /> Run progress
        </div>
        <Badge variant="outline" className={cn("text-[10px] uppercase", badgeClass)}>
          {label}
        </Badge>
      </div>
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(1, snapshot.percent)) * 100}%` }}
          />
        </div>
        <dl className="mt-3 grid gap-2 text-[11px] text-neutral-600 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2">
              <dt className="uppercase text-neutral-400">{row.label}</dt>
              <dd className="font-mono text-[10px] text-neutral-700">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

type CandidateTimelineProps = {
  entries: CandidateTimelineEntry[];
  focusedIteration: number | null;
  bestIteration: number | null;
  onFocusIteration?: (iteration: number) => void;
};

type ScorerDiagnosticsCardProps = {
  diagnostics: ScorerDiagnosticsSummaryEntry[];
};

function ScorerDiagnosticsCard({ diagnostics }: ScorerDiagnosticsCardProps) {
  const failing = diagnostics.filter((item) => (item.failureRate ?? 0) > 0);
  const prioritized = (failing.length > 0 ? failing : diagnostics).slice(0, 4);

  if (prioritized.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-3 text-[11px] text-neutral-500">
        Run the optimizer to populate scorer diagnostics.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-neutral-500">Scorer diagnostics</h3>
          <p className="text-[11px] text-neutral-500">Most recent run outcomes by scorer.</p>
        </div>
      </div>
      <ul className="space-y-2">
        {prioritized.map((entry) => {
          const failurePercent =
            entry.failureRate !== null && entry.failureRate > 0 ? formatPercent(entry.failureRate) : null;
          const averageLabel = typeof entry.average === "number" ? entry.average.toFixed(2) : null;
          return (
            <li key={entry.id} className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-800">{entry.label}</div>
                  <div className="text-[11px] text-neutral-500">
                    {failurePercent ? `${failurePercent} failing` : "No failures"}
                    {entry.total > 0 ? ` • ${entry.failures}/${entry.total} rows` : null}
                    {averageLabel ? ` • avg ${averageLabel}` : null}
                  </div>
                  {entry.topNote ? (
                    <p className="mt-1 text-[11px] text-neutral-500">{truncateNote(entry.topNote)}</p>
                  ) : null}
                </div>
                {failurePercent ? (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] uppercase text-amber-700">
                    {failurePercent}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] uppercase text-emerald-700">
                    Stable
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatPercent(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function truncateNote(note: string, limit = 160): string {
  if (note.length <= limit) return note;
  return `${note.slice(0, limit - 1)}…`;
}

function CandidateTimeline({ entries, focusedIteration, bestIteration, onFocusIteration }: CandidateTimelineProps) {
  const label = entries.length === 1 ? "candidate" : "candidates";

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-neutral-500">Candidate timeline</h4>
        {focusedIteration !== null ? (
          <Badge variant="outline" className="border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] uppercase text-neutral-600">
            Focus {focusedIteration}
          </Badge>
        ) : null}
      </div>
      {entries.length > 0 ? (
        <>
          <p className="text-[11px] text-neutral-500">
            GEPA accepted {entries.length} {label} this run. Expand any row to inspect the system prompt captured at that iteration.
          </p>
          <div className="space-y-2">
            {entries.map((entry, index) => (
              <CandidateTimelineItem
                key={`${entry.iteration}-${index}`}
                entry={entry}
                isBest={bestIteration === entry.iteration}
                isFocused={focusedIteration === entry.iteration}
                onFocusIteration={onFocusIteration}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-6 text-center text-[11px] text-neutral-500">
          No accepted candidates yet. Run the optimizer to see which prompts reach the Pareto set.
        </div>
      )}
    </div>
  );
}
type OptimizationTrendCardProps = {
  points: Array<{ iteration: number; value: number }>;
};

function OptimizationTrendCard({ points }: OptimizationTrendCardProps) {
  const hasTrend = points.length > 1;
  const start = points[0]?.value ?? null;
  const end = points[points.length - 1]?.value ?? null;
  const delta = start !== null && end !== null ? end - start : null;

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-neutral-500">Optimization trend</h3>
          <p className="text-[11px] text-neutral-500">Correctness across accepted iterations.</p>
        </div>
        {end !== null ? (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
            Latest {end.toFixed(3)}
          </span>
        ) : null}
      </div>
      {hasTrend ? (
        <OptimizationSparkline points={points} />
      ) : (
        <p className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-3 text-[12px] text-neutral-500">
          Run the optimizer to populate the score trajectory.
        </p>
      )}
      {delta !== null ? (
        <div className="flex flex-wrap gap-4 text-[11px] text-neutral-500">
          {start !== null ? <span>Start {start.toFixed(3)}</span> : null}
          <span>
            Change {delta >= 0 ? "+" : ""}
            {delta.toFixed(3)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type OptimizationSparklineProps = {
  points: Array<{ iteration: number; value: number }>;
  width?: number;
  height?: number;
};

function OptimizationSparkline({ points, width = 240, height = 60 }: OptimizationSparklineProps) {
  if (points.length === 0) return null;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coordinates = points.map((point, index) => {
    const value = clamp(point.value);
    const x = index * step;
    const y = height - value * height;
    return { x, y, iteration: point.iteration, value: point.value, clamped: value, index };
  });

  const path = coordinates
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)},${coord.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${path} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Correctness trend sparkline"
      className="h-24 w-full text-emerald-500"
    >
      <defs>
        <linearGradient id="correctnessGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(16, 185, 129, 0.4)" />
          <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} rx={6} className="fill-neutral-50" />
      <path d={areaPath} fill="url(#correctnessGradient)" stroke="none" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {coordinates.map((coord) => (
        <circle
          key={`${coord.iteration}-${coord.index}`}
          cx={coord.x}
          cy={coord.y}
          r={3}
          className="fill-white stroke-current"
        >
          <title>
            Iteration {coord.iteration}: {coord.value.toFixed(3)}
          </title>
        </circle>
      ))}
    </svg>
  );
}

type CandidateTimelineItemProps = {
  entry: CandidateTimelineEntry;
  isBest: boolean;
  isFocused: boolean;
  onFocusIteration?: (iteration: number) => void;
};

function CandidateTimelineItem({ entry, isBest, isFocused, onFocusIteration }: CandidateTimelineItemProps) {
  const [open, setOpen] = useState(false);
  const hasPrompt = entry.prompt.trim().length > 0;
  const normalizedPreview = hasPrompt
    ? entry.prompt.replace(/\s+/g, " ").trim()
    : "";
  const preview = hasPrompt
    ? normalizedPreview.length > 200
      ? `${normalizedPreview.slice(0, 200)}…`
      : normalizedPreview
    : "";
  const scoreEntries = Object.entries(entry.scores ?? {});
  const scoresLabel = scoreEntries
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .map(([key, value]) => `${key}:${formatScoreValue(value)}`)
    .join("  ·  ");

  const containerClass = cn(
    "space-y-2 rounded-md border px-3 py-2 text-[12px] transition",
    isFocused
      ? "border-neutral-600 bg-white shadow-sm ring-1 ring-neutral-500"
      : "border-neutral-200 bg-white"
  );

  return (
    <div className={containerClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-neutral-700">
          <span className="font-semibold">Iteration {entry.iteration}</span>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] uppercase text-emerald-700">
            Accepted
          </Badge>
          {isBest ? (
            <Badge variant="outline" className="border-neutral-300 bg-neutral-100 text-[10px] uppercase text-neutral-600">
              Current best
            </Badge>
          ) : null}
          {isFocused ? (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] uppercase text-blue-700">
              Focused
            </Badge>
          ) : null}
        </div>
        {scoresLabel ? (
          <span className="font-mono text-[11px] text-neutral-600">{scoresLabel}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hasPrompt ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? "Hide prompt" : "View prompt"}
          </Button>
        ) : null}
        {hasPrompt ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => void navigator.clipboard?.writeText(entry.prompt)}
          >
            Copy prompt
          </Button>
        ) : null}
        {onFocusIteration ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => onFocusIteration(entry.iteration)}
          >
            View telemetry
          </Button>
        ) : null}
      </div>
      {hasPrompt ? (
        open ? (
          <div className="max-h-48 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-800 whitespace-pre-wrap">
            {entry.prompt}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-600">{preview}</p>
        )
      ) : (
        <p className="text-[11px] italic text-neutral-500">No system prompt captured for this iteration.</p>
      )}
    </div>
  );
}

export function computeResultStats(result: GEPAResult | null): RunStats {
  if (!result) return {};
  const base: RunStats = {
    bestScore: typeof result.bestScore === "number" ? result.bestScore : undefined,
    iterations: typeof result.iterations === "number" ? result.iterations : undefined,
    totalMetricCalls: typeof result.totalMetricCalls === "number" ? result.totalMetricCalls : undefined,
    totalCostUSD: typeof result.totalCostUSD === "number" ? result.totalCostUSD : undefined,
  };
  if (Array.isArray(result.paretoFront) && result.paretoFront.length > 0) {
    const hv = hypervolume2D(
      result.paretoFront
        .map((entry) => entry.scores)
        .filter((scores) => scores && typeof scores === "object"),
    );
    if (typeof hv === "number" && Number.isFinite(hv)) {
      base.hypervolume2D = hv;
    }
  }
  const latencyMs = extractLatencyMs(result);
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
    base.bestLatencyMs = latencyMs;
  }
  return base;
}

type StatTileProps = {
  label: string;
  value: number | undefined;
  tooltip?: string;
  format?: (value: number) => string;
};

function StatTile({ label, value, format, tooltip }: StatTileProps) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs">
      <div className="flex items-center gap-1 text-[10px] uppercase text-neutral-500">
        <span>{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
              >
                ⓘ
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="text-sm font-medium">
        {typeof value === "number" ? (format ? format(value) : value.toString()) : "—"}
      </div>
    </div>
  );
}

function formatScoreValue(value: unknown): string {
  if (typeof value === "number") {
    return value.toFixed(3);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric.toFixed(3);
    }
  }
  return String(value);
}
