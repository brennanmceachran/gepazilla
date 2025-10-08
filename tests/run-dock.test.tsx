import React from "react";
import { cleanup, render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { RunDock } from "@/components/optimizer/run-dock";
import type {
  LogEntry,
  OptimizerConfig,
  RunStats,
  TelemetryRecord,
} from "@/components/optimizer/types";
import type { ResultsPanelProps } from "@/components/optimizer/run-dock/results-panel";

const logsSpy = vi.fn<(logs: LogEntry[]) => void>();

vi.mock("@/components/ui/tabs", () => {
  const TabsContext = React.createContext<(value: string) => void>(() => {});

  const Tabs = ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children: React.ReactNode }) => (
    <TabsContext.Provider value={onValueChange ?? (() => {})}>
      <div data-testid="tabs" data-value={value}>{children}</div>
    </TabsContext.Provider>
  );

  const TabsList = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  const TabsTrigger = ({ value, children }: { value: string; children: React.ReactNode }) => {
    const handleSelect = React.useContext(TabsContext);
    return (
      <button type="button" data-trigger={value} onClick={() => handleSelect(value)}>
        {children}
      </button>
    );
  };

  const TabsContent = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

vi.mock("@/components/optimizer/config-panel", () => ({
  RunConfigForm: () => <div data-testid="config-form" />,
}));

vi.mock("@/components/optimizer/run-dock/bottom-sheet", () => ({
  BottomSheet: ({ state, onStateChange, header, children }: {
    state: string;
    onStateChange: (next: string) => void;
    header: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="bottom-sheet" data-state={state}>
      <button
        type="button"
        data-testid="toggle-sheet"
        onClick={() => onStateChange(state === "peek" ? "short" : "peek")}
      >
        toggle
      </button>
      <div data-testid="header">{header}</div>
      {children}
    </div>
  ),
}));

vi.mock("@/components/optimizer/run-dock/header", () => ({
  RunDockHeader: ({ status }: { status: string }) => (
    <div data-testid="header-status">{status}</div>
  ),
}));

vi.mock("@/components/optimizer/run-dock/logs-panel", () => ({
  RunLogsPanel: ({ logs }: { logs: LogEntry[] }) => {
    logsSpy(logs);
    return <div data-testid="logs-panel" data-length={logs.length} />;
  },
}));

vi.mock("@/components/optimizer/run-dock/results-panel", () => {
  const ResultsPanel = (props: ResultsPanelProps) => {
    void props;
    return <div data-testid="results-panel" />;
  };

  return {
    ResultsPanel,
    computeResultStats: () => ({}),
  };
});

vi.mock("@/components/optimizer/use-optimizer-state", () => ({
  deriveCandidateTimeline: () => [],
}));

type RunDockProps = React.ComponentProps<typeof RunDock>;

const baseTelemetryRecord: TelemetryRecord = {
  traceId: "trace",
  root: {
    traceId: "trace",
    spanId: "span",
    name: "span",
    status: "success",
    attributes: {},
    derived: {},
  },
  children: [],
  status: "success",
  startedAt: 5,
  endedAt: 10,
};

const baseProgress: RunDockProps["runProgress"] = {
  startTime: null,
  iterationSamples: [],
  phaseSamples: [],
  finalizing: false,
  latestPhaseByIteration: {},
  phaseStats: {} as RunDockProps["runProgress"]["phaseStats"],
  iterationStats: { total: 0, count: 0 },
  finalizingStart: null,
  finalizingStats: { total: 0, count: 0 },
};

const baseConfig: OptimizerConfig = {
  taskModel: "model",
  reflectionModel: "reflect",
  reflectionHint: "",
  gatewayApiKey: "",
  maxIterations: 1,
  reflectionMinibatchSize: 3,
  candidateSelectionStrategy: "current_best",
  skipPerfectScore: false,
  maxMetricCalls: undefined,
  maxBudgetUSD: undefined,
  seedSystemPrompt: "seed",
};

const baseLogs: LogEntry[] = [{ level: "info", channel: "lifecycle", message: "log", ts: 1 }];
const telemetryRecords: TelemetryRecord[] = [baseTelemetryRecord];

const createProps = (overrides: Partial<RunDockProps> = {}): RunDockProps => ({
  open: false,
  onToggle: vi.fn(),
  logs: baseLogs,
  telemetryRecords,
  candidateHistory: [],
  scorerDiagnostics: [],
  selectedChannels: new Set(["lifecycle", "prompt"]),
  onToggleChannel: vi.fn(),
  runHistory: [],
  stats: {} as RunStats,
  result: null,
  runProgress: baseProgress,
  config: baseConfig,
  status: "idle",
  onConfigField: () => () => undefined,
  onConfigNumberField: () => () => undefined,
  onConfigOptionalNumberField: () => () => undefined,
  datasetCounts: { training: 1, validation: 0 },
  onStart: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn(),
  disableStart: false,
  needsGatewayKey: false,
  onApplySystemPrompt: vi.fn(),
  hasGatewayKey: true,
  latestCheckpoint: null,
  onResumeFromCheckpoint: vi.fn().mockResolvedValue(undefined),
  iterationOffset: 0,
  autoResumeExhausted: false,
  ...overrides,
});

afterEach(() => {
  cleanup();
  logsSpy.mockReset();
  vi.clearAllMocks();
});

describe("RunDock", () => {
  it("merges telemetry logs into RunLogsPanel", () => {
    const props = createProps({ open: true });
    render(<RunDock {...props} />);
    const capturedLogs = logsSpy.mock.lastCall?.[0] ?? [];
    expect(capturedLogs).toHaveLength(1);
    expect(capturedLogs[0].level).toBe("info");
  });

  it("notifies parent when sheet state opens", async () => {
    const props = createProps();
    render(<RunDock {...props} />);

    const toggleButtons = screen.getAllByTestId("toggle-sheet");
    fireEvent.click(toggleButtons[0]);

    await waitFor(() => {
      expect(props.onToggle).toHaveBeenCalledWith(true);
    });
  });

  it("switches tabs based on status transitions", async () => {
    const idleProps = createProps({ open: true, status: "idle" });
    const { rerender } = render(<RunDock {...idleProps} />);
    expect(screen.getByTestId("tabs")).toHaveAttribute("data-value", "run");

    const runningProps = createProps({ open: true, status: "running" });
    rerender(<RunDock {...runningProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("tabs")).toHaveAttribute("data-value", "logs");
    });

    const completedProps = createProps({ open: true, status: "completed" });
    rerender(<RunDock {...completedProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("tabs")).toHaveAttribute("data-value", "results");
    });
  });
});
