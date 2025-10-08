"use client";

import { useCallback, useState } from "react";

import type { OptimizeScorerConfig } from "@/lib/schemas";

import { DatasetSection } from "./dataset-section";
import { ScorerPanel } from "./scorer-panel";
import { RunDock } from "./run-dock";
import { useOptimizerState } from "./use-optimizer-state";
import type { LogChannel } from "./types";
import { SystemPromptCard } from "./system-prompt-card";
import { GuideDrawer } from "./guide-drawer";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

type OptimizerAppProps = {
  hasGatewayKey: boolean;
};

export function OptimizerApp({ hasGatewayKey }: OptimizerAppProps) {
  const state = useOptimizerState({ hasServerGatewayKey: hasGatewayKey });
  const [isGuideOpen, setGuideOpen] = useState(false);

  const datasetCounts = {
    training: state.datasets.training.length,
    validation: state.datasets.validation.length,
  } as const;

  const disableStart =
    state.status === "running" ||
    state.status === "starting" ||
    state.status === "resuming" ||
    state.datasetPayloads.training.length === 0 ||
    state.scorers.every((scorer) => !scorer.enabled || scorer.weight <= 0);
  const needsGatewayKey = !hasGatewayKey && !state.config.gatewayApiKey.trim();

  const handleToggleChannel = useCallback(
    (level: LogChannel) => {
      state.setSelectedChannels((prev) => {
        const next = new Set(prev);
        if (next.has(level)) {
          next.delete(level);
        } else {
          next.add(level);
        }
        return next;
      });
    },
    [state],
  );

  const handleToggleScorerEnabled = useCallback(
    (id: string, enabled: boolean) => {
      state.updateScorer(id, { enabled });
    },
    [state],
  );

  const handleLabelChange = useCallback(
    (id: string, value: string) => {
      state.updateScorer(id, { label: value });
    },
    [state],
  );

  const handleWeightChange = useCallback(
    (id: string, weight: number) => {
      state.updateScorer(id, { weight });
    },
    [state],
  );

  const handleParamsChange = useCallback(
    (id: string, params: Record<string, unknown>) => {
      state.updateScorerParams(id, params);
    },
    [state],
  );

  const handleAddScorer = useCallback(
    (type: OptimizeScorerConfig["type"]) => {
      state.addScorer(type);
    },
    [state],
  );

  return (
    <div className="relative flex flex-col gap-8 pb-72">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            <span role="img" aria-hidden>
              🦖
            </span>
            GEPAzilla
          </span>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
              Optimizer Console
            </h1>
            <p className="max-w-2xl text-sm text-neutral-600">
              Blend scorer metrics, track latency, and let GEPA iterate your system prompt on a lightweight dataset. GEPAzilla keeps every token local while it crunches through your evaluation stack.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start md:self-auto">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-emerald-300 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.18)] transition hover:border-emerald-400 hover:bg-emerald-50"
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen className="mr-2 h-4 w-4" /> How it works
          </Button>
        </div>
      </div>

      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{state.error}</p>
          {state.errorCode === "checkpoint_available" && state.latestCheckpoint ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  void state.startRun({ resumeCheckpoint: state.latestCheckpoint ?? undefined });
                }}
              >
                Resume from last checkpoint
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <SystemPromptCard
        value={state.config.seedSystemPrompt}
        onChange={state.updateSeedPrompt}
        status={state.status}
      />

      <ScorerPanel
        scorers={state.scorers}
        pluginOptions={state.pluginOptions}
        onAddScorer={handleAddScorer}
        onToggleEnabled={handleToggleScorerEnabled}
        onLabelChange={handleLabelChange}
        onWeightChange={handleWeightChange}
        onParamsChange={handleParamsChange}
        onDuplicate={state.duplicateScorer}
        onRemove={state.removeScorer}
        showDisabled={state.showDisabledScorers}
        onToggleDisabled={state.setShowDisabledScorers}
        gatewayApiKey={state.config.gatewayApiKey}
        hasGatewayKey={hasGatewayKey}
      />

      <DatasetSection
        datasets={state.datasets}
        scoreboards={state.scoreboards}
        scorers={state.scorers}
        selectedRowIds={state.selectedRowIds}
        onSelectRow={state.selectRow}
        onAddRow={state.addRow}
        onDuplicateRow={state.duplicateRow}
        onRemoveRow={state.removeRow}
        onMoveRow={state.moveRow}
        showDisabledScorers={state.showDisabledScorers}
        inspectorOpen={state.inspectorOpen}
        onInspectorOpenChange={state.setInspectorOpen}
        onCopyDataset={state.copyDataset}
        onPasteDataset={state.pasteDataset}
        updateDatasetRow={state.updateDatasetRow}
      />

      <RunDock
        open={state.dockOpen}
        onToggle={state.setDockOpen}
        logs={state.logs}
        telemetryRecords={state.telemetryRecords}
        candidateHistory={state.candidateHistory}
        scorerDiagnostics={state.scorerDiagnostics}
        selectedChannels={state.selectedChannels}
        onToggleChannel={handleToggleChannel}
        runHistory={state.runHistory}
        stats={state.currentStats}
        result={state.result}
        runProgress={state.runProgress}
        config={state.config}
        status={state.status}
        onConfigField={state.handleConfigField}
        onConfigNumberField={state.handleConfigNumberField}
        onConfigOptionalNumberField={state.handleConfigOptionalNumberField}
        datasetCounts={datasetCounts}
        onStart={state.startRun}
        onAbort={state.abortRun}
        disableStart={disableStart}
        needsGatewayKey={needsGatewayKey}
        onApplySystemPrompt={state.updateSeedPrompt}
        hasGatewayKey={hasGatewayKey}
        latestCheckpoint={state.latestCheckpoint}
        onResumeFromCheckpoint={state.resumeFromCheckpoint}
        iterationOffset={state.iterationOffset}
        autoResumeExhausted={state.autoResumeExhausted}
      />

      <GuideDrawer open={isGuideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}
