"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { ChevronDown, Copy, Info, MoreHorizontal, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  evaluateRegexPresence,
  regexPresenceSchema,
  resolvePlugin,
  type RegexPresenceParams,
  type ScorerEvaluation,
} from "@/lib/scorers";

import type { OptimizeScorerConfig } from "@/lib/schemas";
import { useGatewayModels, type ModelOption } from "./use-gateway-models";


type ScorerPanelProps = {
  scorers: OptimizeScorerConfig[];
  pluginOptions: { type: OptimizeScorerConfig["type"]; label: string }[];
  onAddScorer: (type: OptimizeScorerConfig["type"]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onLabelChange: (id: string, value: string) => void;
  onWeightChange: (id: string, weight: number) => void;
  onParamsChange: (id: string, params: Record<string, unknown>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  showDisabled: boolean;
  onToggleDisabled: (value: boolean) => void;
  gatewayApiKey?: string | null;
  hasGatewayKey: boolean;
};

export function ScorerPanel(props: ScorerPanelProps) {
  const {
    scorers,
    pluginOptions,
    onAddScorer,
    onToggleEnabled,
    onLabelChange,
    onWeightChange,
    onParamsChange,
    onDuplicate,
    onRemove,
    showDisabled,
    onToggleDisabled,
    gatewayApiKey,
    hasGatewayKey,
  } = props;

  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const trimmedGatewayKey = gatewayApiKey?.trim();
  const { models: judgeModels, loading: judgeModelsLoading } = useGatewayModels({
    apiKey: trimmedGatewayKey,
    enabled: hasGatewayKey || Boolean(trimmedGatewayKey),
  });

  const { activeScorers, disabledScorers, latencyScorer } = useMemo(() => {
    const active = [] as OptimizeScorerConfig[];
    const disabled = [] as OptimizeScorerConfig[];
    let latency: OptimizeScorerConfig | undefined;
    for (const scorer of scorers) {
      if (scorer.type === "latency_builtin") {
        latency = scorer;
        continue;
      }
      if (scorer.enabled) {
        active.push(scorer);
      } else {
        disabled.push(scorer);
      }
    }
    return { activeScorers: active, disabledScorers: disabled, latencyScorer: latency };
  }, [scorers]);

  const isExpanded = (id: string) => expandedRows.includes(id);
  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => (prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]));
  };

  return (
    <Card className="border-neutral-200 shadow-sm">
      <CardHeader className="gap-1 pb-1">
        <CardTitle className="text-base">Scoring Criteria</CardTitle>
        <CardDescription className="text-xs text-neutral-500">
          Add evaluation metrics for model outputs using the above system prompt. These will judge the outputs and help
          GEPA craft better prompts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        {activeScorers.length > 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="divide-y divide-neutral-200">
              {activeScorers.map((scorer) => {
                const plugin = resolvePlugin(scorer.type);
                const hint = getScorerSummary(scorer);
                const expanded = isExpanded(scorer.id);
                return (
                  <div key={scorer.id} className={cn("transition-colors", expanded && "bg-neutral-50")}> 
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(scorer.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-200/40"
                        aria-label={expanded ? "Collapse scorer" : "Expand scorer"}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                        />
                      </button>
                      <Checkbox
                        checked={scorer.enabled}
                        onCheckedChange={(checked) => onToggleEnabled(scorer.id, Boolean(checked))}
                        className="mt-0.5"
                      />
                      <Input
                        value={scorer.label}
                        onChange={(event) => onLabelChange(scorer.id, event.target.value)}
                        className="h-8 flex-1 text-sm"
                      />
                      <div className="hidden min-w-[140px] items-center gap-1 text-[11px] text-neutral-500 sm:flex">
                        {plugin?.previewNotes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-neutral-400 transition hover:text-neutral-600"
                                aria-label={`More about ${scorer.label}`}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {plugin.previewNotes}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        <span className="truncate">{hint}</span>
                      </div>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.1}
                        value={scorer.weight}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isNaN(next)) {
                            onWeightChange(scorer.id, next);
                          }
                        }}
                        className="h-8 w-16 text-xs"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-500">
                            <span className="sr-only">Scorer actions</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => toggleExpanded(scorer.id)}>
                            {expanded ? "Collapse details" : "Expand details"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(scorer.id)}>
                            <Copy className="mr-2 h-3 w-3" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRemove(scorer.id)} className="text-red-600">
                            <Trash className="mr-2 h-3 w-3" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {expanded ? (
                      <div className="border-t border-neutral-200 bg-neutral-50 px-4 pb-3 pt-2 text-xs text-neutral-600 sm:px-8">
                        <div className="px-1 pb-2 text-[11px] text-neutral-500 sm:hidden">{hint}</div>
                        <ScorerParamsFields
                          scorer={scorer}
                          onParamsChange={onParamsChange}
                          judgeModels={judgeModels}
                          judgeModelsLoading={judgeModelsLoading}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {latencyScorer ? (
          <p className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
            GEPA already optimizes request latency internally; the Results tab always includes the latency metric.
          </p>
        ) : null}

        {scorers.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
            No scorers yet. Add one to tell GEPA what “better” means for this dataset.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select onValueChange={(value) => onAddScorer(value as OptimizeScorerConfig["type"])}>
            <SelectTrigger className="h-8 w-[200px] text-sm">
              <SelectValue placeholder="Add scorer" />
            </SelectTrigger>
            <SelectContent>
              {pluginOptions
                .filter((plugin) => plugin.type !== "latency_builtin")
                .map((plugin) => (
                  <SelectItem key={plugin.type} value={plugin.type}>
                    {plugin.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-neutral-600"
            onClick={() => onToggleDisabled(!showDisabled)}
          >
            {showDisabled ? "Hide disabled scorers" : "Show disabled scorers"}
          </Button>
        </div>

        {showDisabled && disabledScorers.length > 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <p className="px-1 text-xs font-semibold uppercase text-neutral-500">Disabled scorers</p>
            <div className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
              {disabledScorers.map((scorer) => {
                const plugin = resolvePlugin(scorer.type);
                const hint = getScorerSummary(scorer);
                const expanded = isExpanded(scorer.id);
                return (
                  <div
                    key={scorer.id}
                    className={cn("transition-colors", expanded && "bg-neutral-50")}
                  >
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(scorer.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-200/40"
                        aria-label={expanded ? "Collapse scorer" : "Expand scorer"}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                      </button>
                      <Checkbox
                        checked={scorer.enabled}
                        onCheckedChange={(checked) => onToggleEnabled(scorer.id, Boolean(checked))}
                        className="mt-0.5"
                      />
                      <Input
                        value={scorer.label}
                        onChange={(event) => onLabelChange(scorer.id, event.target.value)}
                        className="h-8 flex-1 text-sm"
                      />
                      <div className="hidden min-w-[140px] items-center gap-1 text-[11px] text-neutral-500 sm:flex">
                        {plugin?.previewNotes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-neutral-400 transition hover:text-neutral-600"
                                aria-label={`More about ${scorer.label}`}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {plugin.previewNotes}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        <span className="truncate">{hint}</span>
                      </div>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.1}
                        value={scorer.weight}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isNaN(next)) {
                            onWeightChange(scorer.id, next);
                          }
                        }}
                        className="h-8 w-16 text-xs"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-400">
                            <span className="sr-only">Scorer actions</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => toggleExpanded(scorer.id)}>
                            {expanded ? "Collapse details" : "Expand details"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(scorer.id)}>
                            <Copy className="mr-2 h-3 w-3" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRemove(scorer.id)} className="text-red-600">
                            <Trash className="mr-2 h-3 w-3" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {expanded ? (
                      <div className="border-t border-neutral-200 bg-neutral-50 px-4 pb-3 pt-2 text-xs text-neutral-600 sm:px-8">
                        <div className="px-1 pb-2 text-[11px] text-neutral-500 sm:hidden">{hint}</div>
                        <ScorerParamsFields
                          scorer={scorer}
                          onParamsChange={onParamsChange}
                          judgeModels={judgeModels}
                          judgeModelsLoading={judgeModelsLoading}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type ScorerParamsFieldsProps = {
  scorer: OptimizeScorerConfig;
  onParamsChange: (id: string, params: Record<string, unknown>) => void;
  judgeModels: ModelOption[];
  judgeModelsLoading: boolean;
};

function ScorerParamsFields(props: ScorerParamsFieldsProps) {
  const { scorer, onParamsChange, judgeModels, judgeModelsLoading } = props;
  const params = scorer.params ?? {};
  switch (scorer.type) {
    case "exact_match":
      return (
        <div className="space-y-2 text-[11px] text-neutral-500">
          <p>Scores 1 only when the candidate matches the row’s expected output exactly (case-insensitive).</p>
          <p>
            Use this when you have deterministic gold answers. Leave Expected Output blank on rows you want this scorer to
            skip.
          </p>
        </div>
      );
    case "regex_presence":
      return <RegexParamsFields scorer={scorer} onParamsChange={onParamsChange} />;
    case "length_ratio":
      return <LengthRatioFields params={params} scorerId={scorer.id} onParamsChange={onParamsChange} />;
    case "llm_rubric":
      return (
        <LLMRubricFields
          scorer={scorer}
          onParamsChange={onParamsChange}
          modelOptions={judgeModels}
          modelsLoading={judgeModelsLoading}
        />
      );
    case "latency_builtin":
      return (
        <p className="text-[11px] text-neutral-500">Surfaces the adapter’s built-in latency metric.</p>
      );
    default:
      return <Fragment />;
  }
}

type RegexParamsFieldsProps = {
  scorer: OptimizeScorerConfig;
  onParamsChange: (id: string, params: Record<string, unknown>) => void;
};

const REGEX_MODE_OPTIONS: Array<{
  value: RegexPresenceParams["mode"];
  label: string;
  helper: string;
}> = [
  {
    value: "any",
    label: "Must appear at least once",
    helper: "Passes when the pattern matches at least one time (0 matches score 0, 1+ matches score 1).",
  },
  {
    value: "at_least",
    label: "Must appear at least N times",
    helper: "Score 1 when the pattern matches N or more times; otherwise 0.",
  },
  {
    value: "at_most",
    label: "Must appear at most N times",
    helper: "Score 1 when matches stay at or below the limit; otherwise 0.",
  },
  {
    value: "between",
    label: "Keep matches within a range",
    helper: "Score 1 when matches fall between the min and max (inclusive).",
  },
  {
    value: "scaled",
    label: "Reward more matches up to N",
    helper: "Score ramps from 0 → 1 as matches approach the target count, capped at 1 beyond it.",
  },
];

function RegexParamsFields({ scorer, onParamsChange }: RegexParamsFieldsProps) {
  const rawParams = (scorer.params ?? {}) as Partial<RegexPresenceParams>;
  const pattern = typeof rawParams.pattern === "string" ? rawParams.pattern : "";
  const mode = (rawParams.mode ?? "any") as RegexPresenceParams["mode"];
  const invertEnabled = mode === "any";
  const minCount = typeof rawParams.minCount === "number" ? rawParams.minCount : undefined;
  const maxCount = typeof rawParams.maxCount === "number" ? rawParams.maxCount : undefined;
  const targetCount = typeof rawParams.targetCount === "number" ? rawParams.targetCount : undefined;

  useEffect(() => {
    if (!invertEnabled && rawParams.invert) {
      onParamsChange(scorer.id, { invert: false });
    }
  }, [invertEnabled, rawParams.invert, scorer.id, onParamsChange]);

  const [sampleText, setSampleText] = useState("");

  const sanitizedParams = useMemo(() => {
    const base: Partial<RegexPresenceParams> = {
      pattern,
      mode,
      minCount,
      maxCount,
      targetCount,
      invert: invertEnabled ? Boolean(rawParams.invert) : false,
    };
    const parsed = regexPresenceSchema.safeParse(base);
    return parsed.success ? parsed.data : (base as RegexPresenceParams);
  }, [pattern, mode, minCount, maxCount, targetCount, rawParams.invert, invertEnabled]);

  const preview = useMemo(() => {
    if (!pattern) {
      return { matchCount: 0, regexError: null as string | null, evaluation: null as ScorerEvaluation | null };
    }
    try {
      const regex = new RegExp(pattern, "gi");
      const matches = sampleText ? sampleText.match(regex) ?? [] : [];
      const evaluation = sampleText
        ? evaluateRegexPresence(sampleText, sanitizedParams)
        : (null as ScorerEvaluation | null);
      return { matchCount: matches.length, regexError: null as string | null, evaluation };
    } catch (error) {
      return {
        matchCount: 0,
        regexError: error instanceof Error ? error.message : String(error),
        evaluation: null as ScorerEvaluation | null,
      };
    }
  }, [pattern, sampleText, sanitizedParams]);

  const helperCopy = REGEX_MODE_OPTIONS.find((option) => option.value === mode)?.helper ?? "";

  const handleModeChange = (value: string) => {
    const nextMode = value as RegexPresenceParams["mode"];
    const update: Record<string, unknown> = { mode: nextMode };
    if (nextMode === "at_least" && typeof rawParams.minCount !== "number") {
      update.minCount = 1;
    }
    if (nextMode === "at_most" && typeof rawParams.maxCount !== "number") {
      update.maxCount = 0;
    }
    if (nextMode === "between") {
      const nextMin = typeof rawParams.minCount === "number" ? rawParams.minCount : 1;
      const nextMax = typeof rawParams.maxCount === "number" ? rawParams.maxCount : Math.max(nextMin, 1);
      update.minCount = nextMin;
      update.maxCount = nextMax;
    }
    if (nextMode === "scaled") {
      const nextTarget = typeof rawParams.targetCount === "number" && rawParams.targetCount > 0 ? rawParams.targetCount : 3;
      update.targetCount = nextTarget;
      if (typeof rawParams.maxCount !== "number" || rawParams.maxCount <= 0) {
        update.maxCount = nextTarget;
      }
    } else {
      update.targetCount = undefined;
    }
    if (nextMode !== "any") {
      update.invert = false;
    }
    onParamsChange(scorer.id, update);
  };

  const handleNumberParam = (field: "minCount" | "maxCount" | "targetCount") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      if (raw.trim().length === 0) {
        onParamsChange(scorer.id, { [field]: undefined });
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) return;
      const value = field === "targetCount" ? Math.max(parsed, 1) : Math.max(parsed, 0);
      onParamsChange(scorer.id, { [field]: value });
    };

  const previewEvaluation = preview.evaluation;
  const previewScore =
    previewEvaluation && previewEvaluation.status === "ready"
      ? Number(previewEvaluation.value?.toFixed(2))
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Input
          value={pattern}
          onChange={(event) => onParamsChange(scorer.id, { pattern: event.target.value })}
          placeholder="Regex pattern"
          className="h-9 flex-1 text-sm"
        />
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-[220px]">
            <SelectValue placeholder="Choose rule" />
          </SelectTrigger>
          <SelectContent>
            {REGEX_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[11px] text-neutral-500">{helperCopy}</p>

      {mode === "at_least" ? (
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Minimum matches</label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={minCount ?? ""}
            onChange={handleNumberParam("minCount")}
            className="h-8 w-24 text-sm"
          />
        </div>
      ) : null}

      {mode === "at_most" ? (
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Maximum matches</label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={maxCount ?? ""}
            onChange={handleNumberParam("maxCount")}
            className="h-8 w-24 text-sm"
          />
        </div>
      ) : null}

      {mode === "between" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-neutral-500">Min</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={minCount ?? ""}
              onChange={handleNumberParam("minCount")}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-neutral-500">Max</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={maxCount ?? ""}
              onChange={handleNumberParam("maxCount")}
              className="h-8 text-sm"
            />
          </div>
        </div>
      ) : null}

      {mode === "scaled" ? (
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Target matches</label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={targetCount ?? ""}
            onChange={handleNumberParam("targetCount")}
            className="h-8 w-24 text-sm"
          />
        </div>
      ) : null}

      {invertEnabled ? (
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <Checkbox
            checked={Boolean(rawParams.invert)}
            onCheckedChange={(checked) => onParamsChange(scorer.id, { invert: Boolean(checked) })}
          />
          Penalize matches instead
        </label>
      ) : null}

      {preview.regexError ? (
        <p className="text-[11px] text-red-600">Invalid regex: {preview.regexError}</p>
      ) : null}

      <div className="rounded-md border border-neutral-200 bg-white px-3 py-2">
        <label className="text-[11px] font-medium uppercase text-neutral-500">
          Test text (optional)
        </label>
        <Textarea
          value={sampleText}
          onChange={(event) => setSampleText(event.target.value)}
          placeholder="Paste a candidate output to preview match counts"
          className="mt-1 h-20 resize-none text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
          <span>{pattern ? `Matches: ${preview.matchCount}` : "Enter a regex pattern to test"}</span>
          {sampleText && !preview.regexError && previewScore !== null ? (
            <span>Preview score: {previewScore.toFixed(2)}</span>
          ) : null}
        </div>
        {previewEvaluation && previewEvaluation.notes ? (
          <p
            className={cn(
              "mt-1 text-[11px]",
              previewEvaluation.status === "error" ? "text-amber-600" : "text-neutral-500",
            )}
          >
            {previewEvaluation.notes}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type LengthRatioFieldsProps = {
  params: Record<string, unknown>;
  scorerId: string;
  onParamsChange: (id: string, params: Record<string, unknown>) => void;
};

const LENGTH_PRESETS = [
  { label: "12–28%", min: 0.12, max: 0.28 },
  { label: "15–25%", min: 0.15, max: 0.25 },
  { label: "20–35%", min: 0.2, max: 0.35 },
];

function LengthRatioFields({ params, scorerId, onParamsChange }: LengthRatioFieldsProps) {
  const minRatio = typeof params.minRatio === "number" ? params.minRatio : undefined;
  const maxRatio = typeof params.maxRatio === "number" ? params.maxRatio : undefined;

  const toPercentString = (ratio: number | undefined) =>
    typeof ratio === "number" ? Number((ratio * 100).toFixed(1)).toString() : "";

  const handlePercentChange = (field: "minRatio" | "maxRatio") => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (raw.trim().length === 0) {
      onParamsChange(scorerId, { [field]: undefined });
      return;
    }
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    onParamsChange(scorerId, { [field]: Number((parsed / 100).toFixed(4)) });
  };

  const applyPreset = (min: number, max: number) => {
    onParamsChange(scorerId, { minRatio: min, maxRatio: max });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Minimum %</label>
          <Input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0}
            max={100}
            value={toPercentString(minRatio)}
            onChange={handlePercentChange("minRatio")}
            placeholder="e.g., 12"
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Maximum %</label>
          <Input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={0}
            max={100}
            value={toPercentString(maxRatio)}
            onChange={handlePercentChange("maxRatio")}
            placeholder="e.g., 28"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <p className="text-[11px] text-neutral-500">
        Measures the output length as a percentage of the input length. For example, 20 means the response should be about
        20% as long as the input transcript.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">Quick presets</span>
        {LENGTH_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-dashed px-2 text-[11px]"
            onClick={() => applyPreset(preset.min, preset.max)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500">
        Leave either box empty to enforce only a minimum or only a maximum. Ratios outside the allowed range score 0.
      </p>
    </div>
  );
}

type LLMRubricFieldsProps = {
  scorer: OptimizeScorerConfig;
  onParamsChange: (id: string, params: Record<string, unknown>) => void;
  modelOptions: ModelOption[];
  modelsLoading: boolean;
};

const DEFAULT_RUBRIC_TEMPLATE = `# Rubric\n1. **Accuracy (0.5)** – All statements must be grounded in the transcript. Deduct if new facts appear.\n2. **Redaction (0.3)** – Replace sensitive entities with [REDACTED_*] tokens. Deduct if any identifiers remain.\n3. **Structure (0.2)** – Output must contain Summary, Decisions, and Action Items headings with bullet lists.\n\nReturn a score between 0 and 1 with a brief justification.`;

function LLMRubricFields(props: LLMRubricFieldsProps) {
  const { scorer, onParamsChange, modelOptions, modelsLoading } = props;
  const params = scorer.params ?? {};
  const rubric = typeof params.rubric === "string" ? params.rubric : "";
  const rawModel = typeof params.model === "string" ? params.model : "";
  const trimmedModel = rawModel.trim();
  const hasModelOption =
    trimmedModel.length > 0 && modelOptions.some((option) => option.id === trimmedModel);
  const modelSelectValue = hasModelOption
    ? trimmedModel
    : trimmedModel.length > 0
      ? "custom"
      : undefined;
  const showCustomModelInput = modelSelectValue === "custom";

  const handleTemplate = () => {
    if (!rubric || rubric.trim().length === 0) {
      onParamsChange(scorer.id, { rubric: DEFAULT_RUBRIC_TEMPLATE });
    } else {
      onParamsChange(scorer.id, { rubric: `${rubric.trim()}\n\n${DEFAULT_RUBRIC_TEMPLATE}` });
    }
  };

  const handleModelSelect = (value: string) => {
    if (value === "custom") {
      if (!trimmedModel) {
        onParamsChange(scorer.id, { model: "" });
      }
      return;
    }
    onParamsChange(scorer.id, { model: value });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium uppercase text-neutral-500">Rubric</label>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleTemplate}>
          Insert template
        </Button>
      </div>
      <Textarea
        value={rubric}
        onChange={(event) => onParamsChange(scorer.id, { rubric: event.target.value })}
        className="min-h-[120px] text-sm"
        placeholder="Spell out how the judge assigns a 0–1 score. List criteria, weighting, and failure cases."
      />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-wide text-neutral-500">Judge model</label>
          <Select
            value={modelSelectValue}
            onValueChange={handleModelSelect}
            disabled={modelsLoading}
          >
            <SelectTrigger className="mt-1 h-8 text-sm">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent className="max-h-72 w-[280px]">
              {modelOptions.map((option) => (
                <SelectItem key={option.id} value={option.id} textValue={option.label}>
                  <div className="flex min-w-0 flex-col text-left">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-[11px] text-neutral-500">{option.id}</span>
                  </div>
                </SelectItem>
              ))}
              <SelectItem value="custom" textValue="Custom value">
                Custom value…
              </SelectItem>
            </SelectContent>
          </Select>
          {showCustomModelInput ? (
            <Input
              value={rawModel}
              onChange={(event) => onParamsChange(scorer.id, { model: event.target.value })}
              placeholder="e.g., openai/gpt-4o-mini"
              className="mt-2 h-8 text-sm"
            />
          ) : null}
        </div>
        <p className="text-[11px] text-neutral-500 sm:max-w-[220px]">
          Runs once per dataset row. Start with lightweight models while iterating; switch to a higher-quality model before
          shipping.
        </p>
      </div>
      <div className="rounded-md border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800">
        <p className="font-medium uppercase tracking-wide">What the judge sees</p>
        <p>
          Each call includes the dataset input, the optional expected output, and the candidate output for that row—nothing
          else. The rubric must map those signals to a single score between 0 and 1.
        </p>
      </div>
      <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-500">
        <p>Tips:</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Spell out what earns 0 vs. 1 and use decimals for partial credit (e.g., 0.25, 0.5).</li>
          <li>Ask the judge to explain low scores so you can debug the candidate output.</li>
          <li>Include formatting expectations (headings, bullet lists) when the structure matters.</li>
        </ul>
      </div>
    </div>
  );
}

const getScorerSummary = (scorer: OptimizeScorerConfig): string => {
  const params = scorer.params ?? {};
  switch (scorer.type) {
    case "regex_presence": {
      const pattern = typeof params.pattern === "string" ? params.pattern.trim() : "";
      if (!pattern) return "Add a regex";
      const mode = (params.mode ?? "any") as RegexPresenceParams["mode"];
      const truncated = pattern.length > 24 ? `${pattern.slice(0, 21)}…` : pattern;
      const invert = params.invert && mode === "any" ? " • penalize" : "";
      switch (mode) {
        case "any":
          return `${truncated} • ≥1${invert}`;
        case "at_least": {
          const min = typeof params.minCount === "number" ? params.minCount : 1;
          return `${truncated} • ≥${min}`;
        }
        case "at_most": {
          const max = typeof params.maxCount === "number" ? params.maxCount : 0;
          return `${truncated} • ≤${max}`;
        }
        case "between": {
          const min = typeof params.minCount === "number" ? params.minCount : 1;
          const max = typeof params.maxCount === "number" ? params.maxCount : min;
          return `${truncated} • ${min}-${max}`;
        }
        case "scaled": {
          const target = typeof params.targetCount === "number"
            ? params.targetCount
            : typeof params.maxCount === "number" && params.maxCount > 0
              ? params.maxCount
              : 1;
          return `${truncated} • scaled→${target}`;
        }
        default:
          return truncated;
      }
    }
    case "length_ratio": {
      const min = typeof params.minRatio === "number" ? params.minRatio : undefined;
      const max = typeof params.maxRatio === "number" ? params.maxRatio : undefined;
      if (min !== undefined && max !== undefined) {
        return `Target ${formatPercent(min)}–${formatPercent(max)}`;
      }
      if (min !== undefined) return `≥ ${formatPercent(min)}`;
      if (max !== undefined) return `≤ ${formatPercent(max)}`;
      return "Set min/max ratios";
    }
    case "llm_rubric": {
      const rubric = typeof params.rubric === "string" ? params.rubric.trim() : "";
      if (!rubric) return "Add rubric";
      const preview = rubric.split(/\n+/)[0] ?? rubric;
      return preview.length > 40 ? `${preview.slice(0, 37)}…` : preview;
    }
    case "exact_match":
      return "Matches gold output";
    case "latency_builtin":
      return "Uses adapter latency";
    default:
      return "Configure scorer";
  }
};

const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;
