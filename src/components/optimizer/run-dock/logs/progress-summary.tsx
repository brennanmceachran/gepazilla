"use client";

import { Check, Info } from "lucide-react";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { RunStatus } from "../../types";
import type { ProgressInfo } from "../logs-panel";

function formatElapsedDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function statusSummary(status: RunStatus) {
  switch (status) {
    case "running":
      return { label: "Running", tone: "text-emerald-600" };
    case "starting":
      return { label: "Starting", tone: "text-blue-600" };
    case "resuming":
      return { label: "Resuming", tone: "text-orange-600" };
    case "paused":
      return { label: "Paused", tone: "text-amber-600" };
    case "completed":
      return { label: "Completed", tone: "text-neutral-500" };
    case "errored":
      return { label: "Failed", tone: "text-red-600" };
    case "aborted":
      return { label: "Aborted", tone: "text-amber-600" };
    default:
      return { label: "Idle", tone: "text-neutral-500" };
  }
}

export function useProgressSnapshot(progress: ProgressInfo) {
  return useMemo(() => {
    const percent = Math.min(1, Math.max(0, progress.percent));
    const iterations = progress.maxIterations
      ? `${Math.min(progress.currentIteration, progress.maxIterations)} / ${progress.maxIterations}`
      : `${progress.currentIteration}`;

    return {
      percent,
      elapsedLabel: formatElapsedDuration(progress.elapsedMs),
      iterations,
      averageLabel: progress.averageIterationMs
        ? formatElapsedDuration(progress.averageIterationMs)
        : null,
      remainingLabel: progress.remainingMs ? formatElapsedDuration(progress.remainingMs) : null,
      totalLabel: progress.estimatedTotalMs ? formatElapsedDuration(progress.estimatedTotalMs) : null,
    };
  }, [progress]);
}

export function ProgressSummary({
  status,
  progress,
}: {
  status: RunStatus;
  progress: ProgressInfo;
}) {
  const snapshot = useProgressSnapshot(progress);
  const { tone, label } = statusSummary(status);
  const effectiveLabel = progress.finalizing && status === "running" ? "Finishing" : label;
  const showIndicator = status === "running" || status === "starting" || status === "resuming";
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handlePointer);
    return () => window.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div className="relative flex flex-col gap-1 text-[11px] text-neutral-500">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {showIndicator ? (
            <span className="inline-flex h-2.5 w-2.5 animate-spin rounded-full border border-neutral-300 border-t-neutral-600" />
          ) : status === "completed" ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <span className="inline-flex h-2.5 w-2.5 rounded-full border border-neutral-300" />
          )}
          <span className={tone}>{effectiveLabel}</span>
        </div>
        <span className="font-mono text-[10px] text-neutral-600">
          {snapshot.elapsedLabel}
          {snapshot.totalLabel ? (
            <>
              {"/"}
              <span className="text-neutral-400">
                {snapshot.totalLabel}
                {status === "running" ? " (est)" : ""}
              </span>
            </>
          ) : status === "running" ? (
            <>
              {" / "}
              <span className="text-neutral-400">estimating…</span>
            </>
          ) : null}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-neutral-400"
          aria-label="Run details"
          onClick={() => setOpen((prev) => !prev)}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="h-[2px] w-full overflow-hidden bg-neutral-200/90">
        <div
          className={clsx(
            "h-full transition-[width] duration-300",
            status === "completed"
              ? "bg-emerald-500"
              : status === "running" || status === "starting"
                ? "bg-gradient-to-r from-sky-500 to-blue-500"
                : "bg-neutral-300"
          )}
          style={{ width: `${snapshot.percent * 100}%` }}
        />
      </div>
      {open ? (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-neutral-200 bg-white p-3 text-[11px] shadow-xl"
        >
          <div className="flex items-center justify-between text-[10px] uppercase text-neutral-400">
            <span>Run stats</span>
            <span>{snapshot.elapsedLabel}</span>
          </div>
          <div className="mt-2 space-y-1">
            <DetailRow label="Iterations" value={snapshot.iterations} />
            {snapshot.averageLabel ? (
              <DetailRow label="Avg iteration" value={snapshot.averageLabel} />
            ) : null}
            {snapshot.remainingLabel ? (
              <DetailRow label="Est remaining" value={snapshot.remainingLabel} />
            ) : null}
            {snapshot.totalLabel ? (
              <DetailRow label="Est total" value={snapshot.totalLabel} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] text-neutral-600">
      <span>{label}</span>
      <span className="font-mono text-[10px] text-neutral-500">{value}</span>
    </div>
  );
}
