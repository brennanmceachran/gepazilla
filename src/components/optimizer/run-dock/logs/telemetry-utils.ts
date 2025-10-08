import type {
  DatasetLookup,
  DatasetRow,
  PromptDiffLine,
  PromptMessage,
  ProviderRoutingAttempt,
  TelemetryRecord,
  TelemetrySpan,
  TelemetrySpanStatus,
} from "../../types";

type SpanCollection = TelemetrySpan[];

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;


const DEBUG_TELEMETRY = process.env.NEXT_PUBLIC_DEBUG_TELEMETRY === "true";

const TELEMETRY_CONFLICT_LOG = DEBUG_TELEMETRY;

export function buildTelemetryRecords(events: TelemetrySpan[], lookup?: DatasetLookup): TelemetryRecord[] {
  if (events.length === 0) return [];

  const grouped = groupByResponse(events);
  const records: TelemetryRecord[] = [];

  for (const spans of grouped.values()) {
    if (spans.length === 0) continue;
    const record = buildTelemetryRecordFromSpans(spans);
    records.push(record);
  }

  const merged = mergeRecords(records);

  const chronological = [...merged].sort((a, b) => {
    const aTs = a.startedAt ?? a.endedAt ?? 0;
    const bTs = b.startedAt ?? b.endedAt ?? 0;
    return aTs - bTs;
  });

  const lastPromptByRole = new Map<string, PromptMessage[] | undefined>();
  for (const record of chronological) {
    if (lookup) {
      hydrateDatasetFromLookup(record, lookup);
    }
    const key = record.role ?? "default";
    const previous = lastPromptByRole.get(key);
    const current = record.promptMessages ?? record.root.derived.promptMessages;
    if (!record.promptMessages && current) {
      record.promptMessages = current;
    }
    if (previous && record.promptMessages) {
      record.promptDiff = computePromptDiff(previous, record.promptMessages);
    }
    if (record.promptMessages) {
      lastPromptByRole.set(key, record.promptMessages);
    }
    record.datasetRowLabel = pickRowLabel(
      record.datasetRowLabel,
      undefined,
      record.datasetRowId,
      record.datasetRowInput,
    );
  }

  if (DEBUG_TELEMETRY) {
    console.debug("[telemetry-merge] totals", {
      incoming: events.length,
      merged: merged.length,
      traces: merged.map((record) => ({
        traceId: record.traceId,
        role: record.role,
        iteration: record.iteration,
        rowId: record.datasetRowId,
        keys: collectResponseKeys(record),
      })),
    });
  }

  return merged.sort((a, b) => {
    const aTs = a.endedAt ?? a.startedAt ?? 0;
    const bTs = b.endedAt ?? b.startedAt ?? 0;
    return bTs - aTs;
  });
}

export function buildTelemetryRecordFromSpans(
  spans: TelemetrySpan[],
  previous?: TelemetryRecord,
): TelemetryRecord {
  const sorted = [...spans]
    .sort((a, b) => {
      const aStart = a.startTime ?? a.endTime ?? 0;
      const bStart = b.startTime ?? b.endTime ?? 0;
      return aStart - bStart;
    });

    const root = selectRootSpan(sorted);
    const children = sorted.filter((span) => span !== root);

    const startedAt = pickTimestamp(sorted, "startTime");
    const endedAt = pickTimestamp(sorted, "endTime");
    const durationMs = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : root.durationMs;
    const status = collapseStatuses(sorted, root.status);

    const modelId = pickDerived(sorted, "modelId", (value) => (typeof value === "string" ? value : undefined));
    const provider = pickDerived(sorted, "provider", (value) => (typeof value === "string" ? value : undefined));
    const aggregator = pickDerived(sorted, "aggregator", (value) => (typeof value === "string" ? value : undefined));
    const temperature = pickDerived(sorted, "temperature", (value) => (typeof value === "number" ? value : undefined));
    const prompt = pickDerived(sorted, "promptSummary", (value) => (hasText(value) ? value : undefined));
    const response = pickDerivedLast(sorted, "responseText", (value) => (hasText(value) ? value : undefined));
    const promptTokens = pickDerived(sorted, "promptTokens", (value) => (typeof value === "number" ? value : undefined));
    const completionTokens = pickDerived(sorted, "completionTokens", (value) => (typeof value === "number" ? value : undefined));
    const totalTokens = pickDerived(sorted, "totalTokens", (value) => (typeof value === "number" ? value : undefined))
      ?? computeTotalTokens(promptTokens, completionTokens);
    const costUSD = pickDerived(sorted, "costUSD", (value) => (typeof value === "number" ? value : undefined));
    const fallbackProviders = pickDerived(sorted, "fallbackProviders", (value) =>
      Array.isArray(value) && value.length > 0 ? value.map(String) : undefined,
    );
    const latencyMs = pickDerived(sorted, "latencyMs", (value) => (typeof value === "number" ? value : undefined));
    const routingAttempts = pickDerived(sorted, "routingAttempts", (value) =>
      Array.isArray(value) && value.length > 0 ? value : undefined,
    );
    const routingReasoning = pickDerived(sorted, "routingReasoning", (value) => (hasText(value) ? value : undefined));
    const routingPlan = pickDerived(sorted, "routingPlan", (value) => (hasText(value) ? value : undefined));
    const responseId = pickDerivedLast(sorted, "responseId", (value) => (hasText(value) ? value : undefined));
    const operationId = pickDerivedLast(sorted, "operationId", (value) => (hasText(value) ? value : undefined));
    const iteration = pickDerivedLast(sorted, "iteration", (value) => (typeof value === "number" ? value : undefined));
    const role = pickDerivedLast(sorted, "role", (value) => (hasText(value) ? value : undefined));
    const providerResponseId = pickDerivedLast(sorted, "providerResponseId", (value) => (hasText(value) ? value : undefined));
    const datasetRowId = pickDerived(sorted, "datasetRowId", (value) => (hasText(value) ? value : undefined));
    const datasetRowInput = pickDerived(sorted, "datasetRowInput", (value) => (hasText(value) ? value : undefined));
    const datasetRowExpected = pickDerived(sorted, "datasetRowExpected", (value) => (hasText(value) ? value : undefined));
    const datasetRowLabel = datasetRowId
      ?? (datasetRowInput ? datasetRowInput.slice(0, 64) : undefined);

    const record: TelemetryRecord = {
      traceId: root.traceId,
      root,
      children,
      status,
      startedAt,
      endedAt,
      durationMs,
      modelId,
      provider,
      aggregator,
      temperature,
      prompt,
      response,
      promptTokens,
      completionTokens,
      totalTokens,
      costUSD,
      fallbackProviders,
      latencyMs,
      routingAttempts,
      routingReasoning,
      routingPlan,
      responseId,
      operationId,
      iteration,
      role,
      promptMessages: root.derived.promptMessages,
      datasetRowId,
      datasetRowInput,
      datasetRowExpected,
      datasetRowLabel,
      providerResponseId,
    } satisfies TelemetryRecord;

    if (previous) {
      const clone = { ...previous, children: [...previous.children] } satisfies TelemetryRecord;
      mergeTelemetryRecord(clone, record);
      return clone;
    }

    return record;
}

export function deriveTelemetryKey(span: TelemetrySpan): string | undefined {
  const derived = span.derived ?? ({} as TelemetrySpan["derived"]);
  const providerResponseId = derived.providerResponseId;
  if (hasText(providerResponseId)) return `provider:${providerResponseId}`;
  const responseId = derived.responseId;
  if (hasText(responseId)) return `response:${responseId}`;
  const rowId = derived.datasetRowId;
  if (hasText(rowId)) {
    return `row:${rowId}`;
  }
  if (span.traceId && span.spanId) {
    return `trace:${span.traceId}:span:${span.spanId}`;
  }
  if (span.traceId) return `trace:${span.traceId}`;
  return undefined;
}

export function summarizeTelemetryRecord(record: TelemetryRecord): string {
  void record;
  return "";
}

function groupByResponse(spans: TelemetrySpan[]): Map<string, SpanCollection> {
  const map = new Map<string, SpanCollection>();

  for (const span of spans) {
    const key = deriveTelemetryKey(span) ?? `trace:${span.traceId}:span:${span.spanId}`;
    const list = map.get(key);
    if (list) {
      list.push(span);
    } else {
      map.set(key, [span]);
    }
  }

  return map;
}

function selectRootSpan(spans: TelemetrySpan[]): TelemetrySpan {
  if (spans.length === 1) return spans[0];
  const spanIdSet = new Set(spans.map((span) => span.spanId));

  const promptSpan = spans.find((span) =>
    hasText(span.derived.promptSummary)
      || hasText(span.derived.responseText)
      || hasText(readAttribute(span.attributes, "ai.prompt"))
      || hasText(readAttribute(span.attributes, "prompt"))
  );
  if (promptSpan) return promptSpan;

  const noParent = spans.find((span) => !span.parentSpanId || !spanIdSet.has(span.parentSpanId));
  if (noParent) return noParent;

  const withoutDoSuffix = spans.find((span) => !span.name?.includes(".do"));
  if (withoutDoSuffix) return withoutDoSuffix;

  return spans.reduce((longest, current) => {
    const currentDuration = current.durationMs ?? 0;
    const longestDuration = longest.durationMs ?? 0;
    return currentDuration > longestDuration ? current : longest;
  }, spans[0]);
}

function pickTimestamp(spans: TelemetrySpan[], field: "startTime" | "endTime"): number | undefined {
  let result: number | undefined;
  for (const span of spans) {
    const value = span[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (result === undefined) {
        result = value;
      } else if (field === "startTime") {
        result = Math.min(result, value);
      } else {
        result = Math.max(result, value);
      }
    }
  }
  return result;
}

function collapseStatuses(spans: TelemetrySpan[], fallback: TelemetrySpanStatus): TelemetrySpanStatus {
  const statuses = new Set<TelemetrySpanStatus>();
  for (const span of spans) {
    statuses.add(span.status);
  }
  if (statuses.has("error")) return "error";
  if (statuses.has("partial")) return "partial";
  if (statuses.has("success")) return "success";
  return fallback;
}

function mergeRecords(records: TelemetryRecord[]): TelemetryRecord[] {
  const byResponse = new Map<string, TelemetryRecord>();
  const finals: TelemetryRecord[] = [];

  for (const record of records) {
    const keys = collectResponseKeys(record);
    let target = null;
    const usableKeys: string[] = [];
    for (const key of keys) {
      const existing = byResponse.get(key);
      if (existing) {
        if (rowsConflict(existing, record)) {
          if (TELEMETRY_CONFLICT_LOG) {
            console.debug("[telemetry-merge:row-conflict]", {
              key,
              existingRow: summarizeRow(existing),
              incomingRow: summarizeRow(record),
              responseId: record.responseId ?? record.providerResponseId ?? record.root.derived.providerResponseId,
            });
          }
          continue;
        }
        target = existing;
        usableKeys.push(key);
        break;
      }
      usableKeys.push(key);
    }
    if (target) {
      mergeTelemetryRecord(target, record);
      for (const key of usableKeys) {
        byResponse.set(key, target);
      }
    } else {
      finals.push(record);
      for (const key of usableKeys) {
        const existing = byResponse.get(key);
        if (existing && rowsConflict(existing, record)) {
          continue;
        }
        byResponse.set(key, record);
      }
    }
  }

  return finals;
}

function mergeTelemetryRecord(target: TelemetryRecord, source: TelemetryRecord) {
  target.status = mergeStatus(target.status, source.status);
  target.startedAt = mergeTimestampMin(target.startedAt, source.startedAt);
  target.endedAt = mergeTimestampMax(target.endedAt, source.endedAt);
  target.durationMs = mergeDuration(target.durationMs, source.durationMs, target.startedAt, target.endedAt);

  target.modelId = target.modelId ?? source.modelId;
  target.provider = target.provider ?? source.provider;
  target.aggregator = target.aggregator ?? source.aggregator;
  target.temperature = mergeNumeric(target.temperature, source.temperature, Math.max);
  target.prompt = pickBetterText(target.prompt, source.prompt);
  target.response = pickLatestText(target.response, source.response);
  target.promptTokens = mergeNumeric(target.promptTokens, source.promptTokens, Math.max);
  target.completionTokens = mergeNumeric(target.completionTokens, source.completionTokens, Math.max);
  target.totalTokens = mergeNumeric(target.totalTokens, source.totalTokens, Math.max);
  target.costUSD = mergeNumeric(target.costUSD, source.costUSD, Math.max);
  target.latencyMs = mergeNumeric(target.latencyMs, source.latencyMs, Math.min);
  target.routingReasoning = target.routingReasoning ?? source.routingReasoning;
  target.routingPlan = target.routingPlan ?? source.routingPlan;
  target.iteration = mergeNumeric(target.iteration, source.iteration, Math.max);
  target.role = target.role ?? source.role;
  target.responseId = target.responseId ?? source.responseId;
  target.operationId = target.operationId ?? source.operationId;
  target.promptMessages = target.promptMessages ?? source.promptMessages ?? source.root.derived.promptMessages;
  target.datasetRowId = target.datasetRowId ?? source.datasetRowId ?? source.root.derived.datasetRowId;
  target.datasetRowInput = target.datasetRowInput ?? source.datasetRowInput ?? source.root.derived.datasetRowInput;
  target.datasetRowExpected = target.datasetRowExpected ?? source.datasetRowExpected ?? source.root.derived.datasetRowExpected;
  target.datasetRowLabel = pickRowLabel(target.datasetRowLabel, source.datasetRowLabel, target.datasetRowId, target.datasetRowInput);
  target.providerResponseId = target.providerResponseId ?? source.providerResponseId ?? source.root.derived.providerResponseId;

  target.fallbackProviders = mergeStringArrays(target.fallbackProviders, source.fallbackProviders);
  target.routingAttempts = mergeRoutingAttempts(target.routingAttempts, source.routingAttempts);

  const allChildren = new Map<string, TelemetrySpan>();
  const pushChild = (child: TelemetrySpan) => {
    if (!allChildren.has(child.spanId)) {
      allChildren.set(child.spanId, child);
    }
  };

  pushChild(target.root);
  target.children.forEach(pushChild);
  pushChild(source.root);
  source.children.forEach(pushChild);

  const preferredRoot = selectPreferredRoot(target.root, source.root);
  if (preferredRoot.spanId !== target.root.spanId) {
    pushChild(target.root);
    target.root = preferredRoot;
  }
  target.traceId = target.root.traceId;

  const finalChildren: TelemetrySpan[] = [];
  for (const [spanId, span] of allChildren.entries()) {
    if (spanId === target.root.spanId) continue;
    finalChildren.push(span);
  }
  finalChildren.sort((a, b) => (a.startTime ?? a.endTime ?? 0) - (b.startTime ?? b.endTime ?? 0));
  target.children = finalChildren;
}

function rowsConflict(a: TelemetryRecord, b: TelemetryRecord): boolean {
  const aRowId = a.datasetRowId ?? a.root.derived.datasetRowId;
  const bRowId = b.datasetRowId ?? b.root.derived.datasetRowId;
  if (aRowId && bRowId && aRowId !== bRowId) return true;

  const aInput = normalizeText(a.datasetRowInput ?? a.root.derived.datasetRowInput);
  const bInput = normalizeText(b.datasetRowInput ?? b.root.derived.datasetRowInput);
  if (aInput && bInput && aInput !== bInput) return true;

  return false;
}

function summarizeRow(record: TelemetryRecord): { id?: string; input?: string } {
  return {
    id: record.datasetRowId ?? record.root.derived.datasetRowId,
    input: record.datasetRowInput ?? record.root.derived.datasetRowInput,
  };
}

function mergeStatus(a: TelemetrySpanStatus, b: TelemetrySpanStatus): TelemetrySpanStatus {
  const order: Record<TelemetrySpanStatus, number> = { success: 0, partial: 1, error: 2 };
  return order[b] > order[a] ? b : a;
}

function mergeTimestampMin(a?: number, b?: number): number | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.min(a, b);
  return typeof a === "number" ? a : b;
}

function mergeTimestampMax(a?: number, b?: number): number | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  return typeof a === "number" ? a : b;
}

function mergeDuration(
  a: number | undefined,
  b: number | undefined,
  startedAt?: number,
  endedAt?: number,
): number | undefined {
  if (typeof startedAt === "number" && typeof endedAt === "number") {
    return Math.max(0, endedAt - startedAt);
  }
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  return typeof a === "number" ? a : b;
}

function mergeNumeric(
  a: number | undefined,
  b: number | undefined,
  reducer: (x: number, y: number) => number,
): number | undefined {
  if (typeof a === "number" && typeof b === "number") {
    return reducer(a, b);
  }
  return typeof a === "number" ? a : b;
}

function pickBetterText(a?: string, b?: string): string | undefined {
  if (hasText(a) && hasText(b)) {
    return b.length > (a?.length ?? 0) ? b : a;
  }
  if (hasText(a)) return a;
  if (hasText(b)) return b;
  return undefined;
}

function pickLatestText(a?: string, b?: string): string | undefined {
  if (hasText(b)) return b;
  if (hasText(a)) return a;
  return undefined;
}

function mergeStringArrays(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined;
  const set = new Set<string>();
  (a ?? []).forEach((value) => set.add(value));
  (b ?? []).forEach((value) => set.add(value));
  return Array.from(set);
}

function mergeRoutingAttempts(
  a?: TelemetryRecord["routingAttempts"],
  b?: TelemetryRecord["routingAttempts"],
): TelemetryRecord["routingAttempts"] | undefined {
  if (!a && !b) return undefined;
  const merged: ProviderRoutingAttempt[] = [];
  const key = (attempt: ProviderRoutingAttempt) => `${attempt.provider}|${attempt.modelId ?? ""}|${attempt.credentialType ?? ""}`;
  const map = new Map<string, ProviderRoutingAttempt>();
  const insert = (attempt?: ProviderRoutingAttempt) => {
    if (!attempt) return;
    const existing = map.get(key(attempt));
    if (!existing) {
      map.set(key(attempt), { ...attempt });
      return;
    }
    existing.success = existing.success || attempt.success;
    existing.durationMs = mergeNumeric(existing.durationMs, attempt.durationMs, Math.max);
    existing.costUSD = mergeNumeric(existing.costUSD, attempt.costUSD, Math.max);
  };
  (a ?? []).forEach(insert);
  (b ?? []).forEach(insert);
  map.forEach((value) => merged.push(value));
  return merged;
}

function selectPreferredRoot(a: TelemetrySpan, b: TelemetrySpan): TelemetrySpan {
  return spanScore(b) > spanScore(a) ? b : a;
}

function spanScore(span: TelemetrySpan): number {
  let score = 0;
  if (hasText(span.derived.promptSummary)) score += 3;
  if (hasText(span.derived.responseText)) score += 2;
  if (span.durationMs) score += 1;
  return score;
}

function pickRowLabel(
  current?: string,
  incoming?: string,
  rowId?: string,
  rowInput?: string,
): string | undefined {
  if (current) return current;
  if (incoming) return incoming;
  if (rowId) return rowId;
  if (rowInput) return rowInput.slice(0, 64);
  return undefined;
}

export function hydrateDatasetFromLookup(record: TelemetryRecord, lookup: DatasetLookup) {
  const entryById = record.datasetRowId ? lookup.byId.get(record.datasetRowId) : undefined;
  if (entryById) {
    applyDatasetEntry(record, entryById.row);
    return;
  }

  const userPrompt = extractUserPrompt(record.promptMessages ?? record.root.derived.promptMessages);
  const normalizedUserPrompt = normalizeText(userPrompt);
  if (normalizedUserPrompt) {
    const entriesFromPrompt = lookup.byInput.get(normalizedUserPrompt);
    if (entriesFromPrompt && entriesFromPrompt.length > 0) {
      if (entriesFromPrompt.length > 1 && DEBUG_TELEMETRY) {
        console.warn(
          "[telemetry-hydrate] ambiguous prompt match",
          {
            prompt: userPrompt,
            matches: entriesFromPrompt.map((entry) => entry.row.id),
          },
        );
      }
      applyDatasetEntry(record, entriesFromPrompt[0].row);
      return;
    }
  }

  if (record.datasetRowInput) {
    const matches = lookup.byInput.get(normalizeText(record.datasetRowInput));
    if (matches && matches.length > 0) {
      if (matches.length > 1 && DEBUG_TELEMETRY) {
        console.warn(
          "[telemetry-hydrate] ambiguous input match",
          {
            input: record.datasetRowInput,
            matches: matches.map((entry) => entry.row.id),
          },
        );
      }
      applyDatasetEntry(record, matches[0].row);
    }
  }
}

function applyDatasetEntry(record: TelemetryRecord, row: DatasetRow) {
  const needsUpdate =
    record.datasetRowId !== row.id
    || normalizeText(record.datasetRowInput) !== normalizeText(row.input)
    || normalizeText(record.datasetRowExpected) !== normalizeText(row.expectedOutput);

  if (!needsUpdate) {
    if (!record.datasetRowInput) record.datasetRowInput = row.input;
    if (record.datasetRowExpected === undefined) record.datasetRowExpected = row.expectedOutput;
    if (!record.datasetRowLabel) record.datasetRowLabel = row.id;
    return;
  }

  record.datasetRowId = row.id;
  record.datasetRowInput = row.input;
  record.datasetRowExpected = row.expectedOutput;
  record.datasetRowLabel = row.id;
}

function extractUserPrompt(messages?: PromptMessage[]): string | undefined {
  if (!messages) return undefined;
  for (const message of messages) {
    if (message.role === "user" && hasText(message.content)) {
      return message.content;
    }
  }
  return undefined;
}

function normalizeText(value?: string): string {
  return value ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

function collectResponseKeys(record: TelemetryRecord): string[] {
  const keys = new Set<string>();
  const add = (value?: string) => {
    if (value && value.length > 0) keys.add(value);
  };
  const addTraceSpanKey = (traceId?: string, spanId?: string) => {
    if (!traceId) return;
    add(`trace:${traceId}`);
    if (spanId) add(`trace:${traceId}:span:${spanId}`);
  };

  const datasetRowId = record.datasetRowId ?? record.root.derived.datasetRowId;
  const datasetRowInput = normalizeText(record.datasetRowInput ?? record.root.derived.datasetRowInput);
  if (datasetRowId) add(`row:${datasetRowId}`);
  if (datasetRowInput) add(`input:${datasetRowInput}`);

  const providerResponseId = record.providerResponseId ?? record.root.derived.providerResponseId;
  const responseId = record.responseId ?? record.root.derived.responseId;
  if (providerResponseId && datasetRowId) {
    add(`provider:${providerResponseId}:row:${datasetRowId}`);
  }
  if (responseId && datasetRowId) {
    add(`response:${responseId}:row:${datasetRowId}`);
  }

  add(providerResponseId);
  add(responseId);
  for (const child of record.children) {
    const childProvider = child.derived.providerResponseId;
    const childResponse = child.derived.responseId;
    if (childProvider && datasetRowId) {
      add(`provider:${childProvider}:row:${datasetRowId}`);
    }
    if (childResponse && datasetRowId) {
      add(`response:${childResponse}:row:${datasetRowId}`);
    }
    add(childProvider);
    add(childResponse);
  }

  const hasPrimaryKeys = keys.size > 0;

  if (!hasPrimaryKeys) {
    addTraceSpanKey(record.root.traceId, record.root.spanId);
    for (const child of record.children) {
      addTraceSpanKey(child.traceId, child.spanId);
    }
    addTraceSpanKey(record.traceId, record.root.spanId);
  }

  return Array.from(keys);
}

export function computePromptDiff(previous: PromptMessage[], current: PromptMessage[]): PromptDiffLine[] {
  const prevText = extractSystemPromptLines(previous);
  const currText = extractSystemPromptLines(current);
  const lines: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < prevText.length || j < currText.length) {
    const prevLine = prevText[i];
    const currLine = currText[j];
    if (prevLine === currLine) {
      lines.push({ type: "context", text: currLine ?? "" });
      i += 1;
      j += 1;
    } else if (currLine && !prevText.includes(currLine)) {
      lines.push({ type: "add", text: currLine });
      j += 1;
    } else if (prevLine && !currText.includes(prevLine)) {
      lines.push({ type: "remove", text: prevLine });
      i += 1;
    } else {
      if (prevLine) {
        lines.push({ type: "remove", text: prevLine });
        i += 1;
      }
      if (currLine) {
        lines.push({ type: "add", text: currLine });
        j += 1;
      }
    }
  }
  const hasChange = lines.some((line) => line.type !== "context");
  if (!hasChange) return [];
  return lines.slice(0, 80);
}

function extractSystemPromptLines(messages: PromptMessage[]): string[] {
  const system = messages.find((message) => message.role === "system" && hasText(message.content));
  if (!system?.content) return [];
  return system.content.split("\n");
}

function pickDerived<K extends keyof TelemetrySpan["derived"], T>(
  spans: TelemetrySpan[],
  key: K,
  transform: (value: TelemetrySpan["derived"][K]) => T | undefined,
): T | undefined {
  for (const span of spans) {
    const value = span.derived[key];
    if (value !== null && value !== undefined) {
      const transformed = transform(value);
      if (transformed !== undefined) {
        return transformed;
      }
    }
  }
  return undefined;
}

function pickDerivedLast<K extends keyof TelemetrySpan["derived"], T>(
  spans: TelemetrySpan[],
  key: K,
  transform: (value: TelemetrySpan["derived"][K]) => T | undefined,
): T | undefined {
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    const value = span.derived[key];
    if (value !== null && value !== undefined) {
      const transformed = transform(value);
      if (transformed !== undefined) {
        return transformed;
      }
    }
  }
  return undefined;
}

function computeTotalTokens(promptTokens?: number, completionTokens?: number): number | undefined {
  if (typeof promptTokens === "number" && typeof completionTokens === "number") {
    return promptTokens + completionTokens;
  }
  return undefined;
}

function readAttribute(attributes: Record<string, unknown>, path: string): string | undefined {
  const segments = path.split(".");
  let current: unknown = attributes;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (Number.isNaN(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === "string" && current.trim().length > 0) {
    return current.trim();
  }
  return undefined;
}
