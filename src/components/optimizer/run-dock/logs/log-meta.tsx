"use client";

import { Fragment } from "react";

import type { PromptDiffLine, PromptMessage, TelemetryRecord } from "../../types";
import { TelemetryEntry } from "./telemetry-view";
import { computePromptDiff } from "./telemetry-utils";

type RowSummaryMeta = {
  rowId: string;
  rowInputPreview?: string;
  rowExpectedPreview?: string;
  hasExpectedOutput?: boolean;
};

type ComponentUpdateMeta = {
  component: string;
  oldTextLength?: number;
  newTextLength?: number;
  textChanged?: boolean;
  oldTextPreview?: string;
  newTextPreview?: string;
  oldTextFull?: string;
  newTextFull?: string;
};

type LogMetaProps = {
  meta: unknown;
  highlightIteration?: number | null;
};

export function LogMeta({ meta, highlightIteration }: LogMetaProps) {
  if (meta === null || meta === undefined) return null;

  if (isTelemetryMeta(meta)) {
    const entryIteration = meta.telemetry?.iteration;
    const highlight = typeof highlightIteration === "number" && highlightIteration === entryIteration;
    return <TelemetryEntry record={meta.telemetry} highlight={highlight} />;
  }

  if (typeof meta !== "object") {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700">
        {String(meta)}
      </div>
    );
  }

  if (isComponentUpdateMeta(meta)) {
    return <ComponentUpdate meta={meta} />;
  }

  if (isRowSummaryMeta(meta)) {
    return <RowMetaSummary summary={meta} />;
  }

  if (Array.isArray(meta)) {
    if (meta.length === 0) return null;
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700">
        <div className="flex flex-wrap gap-1">
          {meta.map((item, idx) => (
            <span key={idx} className="rounded-md border border-neutral-200 bg-white px-2 py-1 font-mono text-[10px] text-neutral-700">
              {formatMetaPrimitive(item)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(120px,1fr)_minmax(160px,2fr)]">
        {entries.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{key}</dt>
            <dd className="font-mono text-[11px] text-neutral-800">
              {renderMetaValue(value)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function renderMetaValue(value: unknown): string | React.ReactNode {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== "object")) {
      return value.map((item) => formatMetaPrimitive(item)).join(", ");
    }
    return <pre className="overflow-x-auto text-[10px] text-neutral-600">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === "object") {
    return <pre className="overflow-x-auto text-[10px] text-neutral-600">{JSON.stringify(value, null, 2)}</pre>;
  }
  return formatMetaPrimitive(value);
}

function formatMetaPrimitive(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function isTelemetryMeta(meta: unknown): meta is { telemetry: TelemetryRecord } {
  if (!meta || typeof meta !== "object") return false;
  return "telemetry" in meta && Boolean((meta as { telemetry?: unknown }).telemetry);
}

function isRowSummaryMeta(meta: unknown): meta is RowSummaryMeta {
  if (!meta || typeof meta !== "object") return false;
  const candidate = meta as Partial<RowSummaryMeta> & Record<string, unknown>;
  if (typeof candidate.rowId !== "string") return false;
  const hasPreview = typeof candidate.rowInputPreview === "string" || typeof candidate.rowExpectedPreview === "string";
  const legacyKeys = "rowInput" in candidate || "rowExpected" in candidate;
  return hasPreview || legacyKeys;
}

function isComponentUpdateMeta(meta: unknown): meta is ComponentUpdateMeta {
  if (!meta || typeof meta !== "object") return false;
  const candidate = meta as Record<string, unknown>;
  return typeof candidate.component === "string" && ("newTextPreview" in candidate || "newTextLength" in candidate);
}

function ComponentUpdate({ meta }: { meta: ComponentUpdateMeta }) {
  const oldText =
    typeof meta.oldTextFull === "string"
      ? meta.oldTextFull
      : typeof meta.oldTextPreview === "string"
        ? meta.oldTextPreview
        : "";
  const newText =
    typeof meta.newTextFull === "string"
      ? meta.newTextFull
      : typeof meta.newTextPreview === "string"
        ? meta.newTextPreview
        : "";
  const diff = computePreviewDiff(oldText, newText);
  const changed = meta.textChanged !== false && diff.length > 0;

  return (
    <div className="rounded-md border border-neutral-200 bg-emerald-50/50 px-3 py-2 text-[11px] text-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        <span>Component</span>
        <span className="text-neutral-700">{meta.component}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-neutral-500">
        {typeof meta.oldTextLength === "number" ? <span>Old length {meta.oldTextLength}</span> : null}
        {typeof meta.newTextLength === "number" ? <span>New length {meta.newTextLength}</span> : null}
        <span className={changed ? "text-emerald-600" : "text-neutral-500"}>{changed ? "Changed" : "No change detected"}</span>
      </div>
      {diff.length > 0 ? (
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-800">
          {diff.map((line, index) => (
            <DiffLine key={index} line={line} />
          ))}
        </pre>
      ) : (
        <p className="mt-2 text-[10px] text-neutral-500">
          Preview unchanged or truncated. View the best candidate prompt for full text.
        </p>
      )}
    </div>
  );
}

function DiffLine({ line }: { line: PromptDiffLine }) {
  if (line.type === "add") {
    return <span className="block text-emerald-600">+ {line.text}</span>;
  }
  if (line.type === "remove") {
    return <span className="block text-red-500">- {line.text}</span>;
  }
  return <span className="block text-neutral-600">  {line.text}</span>;
}

function computePreviewDiff(previous: string, current: string): PromptDiffLine[] {
  const previousMessages: PromptMessage[] = [
    { role: "system", content: previous },
  ];
  const currentMessages: PromptMessage[] = [
    { role: "system", content: current },
  ];
  return computePromptDiff(previousMessages, currentMessages);
}

function RowMetaSummary({ summary }: { summary: RowSummaryMeta }) {
  const extra = summary as RowSummaryMeta & { rowInput?: string; rowExpected?: string };
  const input = summary.rowInputPreview ?? extra.rowInput;
  const expected = summary.rowExpectedPreview ?? extra.rowExpected;
  const segments: string[] = [];
  if (input) segments.push(`Input "${input}"`);
  if (expected) segments.push(`Expected "${expected}"`);

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-500">
        <span className="font-semibold text-neutral-600">Row</span>
        <span className="font-mono text-neutral-700">{summary.rowId}</span>
      </div>
      <p className="mt-1 text-[11px] text-neutral-700">
        {segments.length ? segments.join(" · ") : summary.hasExpectedOutput ? "Expected output provided." : ""}
      </p>
    </div>
  );
}
