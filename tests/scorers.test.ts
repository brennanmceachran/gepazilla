/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

import {
  createScorerConfig,
  evaluateScorer,
  evaluateScorerSync,
  evaluateRegexPresence,
  listPlugins,
  normalizeToString,
  resolvePlugin,
} from "@/lib/scorers";
import type { OptimizeScorerConfig } from "@/lib/schemas";

const mockGenerateObject = vi.fn(async () => ({
  object: { score: 0.6, explanation: "ok" },
}));

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

describe("normalizeToString", () => {
  it("stringifies objects safely", () => {
    expect(normalizeToString({ a: 1 })).toBe("{\"a\":1}");
  });

  it("falls back when JSON.stringify fails", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeToString(circular)).toMatch(/TypeError|[\w\W]+/);
  });

  it("coerces primitives", () => {
    expect(normalizeToString(42)).toBe("42");
    expect(normalizeToString(null)).toBe("");
  });
});

describe("evaluateRegexPresence", () => {
  it("requires a pattern", () => {
    const result = evaluateRegexPresence("foo", { pattern: "" } as any);
    expect(result.status).toBe("error");
  });

  it("counts matches for 'any' mode", () => {
    const result = evaluateRegexPresence("Hello world", { pattern: "hello", mode: "any" } as any);
    expect(result.value).toBe(1);
    expect(result.status).toBe("ready");
  });

  it("honours between range with inversion", () => {
    const result = evaluateRegexPresence(
      "red blue red",
      { pattern: "red", mode: "between", minCount: 2, maxCount: 3, invert: true } as any,
    );
    expect(result.value).toBe(0);
    expect(result.notes).toContain("inverted");
  });
});

describe("evaluateScorerSync", () => {
  const baseContext = { input: "foo", expectedOutput: "bar", candidate: "bar" };

  it("returns pending for async scorer without sync handler", () => {
    const asyncScorer = createScorerConfig("llm_rubric", { enabled: true });
    const result = evaluateScorerSync(asyncScorer, baseContext);
    expect(result.status).toBe("pending");
  });

  it("computes exact match case-insensitively", () => {
    const scorer = createScorerConfig("exact_match", { enabled: true });
    const result = evaluateScorerSync(scorer, { ...baseContext, candidate: "BAR" });
    expect(result.status).toBe("ready");
    expect(result.value).toBe(1);
  });
});

describe("llm rubric async scorer", () => {
  it("parses JSON responses", async () => {
    const scorer = createScorerConfig("llm_rubric", {
      enabled: true,
      params: { rubric: "grade", model: "mock" },
    } as Partial<OptimizeScorerConfig>);

    const result = await evaluateScorer(scorer, {
      input: "input",
      expectedOutput: "expected",
      candidate: "candidate",
    });

    expect(result.status).toBe("ready");
    expect(result.value).toBeCloseTo(0.6, 5);
  });
});

describe("registry", () => {
  it("lists all plugins", () => {
    expect(listPlugins().map((p) => p.type)).toContain("regex_presence");
  });

  it("resolves plugins by type", () => {
    expect(resolvePlugin("length_ratio")).toBeDefined();
  });

  it("respects overrides and validates params", () => {
    const config = createScorerConfig("regex_presence", {
      label: "Check",
      params: { pattern: "foo", minCount: 1 },
      weight: 2,
      enabled: false,
    });

    expect(config.label).toBe("Check");
    expect(config.params?.pattern).toBe("foo");
    expect(config.weight).toBe(2);
    expect(config.enabled).toBe(false);

    expect(() =>
      createScorerConfig("regex_presence", { params: { minCount: -1 } as Record<string, unknown> }),
    ).toThrow();
  });
});
