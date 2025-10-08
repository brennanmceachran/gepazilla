import { describe, expect, it } from "vitest";

import { extractLatencyMs } from "@/lib/utils";
import { deriveCandidateTimeline } from "@/components/optimizer/use-optimizer-state";
import type { GEPAResult } from "@currentai/dsts";

const resultFixture = {
  paretoFront: [
    { candidate: { system: "sys" }, scores: { latency: 120 } },
    { candidate: { system: "sys" }, scores: { latency: 90 } },
  ],
  history: [
    { iteration: 1, candidate: { system: "sys" }, scores: { latency: 110 } },
    { iteration: "2", candidate: { system: "sys" }, scores: { latency: -80 } },
  ],
  bestCandidate: { system: "sys" },
  iterations: 5,
} as unknown as GEPAResult;

describe("extractLatencyMs", () => {
  it("returns the smallest absolute latency", () => {
    expect(extractLatencyMs(resultFixture)).toBe(80);
  });

  it("returns undefined when no latency present", () => {
    expect(extractLatencyMs(undefined)).toBeUndefined();
  });
});

describe("deriveCandidateTimeline", () => {
  it("builds sorted timeline from history", () => {
    const timeline = deriveCandidateTimeline({
      history: [
        { iteration: "3", candidate: { system: "second" }, scores: { accuracy: 0.8 } },
        { iteration: 1, candidate: { system: "first" }, scores: { accuracy: 0.2 } },
      ],
      bestCandidate: { system: "second" },
    } as unknown as GEPAResult);

    expect(timeline.map((entry) => entry.iteration)).toEqual([1, 3]);
    expect(timeline[0].prompt).toBe("first");
  });

  it("falls back to best candidate when history empty", () => {
    const timeline = deriveCandidateTimeline({
      history: [],
      bestCandidate: { system: "sys" },
      paretoFront: [{ candidate: { system: "sys" }, scores: { quality: 0.9 } }],
      iterations: 4,
    } as unknown as GEPAResult);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].accepted).toBe(true);
  });
});
