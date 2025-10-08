"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Copy, Info } from "lucide-react";

import type {
  PromptDiffLine,
  ProviderRoutingAttempt,
  TelemetryRecord,
  TelemetrySpan,
  TelemetrySpanStatus,
} from "../../types";

export type TelemetryEntryProps = {
  record: TelemetryRecord;
  highlight?: boolean;
};

export function TelemetryEntry({ record, highlight = false }: TelemetryEntryProps) {
  const [copied, setCopied] = useState(false);

  const { root, children } = record;
  const statusTone = TELEMETRY_STYLES[record.status] ?? TELEMETRY_STYLES.partial;
  const friendlyName = formatTelemetryName(root.name);
  const modelId = record.modelId ?? root.derived.modelId;
  const provider = record.provider ?? root.derived.provider;
  const aggregator = record.aggregator ?? root.derived.aggregator;
  const promptMessages = record.promptMessages ?? record.root.derived.promptMessages ?? [];
  const systemMessage = promptMessages.find((message) => message.role === "system" && message.content);
  const prompt = record.prompt ?? (promptMessages.length ? promptMessages.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`).join("\n\n") : undefined);
  const response = record.response;
  const promptTokens = record.promptTokens ?? root.derived.promptTokens;
  const completionTokens = record.completionTokens ?? root.derived.completionTokens;
  const totalTokens = record.totalTokens ?? root.derived.totalTokens;
  const temperature = record.temperature ?? root.derived.temperature;
  const routingAttempts = record.routingAttempts ?? root.derived.routingAttempts;
  const routingReasoning = record.routingReasoning ?? root.derived.routingReasoning;
  const routingPlan = record.routingPlan ?? root.derived.routingPlan;
  const iteration = record.iteration ?? root.derived.iteration;
  const role = record.role ?? root.derived.role;
  const operationId = record.operationId ?? root.derived.operationId;
  const responseId = record.responseId ?? root.derived.responseId;
  const datasetRowId = record.datasetRowId ?? root.derived.datasetRowId;
  const datasetRowInput = record.datasetRowInput ?? root.derived.datasetRowInput;
  const datasetRowExpected = record.datasetRowExpected ?? root.derived.datasetRowExpected;
  const datasetBadgeLabel = datasetRowId
    ? truncateLabel(datasetRowId, 24)
    : datasetRowInput
      ? truncateLabel(datasetRowInput, 24)
      : undefined;
  const hasPromptDiff = Boolean(record.promptDiff && record.promptDiff.length > 0);

  const startedAt = record.startedAt ? formatTelemetryTime(record.startedAt) : null;
  const endedAt = record.endedAt ? formatTelemetryTime(record.endedAt) : null;

  const childSummaries = useMemo(
    () =>
      children.map((child) => ({
        id: child.spanId,
        name: child.name,
        status: child.status,
        provider: child.derived.provider ?? child.derived.finalProvider,
        model: child.derived.modelId,
        latencyMs: child.derived.latencyMs ?? child.durationMs,
        costUSD: child.derived.costUSD,
      })),
    [children],
  );
  const showSubSpans = childSummaries.length > 1;

  const jsonPayload = useMemo(() => {
    const spans: TelemetrySpan[] = [root, ...children];
    return JSON.stringify({ traceId: record.traceId, status: record.status, spans }, null, 2);
  }, [children, record.status, record.traceId, root]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonPayload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [jsonPayload]);

  const debugTooltip = DEBUG_TELEMETRY
    ? JSON.stringify(
        {
          traceId: record.traceId,
          responseId,
          providerResponseId: record.providerResponseId,
          operationId,
          iteration,
          role,
          datasetRowId,
          keys: collectResponseKeys(record),
        },
        null,
        2,
      )
    : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "rounded-md border border-neutral-200 bg-white p-2 text-[11px] text-neutral-700 transition",
          highlight && "border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
        )}
      >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("uppercase", statusTone.badge)}>{friendlyName}</Badge>
            {modelId ? <span className="font-mono text-[10px] text-neutral-500">{modelId}</span> : null}
            {!modelId && root.name ? <span className="font-mono text-[10px] text-neutral-500">{root.name}</span> : null}
            {provider ? <span className="text-[10px] text-neutral-500">{provider}</span> : null}
            {temperature !== undefined ? (
              <span className="text-[10px] text-neutral-500">Temp {temperature.toFixed(2)}</span>
            ) : null}
          </div>
          {startedAt && endedAt ? (
            <div className="font-mono text-[10px] text-neutral-500">
              {startedAt} → {endedAt}
            </div>
          ) : null}
          {role ? (
            <div className="text-[10px] text-neutral-500">{formatRole(role)}</div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
            <span>Trace {shortenId(record.traceId)}</span>
            {iteration !== undefined ? <span>Iter {iteration}</span> : null}
            {datasetBadgeLabel ? <span>Row {datasetBadgeLabel}</span> : null}
            {operationId ? <span>Op {shortenId(operationId)}</span> : null}
            {responseId ? <span>Resp {shortenId(responseId)}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn("uppercase", statusTone.statusBadge)}>{formatStatusLabel(record.status)}</Badge>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          {debugTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs whitespace-pre-wrap text-[11px]">
                <pre className="max-h-64 overflow-auto text-[10px] text-neutral-700">{debugTooltip}</pre>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
        {promptTokens !== undefined ? (
          <Badge variant="outline" className="border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600">
            Prompt tokens {promptTokens}
          </Badge>
        ) : null}
        {completionTokens !== undefined ? (
          <Badge variant="outline" className="border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600">
            Output tokens {completionTokens}
          </Badge>
        ) : null}
        {totalTokens !== undefined ? (
          <Badge variant="outline" className="border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600">
            Total tokens {totalTokens}
          </Badge>
        ) : null}
      </div>

      {systemMessage?.content ? (
        <TelemetryTextSection
          label="System Prompt"
          text={systemMessage.content}
          previewLength={hasPromptDiff ? 540 : 120}
          initiallyExpanded={hasPromptDiff}
          collapsedPlaceholder={hasPromptDiff ? undefined : "Unchanged this iteration. Expand to inspect the full text."}
        />
      ) : prompt ? (
        <TelemetryTextSection
          label="Prompt"
          text={prompt}
          previewLength={120}
          initiallyExpanded={false}
          collapsedPlaceholder="Prompt unchanged. Expand to view."
        />
      ) : null}
      {record.promptDiff && record.promptDiff.length > 0 ? (
        <PromptDiffSection diff={record.promptDiff} />
      ) : null}
      {(datasetRowInput || datasetRowExpected || datasetRowId) ? (
        <DatasetRowSection rowId={datasetRowId} input={datasetRowInput} expected={datasetRowExpected} />
      ) : null}
      {response ? <TelemetryTextSection label="Response" text={response} /> : null}

      {showRoutingSection({ aggregator, attempts: routingAttempts, reasoning: routingReasoning, plan: routingPlan }) ? (
        <RoutingDetails
          aggregator={aggregator}
          provider={provider}
          attempts={routingAttempts}
          reasoning={routingReasoning}
          plan={routingPlan}
        />
      ) : null}

      {showSubSpans ? (
        <div className="mt-3 space-y-2">
          <span className="text-[10px] font-semibold uppercase text-neutral-500">Sub-spans</span>
          <ul className="space-y-1.5">
            {childSummaries.map((child) => (
              <li key={child.id} className="rounded border border-neutral-200 bg-white/80 px-2 py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-neutral-600">{child.name}</span>
                    {child.model ? (
                      <span className="font-mono text-[10px] text-neutral-400">{child.model}</span>
                    ) : null}
                    {child.provider ? (
                      <span className="text-[10px] text-neutral-500">{child.provider}</span>
                    ) : null}
                    {child.latencyMs !== undefined ? (
                      <span className="text-[10px] text-neutral-400">{formatDuration(child.latencyMs)}</span>
                    ) : null}
                    {child.costUSD !== undefined ? (
                      <span className="text-[10px] text-neutral-400">{formatCurrency(child.costUSD)}</span>
                    ) : null}
                  </div>
                  <Badge className={cn("uppercase", TELEMETRY_STYLES[child.status].statusBadge)}>
                    {formatStatusLabel(child.status)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {root.errorMessage ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {root.errorMessage}
        </div>
      ) : null}
      </div>
    </TooltipProvider>
  );
}

type RoutingDetailsProps = {
  aggregator?: string;
  provider?: string;
  attempts?: TelemetryRecord["routingAttempts"];
  reasoning?: string;
  plan?: string;
};

function RoutingDetails({ aggregator, provider, attempts, reasoning, plan }: RoutingDetailsProps) {
  const displayAttempts = attempts && attempts.length > 0 ? attempts : undefined;
  const copySegments = [reasoning, plan]
    .filter((segment): segment is string => Boolean(segment && segment.length > 0))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !isAttemptSummaryDuplicate(segment, displayAttempts));
  if (!aggregator && !displayAttempts && copySegments.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <div className="text-[10px] font-semibold uppercase text-neutral-500">Routing</div>
      {aggregator && provider && aggregator !== provider ? (
        <div className="text-[11px] text-neutral-700">
          <span className="font-medium text-neutral-800">{aggregator}</span> routed to {provider}
        </div>
      ) : null}
      {displayAttempts ? (
        <ul className="space-y-2">
          {displayAttempts.map((attempt, index) => (
            <li key={`${attempt.provider}-${index}`} className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[10px] text-neutral-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[9px] uppercase text-neutral-600">
                    Attempt {index + 1}
                  </Badge>
                  <span className="font-medium text-neutral-800">{attempt.provider}</span>
                  {attempt.modelId ? (
                    <span className="font-mono text-[10px] text-neutral-500">{attempt.modelId}</span>
                  ) : null}
                  {attempt.credentialType ? (
                    <span className="text-[10px] text-neutral-400">{attempt.credentialType}</span>
                  ) : null}
                </div>
                <Badge className={cn("uppercase", attempt.success ? "bg-emerald-500 text-white" : "bg-red-500 text-white")}>{attempt.success ? "Success" : "Failed"}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
                {attempt.durationMs !== undefined ? <span>Duration {formatDuration(attempt.durationMs)}</span> : null}
                {attempt.costUSD !== undefined ? <span>Cost {formatCurrency(attempt.costUSD)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {copySegments.length ? (
        <div className="text-[10px] leading-relaxed text-neutral-600">
          <span className="font-semibold uppercase text-neutral-500">Summary</span>
          <p className="mt-1 whitespace-pre-line">{copySegments.join("\n\n")}</p>
        </div>
      ) : null}
    </div>
  );
}

type TelemetryTextSectionProps = {
  label: string;
  text: string;
  previewLength?: number;
  initiallyExpanded?: boolean;
  collapsedPlaceholder?: string;
};

type PromptDiffSectionProps = {
  diff: PromptDiffLine[];
};

type DatasetRowSectionProps = {
  rowId?: string;
  input?: string;
  expected?: string;
};

const DEBUG_TELEMETRY = process.env.NEXT_PUBLIC_DEBUG_TELEMETRY === "true";

function TelemetryTextSection({
  label,
  text,
  previewLength = 540,
  initiallyExpanded,
  collapsedPlaceholder,
}: TelemetryTextSectionProps) {
  const shouldTruncate = text.length > previewLength;
  const computedInitial = initiallyExpanded ?? (collapsedPlaceholder ? false : !shouldTruncate);
  const [expanded, setExpanded] = useState(computedInitial);

  useEffect(() => {
    setExpanded(initiallyExpanded ?? (collapsedPlaceholder ? false : !shouldTruncate));
  }, [initiallyExpanded, shouldTruncate, collapsedPlaceholder, text]);

  let displayText: string;
  if (!expanded && collapsedPlaceholder) {
    displayText = collapsedPlaceholder;
  } else if (!expanded && shouldTruncate) {
    displayText = `${text.slice(0, previewLength)}…`;
  } else {
    displayText = text;
  }

  const canToggle = shouldTruncate || Boolean(collapsedPlaceholder);

  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-neutral-500">{label}</span>
        {canToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700">{displayText}</pre>
    </div>
  );
}

const TELEMETRY_STYLES: Record<
  TelemetrySpanStatus,
  {
    container: string;
    badge: string;
    statusBadge: string;
  }
> = {
  success: {
    container: "border-emerald-200 bg-emerald-50/40",
    badge: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    statusBadge: "bg-emerald-600 text-white",
  },
  error: {
    container: "border-red-200 bg-red-50/50",
    badge: "bg-red-100 text-red-700 border border-red-200",
    statusBadge: "bg-red-600 text-white",
  },
  partial: {
    container: "border-amber-200 bg-amber-50/50",
    badge: "bg-amber-100 text-amber-700 border border-amber-200",
    statusBadge: "bg-amber-600 text-white",
  },
};

function formatStatusLabel(status: TelemetrySpanStatus): string {
  switch (status) {
    case "success":
      return "Success";
    case "error":
      return "Error";
    default:
      return "Partial";
  }
}

function formatTelemetryName(name: string): string {
  if (!name) return "Model call";
  if (name.includes("ai.generateObject")) return "Structured call";
  if (name.includes("ai.generateText")) return "Model call";
  if (name.includes("evaluate")) return "Scorer";
  return name;
}

function formatTelemetryTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return `${timestamp}`;
  }
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) {
    const seconds = value / 1000;
    if (seconds >= 10) {
      return `${seconds.toFixed(0)} s`;
    }
    return `${seconds.toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
}

function shortenId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function showRoutingSection({ aggregator, attempts, reasoning, plan }: { aggregator?: string; attempts?: TelemetryRecord["routingAttempts"]; reasoning?: string; plan?: string }): boolean {
  return Boolean((aggregator && aggregator.length > 0) || (attempts && attempts.length > 0) || (reasoning && reasoning.length > 0) || (plan && plan.length > 0));
}

function formatRole(role: string): string {
  switch (role) {
    case "parent_minibatch":
      return "Parent (minibatch)";
    case "candidate_minibatch":
      return "Candidate (minibatch)";
    case "candidate_full":
      return "Candidate (full evaluation)";
    default:
      return role;
  }
}

function PromptDiffSection({ diff }: PromptDiffSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? diff : diff.slice(0, 40);
  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-neutral-500">System Prompt Changes</span>
        {diff.length > 40 ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700">
        {visible.map((line, index) => (
          <PromptDiffLineView key={index} line={line} />
        ))}
      </pre>
    </div>
  );
}

function PromptDiffLineView({ line }: { line: PromptDiffLine }) {
  if (line.type === "add") {
    return <span className="block text-emerald-600">+ {line.text}</span>;
  }
  if (line.type === "remove") {
    return <span className="block text-red-500">- {line.text}</span>;
  }
  return <span className="block text-neutral-600">  {line.text}</span>;
}

function DatasetRowSection({ rowId, input, expected }: DatasetRowSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(input || expected);
  const inputPreview = input ? truncateTextPreview(input) : null;
  const expectedPreview = expected ? truncateTextPreview(expected) : null;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase text-neutral-500">Dataset Row</span>
          {rowId ? <span className="font-mono text-[10px] text-neutral-500">{truncateLabel(rowId, 24)}</span> : null}
        </div>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[10px] font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            {expanded ? "Hide details" : "View details"}
          </button>
        ) : null}
      </div>

      {!expanded && hasDetails ? (
        <div className="space-y-1 text-[11px] text-neutral-700">
          {inputPreview ? (
            <p className="whitespace-pre-wrap">
              <span className="font-semibold uppercase text-neutral-500">Input:</span> {inputPreview}
            </p>
          ) : null}
          {expectedPreview ? (
            <p className="whitespace-pre-wrap">
              <span className="font-semibold uppercase text-neutral-500">Expected:</span> {expectedPreview}
            </p>
          ) : null}
        </div>
      ) : null}

      {expanded && hasDetails ? (
        <div className="space-y-2">
          {input ? (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase text-neutral-500">Input</span>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700">{input}</pre>
            </div>
          ) : null}
          {expected ? (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase text-neutral-500">Expected Output</span>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-neutral-700">{expected}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasDetails ? <p className="text-[11px] text-neutral-500">No dataset text recorded for this call.</p> : null}
    </div>
  );
}

function truncateLabel(value: string, max = 40): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function collectResponseKeys(record: TelemetryRecord): string[] {
  const keys = new Set<string>();
  const add = (value?: string) => {
    if (value && value.length > 0) keys.add(value);
  };
  add(record.responseId);
  add(record.providerResponseId);
  add(record.operationId);
  add(record.root.derived.responseId);
  add(record.root.derived.operationId);
  add(record.root.derived.providerResponseId);
  return Array.from(keys);
}

function truncateTextPreview(value: string, max = 140): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function isAttemptSummaryDuplicate(segment: string, attempts?: ProviderRoutingAttempt[]): boolean {
  if (!attempts || attempts.length === 0) return false;
  const normalized = segment.toLowerCase();
  const mentionsFallback = normalized.includes("fallback") || normalized.includes("selected") || normalized.includes("execution order");
  if (!mentionsFallback) return false;
  const attemptProviders = attempts.map((attempt) => attempt.provider.toLowerCase());
  return attemptProviders.every((provider) => normalized.includes(provider));
}
