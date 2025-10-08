import { describe, expect, it, vi } from "vitest";

import {
  computeScoreboard,
  parseIterationValue,
  prepareDataset,
  updateEvaluationRole,
} from "@/app/api/run/helpers";
import { createScorerConfig } from "@/lib/scorers";

const singleRow = [
  {
    input: "Hello",
    expectedOutput: "World",
  },
];

describe("prepareDataset", () => {
  it("fills missing ids and keeps expected output", () => {
    const prepared = prepareDataset(singleRow);
    expect(prepared.rows[0].id).toMatch(/^row-/);
    expect(prepared.rows[0].expectedOutput).toBe("World");
    expect(prepared.tasks[0].__rowMeta?.id).toBe(prepared.rows[0].id);
  });
});

describe("parseIterationValue", () => {
  it("parses numbers and numeric strings", () => {
    expect(parseIterationValue({ iteration: 5 })).toBe(5);
    expect(parseIterationValue({ iteration: "6" })).toBe(6);
    expect(parseIterationValue({})).toBeNull();
  });
});

describe("updateEvaluationRole", () => {
  it("transitions according to message", () => {
    expect(updateEvaluationRole(null, "Evaluating parent candidate on minibatch")).toBe("parent_minibatch");
    expect(updateEvaluationRole("parent_minibatch", "Candidate evaluation complete")).toBeNull();
    expect(updateEvaluationRole("candidate_minibatch", "Unknown message")).toBe("candidate_minibatch");
  });
});

describe("computeScoreboard", () => {
  it("aggregates scorer totals", async () => {
    const { rows } = prepareDataset(singleRow);
    const scorer = createScorerConfig("exact_match", { enabled: true, weight: 1 });
    const scoreboard = await computeScoreboard(rows, ["World"], [scorer], undefined);

    expect(scoreboard).toHaveLength(1);
    expect(scoreboard[0].total).toBe(1);
    expect(scoreboard[0].scorers[scorer.id].status).toBe("ready");
  });

  it("rejects when scorer evaluation throws", async () => {
    const scorers = await import("@/lib/scorers");
    const spy = vi.spyOn(scorers, "evaluateScorer").mockRejectedValueOnce(new Error("boom"));

    const { rows } = prepareDataset(singleRow);
    const scorer = createScorerConfig("regex_presence", { enabled: true, weight: 1, params: { pattern: "Hello" } });
    await expect(computeScoreboard(rows, ["Hello"], [scorer], undefined)).rejects.toThrow("boom");

    spy.mockRestore();
  });
});
