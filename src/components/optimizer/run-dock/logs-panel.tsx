"use client";

import { Button } from "@/components/ui/button";

import type { LogEntry, LogChannel } from "../types";
import { LOG_CHANNELS } from "../types";
import { LogLevelToggle } from "./logs/log-level-toggle";

const CHANNEL_LABELS: Record<LogChannel, string> = {
  lifecycle: "Lifecycle",
  prompt: "Prompt updates",
  scoring: "Scoring",
  telemetry: "Telemetry",
  alerts: "Alerts",
  misc: "Other",
};
import { LogMeta } from "./logs/log-meta";

export type ProgressInfo = {
  percent: number;
  elapsedMs: number;
  currentIteration: number;
  maxIterations: number;
  averageIterationMs: number | null;
  remainingMs: number | null;
  estimatedTotalMs: number | null;
  finalizing: boolean;
};

type RunLogsPanelProps = {
  logs: LogEntry[];
  selectedChannels: Set<LogChannel>;
  onToggleChannel: (channel: LogChannel) => void;
  focusedIteration: number | null;
  onClearFocus: () => void;
};

export function RunLogsPanel({
  logs,
  selectedChannels,
  onToggleChannel,
  focusedIteration,
  onClearFocus,
}: RunLogsPanelProps) {
  const totalEntries = logs.length;

  return (
    <div className="mt-0 flex flex-1 min-h-0 flex-col gap-2 px-3 py-3 overflow-auto bg-neutral-50">
      <div className="flex flex-1 min-h-0 flex-col gap-2 text-xs text-neutral-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {LOG_CHANNELS.map((channel) => (
              <LogLevelToggle
                key={channel}
                level={channel}
                label={CHANNEL_LABELS[channel] ?? channel}
                active={selectedChannels.has(channel)}
                onToggle={() => onToggleChannel(channel)}
              />
            ))}
          </div>
          <span className="text-[11px] text-neutral-500">
            {totalEntries === 1 ? "1 entry" : `${totalEntries} entries`}
          </span>
        </div>
        {focusedIteration !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <span>
              Highlighting logs for iteration <span className="font-semibold">{focusedIteration}</span>
            </span>
            <Button variant="link" size="sm" className="h-6 px-0 text-amber-900" onClick={onClearFocus}>
              Clear
            </Button>
          </div>
        ) : null}
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-neutral-200 bg-white">
          <ul className="divide-y divide-neutral-100">
            {logs.length === 0 ? (
              <li className="p-3 font-mono text-[11px] text-neutral-500">No logs for the selected filters yet.</li>
            ) : (
              logs.map((entry, index) => (
                <li key={`${entry.ts}-${index}`} className="px-3 py-2">
                  <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                    <span className="rounded-md border border-neutral-200 bg-neutral-100 px-2 py-0.5 uppercase text-neutral-600">
                      {CHANNEL_LABELS[entry.channel] ?? entry.channel}
                    </span>
                    <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-neutral-500">
                      {entry.level}
                    </span>
                    <span className="font-mono text-neutral-500">{formatTimestamp(entry.ts)}</span>
                  </div>
                  {entry.message ? (
                    <p className="mt-1 font-mono text-[11px] text-neutral-700">{entry.message}</p>
                  ) : null}
                  <div className="mt-1">
                    <LogMeta meta={entry.meta} highlightIteration={focusedIteration} />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(value: number): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return `${value}`;
  }
}
