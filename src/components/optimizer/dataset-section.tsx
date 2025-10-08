"use client";

import { useMemo } from "react";
import { MoreHorizontal, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { OptimizeScorerConfig } from "@/lib/schemas";
import type { ScorerEvaluation } from "@/lib/scorers";
import type {
  DatasetCollection,
  DatasetKey,
  DatasetRow,
  ScoreboardCollection,
  ScoreboardState,
  SelectedRowMap,
} from "./types";

const formatScore = (evaluation?: ScorerEvaluation, fallback = "—") => {
  if (!evaluation) return fallback;
  if (evaluation.status === "pending") return "…";
  if (evaluation.status === "error") return "Err";
  if (typeof evaluation.value === "number") return evaluation.value.toFixed(2);
  return fallback;
};

type DatasetRowView = DatasetRow & { dataset: DatasetKey };

type DatasetSectionProps = {
  datasets: DatasetCollection;
  scoreboards: ScoreboardCollection;
  scorers: OptimizeScorerConfig[];
  selectedRowIds: SelectedRowMap;
  onSelectRow: (key: DatasetKey, id: string) => void;
  onAddRow: (key: DatasetKey) => void;
  onDuplicateRow: (key: DatasetKey, id: string) => void;
  onRemoveRow: (key: DatasetKey, id: string) => void;
  onMoveRow: (from: DatasetKey, to: DatasetKey, id: string) => void;
  showDisabledScorers: boolean;
  inspectorOpen: boolean;
  onInspectorOpenChange: (value: boolean) => void;
  onCopyDataset: (key: DatasetKey) => Promise<void>;
  onPasteDataset: (key: DatasetKey) => Promise<void>;
  updateDatasetRow: (key: DatasetKey, id: string, field: "input" | "expectedOutput", value: string) => void;
};

export function DatasetSection(props: DatasetSectionProps) {
  const {
    datasets,
    scoreboards,
    scorers,
    selectedRowIds,
    onSelectRow,
    onAddRow,
    onDuplicateRow,
    onRemoveRow,
    onMoveRow,
    showDisabledScorers,
    inspectorOpen,
    onInspectorOpenChange,
    onCopyDataset,
    onPasteDataset,
    updateDatasetRow,
  } = props;

  const combinedRows: DatasetRowView[] = useMemo(() => {
    return [
      ...datasets.training.map((row) => ({ ...row, dataset: "training" as const })),
      ...datasets.validation.map((row) => ({ ...row, dataset: "validation" as const })),
    ];
  }, [datasets]);

  const hasValidationRows = datasets.validation.length > 0;

  const visibleScorers = useMemo(
    () =>
      scorers.filter((scorer) => (showDisabledScorers ? true : scorer.enabled && scorer.weight > 0)),
    [scorers, showDisabledScorers],
  );

  const selectedTrainingId = selectedRowIds.training;
  const selectedValidationId = selectedRowIds.validation;
  const selectedRow = combinedRows.find((row) =>
    row.dataset === "training" ? row.id === selectedTrainingId : row.id === selectedValidationId,
  );
  const activeDataset = selectedRow?.dataset ?? "training";
  const activeScoreboard = scoreboards[activeDataset];

  const totalRows = combinedRows.length;
  return (
    <Card className="border-neutral-200 shadow-sm">
      <CardHeader className="gap-2 pb-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Dataset</CardTitle>
            <CardDescription className="text-xs text-neutral-500">
              Add training data for GEPA to improve the system prompt. Mark rows as validation to test GEPA without exposing
              them to the model. Expected outputs are optional and help benchmark changes.
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-600">
                <span className="sr-only">Dataset tools</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void onCopyDataset("training")}>Copy training JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onPasteDataset("training")}>Paste into training</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onPasteDataset("validation")}>
                Paste into validation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        {hasValidationRows ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
            Training rows fuel prompt edits; validation rows stay untouched to rank candidates on the Pareto frontier. Click a
            row’s use pill to swap it between Training and Validation.
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-amber-300 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-700">
            Add at least one validation example so GEPA can maintain its Pareto frontier—without it every candidate will
            look “best” on training only. Click the use pill beside each row to toggle Training/Validation.
          </p>
        )}

        <div className="rounded-md border border-neutral-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-[11px] uppercase tracking-wide text-neutral-500">#</TableHead>
                <TableHead className="w-20 text-[11px] uppercase tracking-wide text-neutral-500">
                  <div className="flex items-center gap-1">
                    <span>Use</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
                        >
                          ⓘ
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Pick whether GEPA uses this example for reflection (Training) or for Pareto scoring only (Validation).
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="min-w-[260px] text-[11px] uppercase tracking-wide text-neutral-500">
                  <div className="flex items-center gap-1">
                    <span>Input</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
                        >
                          ⓘ
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Model inputs supplied to the task prompt—transcripts, questions, or context.</TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="min-w-[260px] text-[11px] uppercase tracking-wide text-neutral-500">
                  <div className="flex items-center gap-1">
                    <span>Expected Output (optional)</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
                        >
                          ⓘ
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Optional reference output used by exact-match or deviation scorers.</TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                {visibleScorers.map((scorer) => (
                  <TableHead key={scorer.id} className="w-20 text-[11px] uppercase tracking-wide text-neutral-500">
                    {scorer.label}
                  </TableHead>
                ))}
                <TableHead className="w-14 text-[11px] uppercase tracking-wide text-neutral-500">
                  <div className="flex items-center gap-1">
                    <span>Total</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
                        >
                          ⓘ
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Weighted average of enabled scorer outputs for this row.</TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="w-12 text-[11px] uppercase tracking-wide text-neutral-500">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totalRows === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleScorers.length + 6} className="py-12 text-center text-sm text-neutral-500">
                    Add a few rows to start experimenting.
                  </TableCell>
                </TableRow>
              ) : (
                combinedRows.map((row, index) => {
                  const map = scoreboards[row.dataset];
                  const rowScore = map[row.id];
                  const total = computeTotal(rowScore, scorers);
                  const isValidation = row.dataset === "validation";
                  const isSelected =
                    (row.dataset === "training" && selectedTrainingId === row.id)
                    || (row.dataset === "validation" && selectedValidationId === row.id);
                  const rowEvaluation = (scorerId: string) => {
                    const cell = rowScore?.[scorerId];
                    return cell?.run ?? cell?.preview;
                  };
                  return (
                    <TableRow
                      key={`${row.dataset}-${row.id}`}
                      className={cn(
                        isSelected && (isValidation ? "bg-amber-100/80" : "bg-neutral-50"),
                        isValidation
                          ? "bg-amber-50/60 text-neutral-600 hover:bg-amber-100/70"
                          : "hover:bg-neutral-50",
                      )}
                    >
                      <TableCell className="align-top text-[11px] text-neutral-500">{index + 1}</TableCell>
                      <TableCell className="align-top w-24">
                        <button
                          type="button"
                          onClick={() =>
                            onMoveRow(row.dataset, row.dataset === "training" ? "validation" : "training", row.id)
                          }
                          className={cn(
                            "inline-flex w-full items-center justify-center rounded-full border px-2 py-1 text-[11px] font-medium transition",
                            isValidation
                              ? "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100"
                              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
                          )}
                        >
                          {isValidation ? "Validation" : "Training"}
                        </button>
                      </TableCell>
                      <TableCell className="align-top min-w-[260px]">
                        <Textarea
                          value={row.input}
                          onChange={(event) => updateDatasetRow(row.dataset, row.id, "input", event.target.value)}
                          className="h-24 resize-none text-[13px] leading-snug"
                          placeholder="Model input"
                        />
                      </TableCell>
                      <TableCell className="align-top min-w-[260px]">
                        <Textarea
                          value={row.expectedOutput}
                          onChange={(event) =>
                            updateDatasetRow(row.dataset, row.id, "expectedOutput", event.target.value)
                          }
                          className="h-24 resize-none text-[13px] leading-snug"
                          placeholder="Optional gold output"
                        />
                      </TableCell>
                      {visibleScorers.map((scorer) => {
                        const evaluation = rowEvaluation(scorer.id);
                        const missingGold =
                          scorer.type === "exact_match" && (!row.expectedOutput || row.expectedOutput.trim().length === 0);
                        return (
                          <TableCell key={scorer.id} className="align-top text-[13px]">
                            <span
                              className={cn(
                                "inline-flex min-w-[2.5rem] items-center justify-center rounded-md border px-2 py-1 text-xs",
                                evaluation?.status === "ready" && !missingGold &&
                                  "border-emerald-200 bg-emerald-50 text-emerald-700",
                                evaluation?.status === "pending" && "border-amber-200 bg-amber-50 text-amber-700",
                                evaluation?.status === "error" && "border-red-200 bg-red-50 text-red-700",
                                missingGold && "border-rose-200 bg-rose-50 text-rose-600",
                              )}
                              title={missingGold ? "Add an expected output to enable exact match scoring." : evaluation?.notes}
                            >
                              {formatScore(evaluation ?? { status: "idle", value: null })}
                            </span>
                          </TableCell>
                        );
                      })}
                      <TableCell className="align-top text-[13px] font-medium">
                        {typeof total === "number" ? total.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="align-top">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500">
                              <span className="sr-only">Row actions</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onSelectRow(row.dataset, row.id)}>
                              Inspect
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDuplicateRow(row.dataset, row.id)}>
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onMoveRow(row.dataset, row.dataset === "training" ? "validation" : "training", row.id)}
                            >
                              {row.dataset === "training" ? "Move to validation" : "Move to training"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onRemoveRow(row.dataset, row.id)} className="text-red-600">
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <Sheet open={inspectorOpen && Boolean(selectedRow)} onOpenChange={onInspectorOpenChange}>
          <SheetContent className="w-[420px] sm:w-[420px]">
            <SheetHeader>
              <SheetTitle>Row inspector</SheetTitle>
            </SheetHeader>
            {selectedRow ? (
              <div className="mt-4 flex flex-col gap-4 text-sm text-neutral-700">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-neutral-500">Input</h3>
                  <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    {selectedRow.input || <span className="text-neutral-400">(empty)</span>}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase text-neutral-500">Expected output</h3>
                  <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    {selectedRow.expectedOutput || <span className="text-neutral-400">(empty)</span>}
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase text-neutral-500">Scorers</h3>
                  {scorers.map((scorer) => {
                    const rowScore = activeScoreboard[selectedRow.id]?.[scorer.id];
                    const evaluation = rowScore?.run ?? rowScore?.preview;
                    return (
                      <div key={scorer.id} className="rounded-md border border-neutral-200 bg-white p-2">
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span>{scorer.label}</span>
                          <span
                            className={cn(
                              "text-xs",
                              evaluation?.status === "ready" && "text-emerald-600",
                              evaluation?.status === "pending" && "text-amber-600",
                              evaluation?.status === "error" && "text-red-600",
                            )}
                          >
                            {formatScore(evaluation ?? { status: "idle", value: null })}
                          </span>
                        </div>
                        {evaluation?.notes ? (
                          <p className="mt-2 text-xs text-neutral-500">{evaluation.notes}</p>
                        ) : null}
                  </div>
                );
              })}
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
        <div className="flex justify-start pt-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => onAddRow("training")}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add row
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const computeTotal = (rowScore: ScoreboardState | undefined, scorers: OptimizeScorerConfig[]) => {
  if (!rowScore) return null;
  let sum = 0;
  let weight = 0;
  for (const scorer of scorers) {
    if (!scorer.enabled || scorer.weight <= 0) continue;
    const cell = rowScore[scorer.id];
    const evaluation = cell?.run ?? cell?.preview;
    if (!evaluation || evaluation.status !== "ready" || typeof evaluation.value !== "number") continue;
    weight += scorer.weight;
    sum += scorer.weight * evaluation.value;
  }
  if (weight === 0) return null;
  return sum / weight;
};
