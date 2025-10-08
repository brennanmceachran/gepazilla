import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";

import { ResultsPanel, useBestCandidate } from "@/components/optimizer/run-dock/results-panel";
import type { ResultsPanelProps } from "@/components/optimizer/run-dock/results-panel";
import type { CandidateTimelineEntry, RunHistoryEntry, RunStats, ScorerDiagnosticsSummaryEntry } from "@/components/optimizer/types";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";
import { useProgressSnapshot } from "@/components/optimizer/run-dock/logs/progress-summary";

beforeAll(() => {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => ""),
      },
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
});

const baseStats: RunStats = {
  iterations: 3,
  totalMetricCalls: 9,
  totalCostUSD: 0.25,
};

const baseHistory: RunHistoryEntry[] = [];
const baseCandidates: CandidateTimelineEntry[] = [];
const baseDiagnostics: ScorerDiagnosticsSummaryEntry[] = [];

function renderPanel(overrides: Partial<ResultsPanelProps> = {}) {
  const props: ResultsPanelProps = {
    stats: baseStats,
    runHistory: baseHistory,
    result: null,
    candidateHistory: baseCandidates,
    scorerDiagnostics: baseDiagnostics,
    onApplyBestPrompt: () => {},
    onSelectHistory: () => {},
    selectedRunId: null,
    focusedIteration: null,
    onFocusIteration: () => {},
    status: "paused",
    progress: {
      percent: 0.4,
      elapsedMs: 20_000,
      currentIteration: 4,
      maxIterations: 8,
      averageIterationMs: null,
      remainingMs: null,
      estimatedTotalMs: null,
      finalizing: false,
    },
    latestCheckpoint: {
      iteration: 4,
      totalMetricCalls: 20,
      totalCostUSD: 0.42,
      rngState: 0,
      candidates: [],
      perInstanceScores: [],
    } satisfies CheckpointState,
    onResume: () => {},
    autoResumeExhausted: false,
    ...overrides,
  };

  return render(<ResultsPanel {...props} />);
}

function BestCandidateProbe({
  result,
  history,
  checkpoint,
}: {
  result: ResultsPanelProps["result"];
  history: CandidateTimelineEntry[];
  checkpoint: CheckpointState | null;
}) {
  const candidate = useBestCandidate(result, history, checkpoint);
  return (
    <div data-testid="candidate-probe">
      <span data-testid="candidate-source">{candidate?.source ?? "none"}</span>
      <span data-testid="candidate-prompt">{candidate?.prompt ?? ""}</span>
    </div>
  );
}

describe("useBestCandidate", () => {
  it("prefers final bestCandidate when available", () => {
    const checkpoint: CheckpointState = {
      iteration: 2,
      totalMetricCalls: 10,
      totalCostUSD: 0.1,
      rngState: 0,
      candidates: [],
      perInstanceScores: [],
    };

    render(
      <BestCandidateProbe
        result={{
          bestCandidate: { system: "final", score: 0.9 },
          iterations: 5,
          bestScore: 0.9,
        } as unknown as ResultsPanelProps["result"]}
        history={[]}
        checkpoint={checkpoint}
      />,
    );

    expect(screen.getByTestId("candidate-prompt").textContent).toBe("final");
    expect(screen.getByTestId("candidate-source").textContent).toBe("final");
  });

  it("falls back to accepted history when no final result", () => {
    const candidateHistory: CandidateTimelineEntry[] = [
      { iteration: 1, prompt: " a ", scores: { correctness: 0.1 }, accepted: true },
    ];
    render(<BestCandidateProbe result={null} history={candidateHistory} checkpoint={null} />);
    expect(screen.getByTestId("candidate-prompt").textContent?.trim()).toBe("a");
    expect(screen.getByTestId("candidate-source").textContent).toBe("history");
  });

  it("uses checkpoint candidate when no other prompts available", () => {
    const checkpoint: CheckpointState = {
      iteration: 3,
      totalMetricCalls: 15,
      totalCostUSD: 0.2,
      rngState: 0,
      candidates: [
        {
          candidate: { system: "checkpoint" },
          scores: {},
          scalarScore: 0.5,
        },
      ],
      perInstanceScores: [],
    };
    render(<BestCandidateProbe result={null} history={[]} checkpoint={checkpoint} />);
    expect(screen.getByTestId("candidate-prompt").textContent).toBe("checkpoint");
    expect(screen.getByTestId("candidate-source").textContent).toBe("checkpoint");
  });
});

describe("ResultsPanel", () => {
  it("shows auto-resume exhaustion hint when provided", () => {
    renderPanel({ autoResumeExhausted: true });
    expect(screen.getByText(/auto-resume retries have stopped/i)).toBeInTheDocument();
  });

  it("renders best candidate card when prompt exists", () => {
    renderPanel({
      result: {
        bestCandidate: { system: "Hello" },
        bestScore: 0.7,
        iterations: 4,
      } as unknown as ResultsPanelProps["result"],
    });
    expect(screen.getByText(/best candidate/i)).toBeInTheDocument();
    expect(screen.getByText(/apply to system prompt/i)).toBeInTheDocument();
  });
});

describe("useProgressSnapshot", () => {
  function ProgressProbe({
    progress,
  }: {
    progress: Parameters<typeof useProgressSnapshot>[0];
  }) {
    const snapshot = useProgressSnapshot(progress);
    return (
      <div data-testid="progress-probe">
        <span data-testid="progress-iterations">{snapshot.iterations}</span>
        <span data-testid="progress-elapsed">{snapshot.elapsedLabel}</span>
      </div>
    );
  }

  it("formats iteration string with max iterations", () => {
    render(
      <ProgressProbe
        progress={{
          percent: 0.5,
          elapsedMs: 30_000,
          currentIteration: 5,
          maxIterations: 12,
          averageIterationMs: null,
          remainingMs: null,
          estimatedTotalMs: null,
          finalizing: false,
        }}
      />,
    );
    expect(screen.getByTestId("progress-iterations").textContent).toBe("5 / 12");
    expect(screen.getByTestId("progress-elapsed").textContent).toBe("0:30");
  });
});
