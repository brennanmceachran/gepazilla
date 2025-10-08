"use client";

import { ChevronsUpDown, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

import type { RunStatus } from "../types";
import type { SheetState } from "./bottom-sheet";
import type { ProgressInfo } from "./logs-panel";
import { ProgressSummary } from "./logs/progress-summary";

export type RunDockHeaderProps = {
  sheetState: SheetState;
  onCycleState: () => void;
  datasetSummary: ReactNode;
  status: RunStatus;
  disableStart: boolean;
  onStart: () => Promise<void>;
  onAbort: () => void;
  progress: ProgressInfo;
  onResume?: () => Promise<void>;
};

export function RunDockHeader({
  sheetState,
  onCycleState,
  datasetSummary,
  status,
  disableStart,
  onStart,
  onAbort,
  progress,
  onResume,
}: RunDockHeaderProps) {
  const cycleLabel =
    sheetState === "peek"
      ? "Expand Run Console"
      : sheetState === "short"
      ? "Maximize Run Console"
      : "Collapse Run Console";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCycleState}
          className="flex items-center justify-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-500 shadow-sm transition hover:bg-neutral-100"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
          {cycleLabel}
        </button>
        {datasetSummary}
        <RunHeaderActions
          status={status}
          disableStart={disableStart}
          onStart={onStart}
          onAbort={onAbort}
          progress={progress}
          onResume={onResume}
        />
      </div>
    </div>
  );
}

type RunHeaderActionsProps = {
  status: RunStatus;
  disableStart: boolean;
  onStart: () => Promise<void>;
  onAbort: () => void;
  progress: ProgressInfo;
  onResume?: () => Promise<void>;
};

export function RunHeaderActions({
  status,
  disableStart,
  onStart,
  onAbort,
  progress,
  onResume,
}: RunHeaderActionsProps) {
  const isRunning = status === "running" || status === "resuming";
  const isStarting = status === "starting" || status === "resuming";
  const startDisabled = disableStart || isStarting;

  const handleClick = () => {
    if (isRunning) {
      onAbort();
    } else if (status === "paused" && onResume) {
      void onResume();
    } else if (!startDisabled) {
      void onStart();
    }
  };

  const label = (() => {
    if (isRunning) return "Stop";
    if (status === "paused") return "Resume Run";
    return "Start Run";
  })();

  return (
    <div className="flex flex-1 items-center justify-end gap-3">
      <ProgressSummary status={status} progress={progress} />
      <Button
        size="sm"
        variant={isRunning ? "destructive" : "default"}
        onClick={handleClick}
        disabled={!isRunning && startDisabled}
      >
        {isRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {label}
      </Button>
    </div>
  );
}
